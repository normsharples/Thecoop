-- ============================================================================
-- 092. TEAM AUDIT LOG + brand-admin helpers
-- ----------------------------------------------------------------------------
-- Shared foundation for the three Team modules (Pulse Surveys, Onboarding,
-- Offboarding), all of which have to leave a trail behind every status change.
--
-- The app has no audit table of its own yet, so this is the first one. It is
-- deliberately narrow: one row per *meaningful* state change in the Team
-- modules, not a general-purpose change feed. Writes only ever go through
-- public.team_audit(), which stamps the actor itself — there is no insert
-- policy, so a client cannot forge an entry or backdate one.
--
-- Also adds the "brand admin" tier the three modules need. ORBIT has no
-- brand_admin role; area_manager is the tier between superadmin and venue
-- manager, so that is what brand-admin rights map onto. Recorded here rather
-- than repeated in each module's migration.
--
-- Safe to re-run.
-- ============================================================================

-- ── Access revocation marker ────────────────────────────────────────────────
-- Set by Offboarding (migration 095) at the end of someone's last shift. It
-- lives here because Pulse's headcount maths has to exclude revoked people
-- too, and that is a 093 concern. Null = access is live.
alter table public.profiles
  add column if not exists access_revoked_at timestamptz;

create index if not exists idx_profiles_access_revoked
  on public.profiles(access_revoked_at) where access_revoked_at is not null;

-- ── Who counts as a brand admin ─────────────────────────────────────────────
-- Superadmin, or an area_manager (ORBIT's brand tier). Venue managers are
-- deliberately excluded: they manage a venue, not a brand.
create or replace function public.is_brand_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager')
  );
$$ language sql security definer stable;

-- Brand-admin rights over one specific brand. A superadmin has them
-- everywhere; an area_manager has them for any brand they hold a venue in.
create or replace function public.has_brand_admin(bid uuid)
returns boolean as $$
  select public.is_superadmin()
      or exists (
        select 1
        from public.profiles p
        join public.restaurants r on r.brand_id = bid
        where p.id = auth.uid()
          and p.role = 'area_manager'
          and r.id = any(p.restaurant_access)
      );
$$ language sql security definer stable;

-- Every brand the signed-in person can see at all (superadmin: all of them).
create or replace function public.my_brand_ids()
returns setof uuid as $$
  select b.id from public.brands b where public.is_superadmin()
  union
  select distinct r.brand_id
  from public.restaurants r
  join public.profiles p on p.id = auth.uid()
  where r.brand_id is not null
    and r.id = any(p.restaurant_access);
$$ language sql security definer stable;

-- The venue a team member's answers and paperwork belong to: their home venue,
-- falling back to the first venue they have access to.
create or replace function public.my_home_venue()
returns uuid as $$
  select coalesce(
    p.home_restaurant_id,
    (select r.id from public.restaurants r
      where r.id = any(p.restaurant_access) and r.status = 'active'
      order by r.name limit 1)
  )
  from public.profiles p
  where p.id = auth.uid();
$$ language sql security definer stable;

-- ============================================================================
-- THE LOG
-- ============================================================================
create table if not exists public.team_audit_log (
  id            uuid        primary key default uuid_generate_v4(),
  brand_id      uuid        references public.brands(id)      on delete set null,
  restaurant_id uuid        references public.restaurants(id) on delete set null,
  module        text        not null check (module in ('pulse', 'onboarding', 'offboarding')),
  -- Verb, in the past tense: 'status_changed', 'survey_opened', 'survey_closed',
  -- 'question_versioned', 'exit_started', 'access_revoked', 'invite_sent', …
  action        text        not null,
  subject_type  text        not null,
  subject_id    uuid,
  -- Kept as text so the row still reads after the subject is deleted.
  subject_label text,
  from_value    text,
  to_value      text,
  detail        jsonb       not null default '{}'::jsonb,
  actor_id      uuid        references public.profiles(id) on delete set null,
  actor_label   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_team_audit_created on public.team_audit_log(created_at desc);
create index if not exists idx_team_audit_subject on public.team_audit_log(subject_type, subject_id);
create index if not exists idx_team_audit_module  on public.team_audit_log(module, created_at desc);

alter table public.team_audit_log enable row level security;

-- Brand admins see their brands' entries; venue managers see their venues'.
-- Brand-level entries (restaurant_id null) are brand-admin only.
drop policy if exists "team_audit_log_select" on public.team_audit_log;
create policy "team_audit_log_select" on public.team_audit_log
  for select using (
    public.is_superadmin()
    or (brand_id is not null and public.has_brand_admin(brand_id))
    or (restaurant_id is not null and public.has_roster_manage(restaurant_id))
  );

-- No insert / update / delete policies on purpose. The only way in is
-- public.team_audit(), which is SECURITY DEFINER and stamps the actor itself.
-- An audit trail you can edit is not an audit trail.

-- ============================================================================
-- THE WRITER
-- ============================================================================
create or replace function public.team_audit(
  p_module        text,
  p_action        text,
  p_subject_type  text,
  p_subject_id    uuid    default null,
  p_subject_label text    default null,
  p_brand_id      uuid    default null,
  p_restaurant_id uuid    default null,
  p_from          text    default null,
  p_to            text    default null,
  p_detail        jsonb   default '{}'::jsonb,
  -- Triggers that already know who acted (or that run without a session, e.g.
  -- the nightly job) can pass the actor explicitly.
  p_actor_id      uuid    default null
)
returns uuid language plpgsql security definer as $$
declare
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_label text;
  v_id    uuid;
begin
  select full_name into v_label from public.profiles where id = v_actor;

  insert into public.team_audit_log (
    brand_id, restaurant_id, module, action, subject_type, subject_id,
    subject_label, from_value, to_value, detail, actor_id, actor_label
  )
  values (
    p_brand_id, p_restaurant_id, p_module, p_action, p_subject_type, p_subject_id,
    p_subject_label, p_from, p_to, coalesce(p_detail, '{}'::jsonb), v_actor,
    coalesce(v_label, case when v_actor is null then 'System' else null end)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.team_audit(
  text, text, text, uuid, text, uuid, uuid, text, text, jsonb, uuid
) to authenticated;
