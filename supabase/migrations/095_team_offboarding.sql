-- ============================================================================
-- 095. OFFBOARDING  (exit, access revocation, exit survey, alumni)
-- ----------------------------------------------------------------------------
-- PRIVATE NOTES
-- The exit reason and the manager's private notes are not the same thing. The
-- notes are for the brand admin and superadmin only, so offboardings has a
-- SELECT policy that lets nobody else read the row at all. Venue managers work
-- off public.offboarding_list, a view that simply does not contain the notes
-- column, and they make changes through the RPCs below rather than updating the
-- table — so there is no "UPDATE … RETURNING private_notes" way round it.
--
-- ACCESS REVOCATION
-- Scheduled for the end of the last shift date (Melbourne time) and carried out
-- by offboarding_process_revocations(), which follows the pattern migration 064
-- already set for daily people jobs: an idempotent SQL function called once a
-- day from the nightly-sync edge function. Revocation clears venue access,
-- un-rosters the person and stamps profiles.access_revoked_at — it does NOT
-- delete their Supabase auth user. That is deliberate: payroll, timesheets and
-- incident records all reference the profile, and losing the row would take
-- those with it. See the summary note for how to hard-delete if you ever want to.
--
-- Safe to re-run.
-- ============================================================================

-- ============================================================================
-- BRAND TEMPLATES
-- ============================================================================
create table if not exists public.brand_exit_checklist_items (
  id          uuid        primary key default uuid_generate_v4(),
  brand_id    uuid        not null references public.brands(id) on delete cascade,
  label       text        not null,
  description text,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- The exit survey is short on purpose: three questions people will actually
-- answer on their way out. Reuses the Pulse question types so the same UI
-- components render it.
create table if not exists public.brand_exit_questions (
  id         uuid        primary key default uuid_generate_v4(),
  brand_id   uuid        not null references public.brands(id) on delete cascade,
  text       text        not null,
  type       text        not null default 'scale_1_5' check (type in ('scale_1_5', 'text')),
  sort_order integer     not null default 0,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['brand_exit_checklist_items', 'brand_exit_questions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (brand_id in (select b from public.my_brand_ids() b))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.has_brand_admin(brand_id))',
      t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update using (public.has_brand_admin(brand_id))',
      t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete using (public.has_brand_admin(brand_id))',
      t || '_delete', t);
  end loop;
end $$;

-- ============================================================================
-- THE EXIT RECORD
-- ============================================================================
create table if not exists public.offboardings (
  id                  uuid        primary key default uuid_generate_v4(),
  brand_id            uuid        not null references public.brands(id)      on delete cascade,
  restaurant_id       uuid        not null references public.restaurants(id) on delete cascade,
  employee_id         uuid        not null references public.profiles(id)    on delete cascade,

  reason              text        not null
                                  check (reason in ('resigned', 'terminated', 'abandoned', 'end_of_contract')),
  last_shift_date     date        not null,
  eligible_for_rehire boolean     not null default true,
  -- Brand admin + superadmin only. Never selected by the venue-manager views.
  private_notes       text,

  shifts_unassigned   integer     not null default 0,
  access_revoke_at    timestamptz,
  access_revoked_at   timestamptz,
  status              text        not null default 'pending'
                                  check (status in ('pending', 'revoked')),

  exit_survey_enabled      boolean not null default true,
  exit_survey_completed_at timestamptz,
  checklist_complete       boolean not null default false,

  -- Set when the person is re-invited through onboarding: the old exit stops
  -- being their current state but stays on the record.
  superseded_at       timestamptz,

  started_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_offboardings_employee on public.offboardings(employee_id);
create index if not exists idx_offboardings_venue    on public.offboardings(restaurant_id, status);
create index if not exists idx_offboardings_revoke   on public.offboardings(access_revoke_at)
  where access_revoked_at is null;

-- One live exit per person. A re-invited exit is superseded, which frees them
-- up for a future one.
create unique index if not exists uniq_offboardings_live
  on public.offboardings(employee_id) where superseded_at is null;

alter table public.offboardings enable row level security;

-- Brand admins only, because this row carries the private notes. Everyone else
-- reads public.offboarding_list.
drop policy if exists "offboardings_select" on public.offboardings;
create policy "offboardings_select" on public.offboardings
  for select using (public.has_brand_admin(brand_id));

-- No insert / update / delete policies: every change goes through an RPC that
-- checks the caller's rights itself.

drop trigger if exists offboardings_updated_at on public.offboardings;
create trigger offboardings_updated_at
  before update on public.offboardings
  for each row execute function public.handle_updated_at();

-- ── Exit checklist (manager-facing, no notes on it) ─────────────────────────
create table if not exists public.offboarding_checklist (
  id              uuid        primary key default uuid_generate_v4(),
  offboarding_id  uuid        not null references public.offboardings(id) on delete cascade,
  item_id         uuid        references public.brand_exit_checklist_items(id) on delete set null,
  label           text        not null,
  sort_order      integer     not null default 0,
  done            boolean     not null default false,
  done_by         uuid        references public.profiles(id) on delete set null,
  done_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (offboarding_id, item_id)
);

alter table public.offboarding_checklist enable row level security;

drop policy if exists "offboarding_checklist_select" on public.offboarding_checklist;
create policy "offboarding_checklist_select" on public.offboarding_checklist
  for select using (
    exists (select 1 from public.offboardings o
            where o.id = offboarding_id
              and (public.has_roster_view(o.restaurant_id) or public.has_brand_admin(o.brand_id)))
  );

drop policy if exists "offboarding_checklist_update" on public.offboarding_checklist;
create policy "offboarding_checklist_update" on public.offboarding_checklist
  for update using (
    exists (select 1 from public.offboardings o
            where o.id = offboarding_id
              and (public.has_roster_manage(o.restaurant_id) or public.has_brand_admin(o.brand_id)))
  );

-- Rows are created by offboarding_start(); nobody adds or removes them by hand.

-- ── Exit survey answers (NOT anonymous) ────────────────────────────────────
-- brand_id is denormalised so the policy is a single check with no join into a
-- table the employee cannot read.
create table if not exists public.exit_survey_responses (
  id             uuid        primary key default uuid_generate_v4(),
  offboarding_id uuid        not null references public.offboardings(id) on delete cascade,
  employee_id    uuid        not null references public.profiles(id)     on delete cascade,
  brand_id       uuid        not null references public.brands(id)       on delete cascade,
  question_id    uuid        references public.brand_exit_questions(id) on delete set null,
  question_text  text        not null,
  value_int      smallint    check (value_int is null or value_int between 1 and 5),
  value_text     text,
  submitted_at   timestamptz not null default now()
);

create index if not exists idx_exit_survey_offboarding
  on public.exit_survey_responses(offboarding_id);

alter table public.exit_survey_responses enable row level security;

-- Brand admin + superadmin read it. The person who wrote it cannot read it
-- back — this is feedback, not a document they hold a copy of.
drop policy if exists "exit_survey_responses_select" on public.exit_survey_responses;
create policy "exit_survey_responses_select" on public.exit_survey_responses
  for select using (public.has_brand_admin(brand_id));

-- Written only by exit_survey_submit().

-- ============================================================================
-- MANAGER-FACING VIEW  (no private notes, scoped inside the view)
-- Doubles as the Alumni list: an exit with superseded_at null IS the person's
-- current standing, whether access has been revoked yet or not.
-- ============================================================================
create or replace view public.offboarding_list as
select o.id,
       o.employee_id,
       p.full_name                as employee_name,
       p.role                     as employee_role,
       p.avatar_url,
       o.restaurant_id,
       r.name                     as venue_name,
       o.brand_id,
       o.reason,
       o.last_shift_date,
       o.eligible_for_rehire,
       o.shifts_unassigned,
       o.access_revoke_at,
       o.access_revoked_at,
       o.status,
       o.exit_survey_enabled,
       o.exit_survey_completed_at,
       o.checklist_complete,
       o.superseded_at,
       o.started_by,
       s.full_name                as started_by_name,
       o.created_at,
       -- Does the caller get to read the private notes? Lets the UI show the
       -- panel only to people the policy will actually serve.
       public.has_brand_admin(o.brand_id) as can_view_notes
from public.offboardings o
join public.profiles p on p.id = o.employee_id
left join public.restaurants r on r.id = o.restaurant_id
left join public.profiles s on s.id = o.started_by
where public.is_superadmin()
   or public.has_brand_admin(o.brand_id)
   or public.has_roster_view(o.restaurant_id);

grant select on public.offboarding_list to authenticated;

-- ============================================================================
-- PRIVILEGE GUARD CARVE-OUT
-- guard_profile_privilege_change (migration 063) blocks anyone who is not a
-- superadmin from changing restaurant_access or is_rosterable — which is
-- exactly what revoking access does. Rather than widening the guard, this
-- recreates it with one explicit escape hatch: a transaction-local GUC that
-- only offboarding_process_revocations() ever sets. Everything else about the
-- guard is unchanged from 063.
-- ============================================================================
create or replace function public.guard_profile_privilege_change()
returns trigger as $$
begin
  -- Offboarding's scheduled revocation, and nothing else, sets this.
  if coalesce(current_setting('orbit.offboarding', true), '') = 'on' then
    return new;
  end if;

  if coalesce(auth.role(), '') <> 'service_role' and not public.is_superadmin() then
    if (new.role is distinct from old.role)
       or (new.restaurant_access is distinct from old.restaurant_access) then
      raise exception 'Only a superadmin can change role or restaurant access';
    end if;

    -- Employment terms are a variation of contract, not a profile edit.
    if (new.base_pay_rate    is distinct from old.base_pay_rate)
       or (new.award_level      is distinct from old.award_level)
       or (new.pay_type         is distinct from old.pay_type)
       or (new.employment_type  is distinct from old.employment_type)
       or (new.salary_annual    is distinct from old.salary_annual)
       or (new.contracted_hours is distinct from old.contracted_hours)
       or (new.home_restaurant_id is distinct from old.home_restaurant_id)
       or (new.is_rosterable    is distinct from old.is_rosterable)
       or (new.position_title   is distinct from old.position_title)
       or (new.start_date       is distinct from old.start_date)
       or (new.probation_weeks  is distinct from old.probation_weeks) then
      raise exception 'Only a superadmin can change employment terms';
    end if;

    -- Write-once for the employee: they set these during onboarding, then any
    -- later change goes through an approval.
    if (old.legal_first_name is not null and new.legal_first_name is distinct from old.legal_first_name)
       or (old.legal_last_name is not null and new.legal_last_name is distinct from old.legal_last_name)
       or (old.date_of_birth  is not null and new.date_of_birth  is distinct from old.date_of_birth) then
      raise exception 'Legal name and date of birth changes need approval';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- START AN EXIT
-- One call does the lot: records the exit, strips them off every shift after
-- their last day, builds the checklist, and schedules revocation.
-- ============================================================================
create or replace function public.offboarding_start(
  p_employee_id         uuid,
  p_reason              text,
  p_last_shift_date     date,
  p_eligible_for_rehire boolean default true,
  p_private_notes       text    default null,
  p_exit_survey         boolean default true
)
returns uuid language plpgsql security definer as $$
declare
  v_venue   uuid;
  v_brand   uuid;
  v_name    text;
  v_id      uuid;
  v_unassigned integer := 0;
begin
  select p.home_restaurant_id, p.full_name into v_venue, v_name
  from public.profiles p where p.id = p_employee_id;

  if v_name is null then raise exception 'Team member not found'; end if;
  if v_venue is null then
    raise exception 'Set a home venue for % before starting their exit', v_name;
  end if;
  if not public.has_roster_manage(v_venue) then
    raise exception 'Not allowed to offboard someone at that venue';
  end if;

  select r.brand_id into v_brand from public.restaurants r where r.id = v_venue;
  if v_brand is null then
    raise exception 'That venue is not assigned to a brand yet';
  end if;

  if exists (select 1 from public.offboardings
             where employee_id = p_employee_id and superseded_at is null) then
    raise exception '% already has an exit in progress', v_name;
  end if;

  insert into public.offboardings (
    brand_id, restaurant_id, employee_id, reason, last_shift_date,
    eligible_for_rehire, private_notes, exit_survey_enabled,
    access_revoke_at, started_by
  )
  values (
    v_brand, v_venue, p_employee_id, p_reason, p_last_shift_date,
    coalesce(p_eligible_for_rehire, true), nullif(btrim(coalesce(p_private_notes, '')), ''),
    coalesce(p_exit_survey, true),
    -- End of the last shift date, venue time: midnight at the start of the
    -- following day in Melbourne.
    ((p_last_shift_date + 1)::timestamp at time zone 'Australia/Melbourne'),
    auth.uid()
  )
  returning id into v_id;

  -- Everything rostered after their last day becomes an open shift for the
  -- manager to fill. employee_id null is already how ORBIT marks an open shift
  -- (migration 045); the note says why it went open.
  with upd as (
    update public.shifts s
       set employee_id = null,
           note = btrim(coalesce(s.note || ' · ', '')
                        || 'Open — ' || v_name || ' left on '
                        || to_char(p_last_shift_date, 'FMDD Mon'))
     where s.employee_id = p_employee_id
       and s.date > p_last_shift_date
    returning 1
  )
  select count(*) into v_unassigned from upd;

  update public.offboardings set shifts_unassigned = v_unassigned where id = v_id;

  insert into public.offboarding_checklist (offboarding_id, item_id, label, sort_order)
  select v_id, i.id, i.label, i.sort_order
  from public.brand_exit_checklist_items i
  where i.brand_id = v_brand and i.is_active
  on conflict (offboarding_id, item_id) do nothing;

  perform public.offboarding_recalc(v_id);

  perform public.team_audit(
    'offboarding', 'exit_started', 'offboarding', v_id, v_name,
    v_brand, v_venue, null, 'pending',
    jsonb_build_object(
      'reason', p_reason,
      'last_shift_date', p_last_shift_date,
      'eligible_for_rehire', coalesce(p_eligible_for_rehire, true),
      'shifts_unassigned', v_unassigned
    )
  );

  return v_id;
end;
$$;

grant execute on function public.offboarding_start(uuid, text, date, boolean, text, boolean)
  to authenticated;

create or replace function public.offboarding_recalc(p_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.offboardings o
     set checklist_complete = not exists (
           select 1 from public.offboarding_checklist c
           where c.offboarding_id = o.id and not c.done
         )
   where o.id = p_id;
end;
$$;

create or replace function public.offboarding_recalc_from_checklist()
returns trigger language plpgsql security definer as $$
begin
  perform public.offboarding_recalc(coalesce(new.offboarding_id, old.offboarding_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists offboarding_checklist_recalc on public.offboarding_checklist;
create trigger offboarding_checklist_recalc
  after insert or update or delete on public.offboarding_checklist
  for each row execute function public.offboarding_recalc_from_checklist();

-- ── Amend an exit (no notes — those are a separate, narrower call) ──────────
create or replace function public.offboarding_update(
  p_id                  uuid,
  p_reason              text    default null,
  p_last_shift_date     date    default null,
  p_eligible_for_rehire boolean default null,
  p_exit_survey         boolean default null
)
returns void language plpgsql security definer as $$
declare o public.offboardings%rowtype;
begin
  select * into o from public.offboardings where id = p_id;
  if not found then raise exception 'Exit not found'; end if;
  if not (public.has_roster_manage(o.restaurant_id) or public.has_brand_admin(o.brand_id)) then
    raise exception 'Not allowed';
  end if;

  update public.offboardings set
    reason              = coalesce(p_reason, reason),
    last_shift_date     = coalesce(p_last_shift_date, last_shift_date),
    eligible_for_rehire = coalesce(p_eligible_for_rehire, eligible_for_rehire),
    exit_survey_enabled = coalesce(p_exit_survey, exit_survey_enabled),
    access_revoke_at    = case
      when access_revoked_at is not null then access_revoke_at   -- already done, leave it
      else ((coalesce(p_last_shift_date, last_shift_date) + 1)::timestamp
              at time zone 'Australia/Melbourne')
    end
  where id = p_id;
end;
$$;

grant execute on function public.offboarding_update(uuid, text, date, boolean, boolean)
  to authenticated;

-- ── Private notes: read and write, brand admin only ────────────────────────
create or replace function public.offboarding_notes(p_id uuid)
returns text language plpgsql security definer stable as $$
declare o public.offboardings%rowtype;
begin
  select * into o from public.offboardings where id = p_id;
  if not found then raise exception 'Exit not found'; end if;
  if not public.has_brand_admin(o.brand_id) then
    raise exception 'Only a brand admin can read exit notes';
  end if;
  return o.private_notes;
end;
$$;

grant execute on function public.offboarding_notes(uuid) to authenticated;

create or replace function public.offboarding_set_notes(p_id uuid, p_notes text)
returns void language plpgsql security definer as $$
declare o public.offboardings%rowtype;
begin
  select * into o from public.offboardings where id = p_id;
  if not found then raise exception 'Exit not found'; end if;
  if not public.has_brand_admin(o.brand_id) then
    raise exception 'Only a brand admin can edit exit notes';
  end if;
  update public.offboardings
     set private_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_id;
end;
$$;

grant execute on function public.offboarding_set_notes(uuid, text) to authenticated;

-- ============================================================================
-- EXIT SURVEY  (named, not anonymous — and it says so on screen)
-- ============================================================================
create or replace function public.exit_survey_for_me()
returns jsonb language plpgsql security definer stable as $$
declare
  o public.offboardings%rowtype;
begin
  select * into o from public.offboardings
   where employee_id = auth.uid()
     and superseded_at is null
     and exit_survey_enabled
     and exit_survey_completed_at is null
   limit 1;

  if not found then return null; end if;

  return jsonb_build_object(
    'offboarding_id', o.id,
    'last_shift_date', o.last_shift_date,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'text', q.text, 'type', q.type)
                       order by q.sort_order, q.text)
      from public.brand_exit_questions q
      where q.brand_id = o.brand_id and q.is_active
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.exit_survey_for_me() to authenticated;

create or replace function public.exit_survey_submit(p_offboarding uuid, p_answers jsonb)
returns void language plpgsql security definer as $$
declare
  o        public.offboardings%rowtype;
  v_answer jsonb;
  v_qid    uuid;
  v_text   text;
  v_type   text;
  v_int    smallint;
  v_body   text;
  v_n      integer := 0;
begin
  select * into o from public.offboardings
   where id = p_offboarding and employee_id = auth.uid() and superseded_at is null;
  if not found then raise exception 'No exit survey waiting for you'; end if;
  if o.exit_survey_completed_at is not null then
    raise exception 'You have already answered this';
  end if;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    v_qid := nullif(v_answer->>'question_id', '')::uuid;

    select q.text, q.type into v_text, v_type
    from public.brand_exit_questions q
    where q.id = v_qid and q.brand_id = o.brand_id and q.is_active;

    if v_text is null then continue; end if;

    v_int  := null;
    v_body := null;

    if v_type = 'scale_1_5' then
      v_int := nullif(v_answer->>'value_int', '')::smallint;
      if v_int is null then continue; end if;
      if v_int < 1 or v_int > 5 then raise exception 'Scale answers must be 1 to 5'; end if;
    else
      v_body := nullif(btrim(coalesce(v_answer->>'value_text', '')), '');
      if v_body is null then continue; end if;
      v_body := left(v_body, 4000);
    end if;

    insert into public.exit_survey_responses (
      offboarding_id, employee_id, brand_id, question_id, question_text, value_int, value_text
    )
    values (o.id, auth.uid(), o.brand_id, v_qid, v_text, v_int, v_body);

    v_n := v_n + 1;
  end loop;

  update public.offboardings set exit_survey_completed_at = now() where id = o.id;

  perform public.team_audit(
    'offboarding', 'exit_survey_submitted', 'offboarding', o.id, null,
    o.brand_id, o.restaurant_id, null, null, jsonb_build_object('answers', v_n)
  );
end;
$$;

grant execute on function public.exit_survey_submit(uuid, jsonb) to authenticated;

-- Let the person decline without being asked again every login.
create or replace function public.exit_survey_skip(p_offboarding uuid)
returns void language plpgsql security definer as $$
begin
  update public.offboardings
     set exit_survey_completed_at = now()
   where id = p_offboarding and employee_id = auth.uid() and exit_survey_completed_at is null;
end;
$$;

grant execute on function public.exit_survey_skip(uuid) to authenticated;

-- ============================================================================
-- SCHEDULED ACCESS REVOCATION  (call once a day — see nightly-sync)
-- Idempotent: rows are picked up only while access_revoked_at is null.
-- ============================================================================
create or replace function public.offboarding_process_revocations()
returns integer language plpgsql security definer as $$
declare
  r record;
  n integer := 0;
begin
  perform set_config('orbit.offboarding', 'on', true);

  for r in
    select o.id, o.employee_id, o.brand_id, o.restaurant_id, p.full_name
    from public.offboardings o
    join public.profiles p on p.id = o.employee_id
    where o.superseded_at is null
      and o.access_revoked_at is null
      and o.access_revoke_at is not null
      and o.access_revoke_at <= now()
  loop
    update public.profiles
       set access_revoked_at = now(),
           is_rosterable     = false,
           restaurant_access = '{}'::uuid[]
     where id = r.employee_id;

    update public.offboardings
       set access_revoked_at = now(), status = 'revoked'
     where id = r.id;

    perform public.team_audit(
      'offboarding', 'access_revoked', 'offboarding', r.id, r.full_name,
      r.brand_id, r.restaurant_id, 'pending', 'revoked',
      '{}'::jsonb,
      -- Runs unattended, so there is no auth.uid() to credit.
      null
    );

    n := n + 1;
  end loop;

  perform set_config('orbit.offboarding', 'off', true);
  return n;
end;
$$;

-- ============================================================================
-- RE-INVITE AN ALUMNUS
-- Puts an eligible leaver back through onboarding: the old exit is superseded,
-- a fresh invite is created against their existing profile, and because that
-- new hire starts at 'invited' the roster block from migration 094 keeps them
-- off the roster until they have finished. Logging back in is a separate step
-- — the manager restores their venue access in Settings → Team.
-- ============================================================================
create or replace function public.offboarding_reinvite(p_id uuid)
returns uuid language plpgsql security definer as $$
declare
  o        public.offboardings%rowtype;
  p        public.profiles%rowtype;
  v_hire   uuid;
begin
  select * into o from public.offboardings where id = p_id;
  if not found then raise exception 'Exit not found'; end if;
  if not (public.has_roster_manage(o.restaurant_id) or public.has_brand_admin(o.brand_id)) then
    raise exception 'Not allowed';
  end if;
  if not o.eligible_for_rehire then
    raise exception 'This person is marked as not eligible for rehire';
  end if;
  if o.superseded_at is not null then
    raise exception 'This exit has already been superseded';
  end if;

  select * into p from public.profiles where id = o.employee_id;

  update public.offboardings set superseded_at = now() where id = p_id;

  insert into public.new_hires (
    brand_id, restaurant_id, full_name, mobile, role, position_title,
    legal_first_name, legal_last_name, preferred_name, date_of_birth, email,
    profile_id, created_by, notes
  )
  values (
    o.brand_id, o.restaurant_id, p.full_name,
    coalesce(p.phone, ''),
    case when p.role in ('team_member', 'staff', 'shift_supervisor', 'manager')
         then p.role else 'team_member' end,
    p.position_title,
    p.legal_first_name, p.legal_last_name, p.preferred_name, p.date_of_birth,
    coalesce(nullif(p.contact_email, ''), nullif(p.email, '')),
    p.id, auth.uid(),
    'Re-invited after leaving on ' || to_char(o.last_shift_date, 'FMDD Mon YYYY')
  )
  returning id into v_hire;

  perform public.team_audit(
    'offboarding', 'reinvited', 'offboarding', o.id, p.full_name,
    o.brand_id, o.restaurant_id, o.status, 'superseded',
    jsonb_build_object('new_hire_id', v_hire)
  );

  return v_hire;
end;
$$;

grant execute on function public.offboarding_reinvite(uuid) to authenticated;

-- ============================================================================
-- SEED
-- ============================================================================
create or replace function public.team_seed_brand_offboarding(p_brand uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.brand_exit_checklist_items (brand_id, label, description, sort_order)
  select p_brand, d.label, d.descr, d.ord
  from (values
    ('Uniform returned',          'Shirt, apron, cap back',                  10),
    ('Keys returned',             'Keys, swipe, door and alarm codes',       20),
    ('POS login disabled',        'Till and back-office logins switched off', 30),
    ('Final pay flagged to payroll', 'Last pay run and any leave owing',     40)
  ) as d(label, descr, ord)
  where not exists (
    select 1 from public.brand_exit_checklist_items i
    where i.brand_id = p_brand and i.label = d.label
  );

  insert into public.brand_exit_questions (brand_id, text, type, sort_order)
  select p_brand, d.q_text, d.q_type, d.ord
  from (values
    ('How was your overall experience working here?', 'scale_1_5', 10),
    ('Did you feel supported by your manager?',       'scale_1_5', 20),
    ('What is the main reason you are leaving?',      'text',      30)
  ) as d(q_text, q_type, ord)
  where not exists (
    select 1 from public.brand_exit_questions q
    where q.brand_id = p_brand and q.text = d.q_text
  );
end;
$$;

create or replace function public.team_seed_on_brand_insert_exit()
returns trigger language plpgsql security definer as $$
begin
  perform public.team_seed_brand_offboarding(new.id);
  return new;
end;
$$;

drop trigger if exists brands_seed_team_offboarding on public.brands;
create trigger brands_seed_team_offboarding
  after insert on public.brands
  for each row execute function public.team_seed_on_brand_insert_exit();

select public.team_seed_brand_offboarding(id) from public.brands;
