-- ============================================================================
-- 042. ROSTERING & TEAM-MEMBER PORTAL  (foundation / P0)
-- ============================================================================
-- Introduces the rostering subsystem that will, over time, replace Deputy.
-- Deputy stays the source of truth for labour_daily (hours + wage cost) during
-- the whole build — NOTHING in this migration touches sales_daily / labour_daily
-- or the existing dashboards. This only adds new tables + a new low-privilege
-- role.
--
-- New role:      team_member  (roster-only, least privilege)
-- Profile adds:  home_restaurant_id, display_colour, is_rosterable,
--                contact_email, phone, base_pay_rate (base_pay_rate is DORMANT —
--                reserved for the future cost/payroll phase)
-- New tables:    positions, roster_weeks, shifts, shift_templates,
--                shift_template_lines, availability_rules, availability_exceptions,
--                leave_requests, shift_swaps, notifications, push_subscriptions
-- Helpers:       is_roster_manager(), has_roster_manage(rid)
-- Hardening:     a trigger that blocks non-superadmins from escalating their own
--                role / restaurant_access (important now that low-trust casual
--                logins exist).
-- ============================================================================

-- ── Role: add team_member ────────────────────────────────────────────────────
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
    check (role in ('superadmin', 'area_manager', 'manager', 'staff', 'team_member'));

-- ── Profile columns for rostering ────────────────────────────────────────────
alter table public.profiles
  add column if not exists home_restaurant_id uuid references public.restaurants(id) on delete set null,
  add column if not exists display_colour     text,
  add column if not exists is_rosterable      boolean not null default false,
  add column if not exists contact_email      text,    -- real email (login email may be synthetic)
  add column if not exists phone              text,
  add column if not exists base_pay_rate      numeric; -- dormant until the payroll phase

-- ── Helper functions ─────────────────────────────────────────────────────────
-- Roster managers = the operational tiers (never staff / team_member).
create or replace function public.is_roster_manager()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager', 'manager')
  );
$$ language sql security definer stable;

-- Roster-manage rights for a specific store (mirrors has_sales_access).
create or replace function public.has_roster_manage(rid uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager', 'manager')
      and (role = 'superadmin' or rid = any(restaurant_access))
  );
$$ language sql security definer stable;

-- ── Privilege-escalation guard on profiles ───────────────────────────────────
-- Prevents a non-superadmin from changing their own (or anyone's) role or
-- restaurant_access via a direct row update. Superadmins and the service role
-- (used by the admin-users edge function) are exempt.
create or replace function public.guard_profile_privilege_change()
returns trigger as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_superadmin() then
    if (new.role is distinct from old.role)
       or (new.restaurant_access is distinct from old.restaurant_access) then
      raise exception 'Only a superadmin can change role or restaurant access';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists profiles_guard_privilege on public.profiles;
create trigger profiles_guard_privilege
  before update on public.profiles
  for each row execute function public.guard_profile_privilege_change();

-- Let roster managers read the rosterable team (needed to assign shifts).
-- Existing "profiles_select_own" (own row / superadmin) stays; policies OR together.
drop policy if exists "profiles_select_roster_manager" on public.profiles;
create policy "profiles_select_roster_manager" on public.profiles
  for select using (public.is_roster_manager() and is_rosterable = true);

-- ============================================================================
-- POSITIONS  (global section/role list, e.g. Kitchen, Front, Rotisserie, Driver)
-- ============================================================================
create table public.positions (
  id         uuid        primary key default uuid_generate_v4(),
  name       text        not null,
  colour     text,
  sort_order integer     not null default 0,
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

alter table public.positions enable row level security;

-- Any authenticated user may read (team members see the position on their shift).
create policy "positions_select" on public.positions
  for select using (auth.uid() is not null);
create policy "positions_insert" on public.positions
  for insert with check (public.is_roster_manager());
create policy "positions_update" on public.positions
  for update using (public.is_roster_manager());
create policy "positions_delete" on public.positions
  for delete using (public.is_superadmin());

-- ============================================================================
-- ROSTER WEEKS  (draft/published state per store per week — gates visibility)
-- ============================================================================
create table public.roster_weeks (
  id            uuid        primary key default uuid_generate_v4(),
  restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
  week_start    date        not null,                    -- Monday
  status        text        not null default 'draft'
                  check (status in ('draft', 'published')),
  published_at  timestamptz,
  published_by  uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, week_start)
);

create index idx_roster_weeks_restaurant on public.roster_weeks(restaurant_id);

alter table public.roster_weeks enable row level security;

-- Managers see their stores' weeks; anyone authenticated may see a PUBLISHED week
-- (so a team member can read the "last updated" stamp for their roster).
create policy "roster_weeks_select" on public.roster_weeks
  for select using (public.has_roster_manage(restaurant_id) or status = 'published');
create policy "roster_weeks_insert" on public.roster_weeks
  for insert with check (public.has_roster_manage(restaurant_id));
create policy "roster_weeks_update" on public.roster_weeks
  for update using (public.has_roster_manage(restaurant_id));
create policy "roster_weeks_delete" on public.roster_weeks
  for delete using (public.has_roster_manage(restaurant_id));

create trigger roster_weeks_updated_at
  before update on public.roster_weeks
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- SHIFTS
-- ============================================================================
create table public.shifts (
  id                  uuid        primary key default uuid_generate_v4(),
  restaurant_id       uuid        not null references public.restaurants(id) on delete cascade,
  employee_id         uuid        not null references public.profiles(id)    on delete cascade,
  date                date        not null,
  start_time          time        not null,
  end_time            time        not null,
  unpaid_break_minutes integer    not null default 0,
  position_id         uuid        references public.positions(id) on delete set null,
  note                text,
  created_by          uuid        references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_shifts_restaurant_date on public.shifts(restaurant_id, date);
create index idx_shifts_employee_date    on public.shifts(employee_id, date);

alter table public.shifts enable row level security;

-- Managers: full control of their stores' shifts.
-- Team member: read ONLY their own shifts, and only in a PUBLISHED week.
create policy "shifts_select" on public.shifts
  for select using (
    public.has_roster_manage(restaurant_id)
    or (
      employee_id = auth.uid()
      and exists (
        select 1 from public.roster_weeks w
        where w.restaurant_id = shifts.restaurant_id
          and w.week_start = (date_trunc('week', shifts.date)::date)
          and w.status = 'published'
      )
    )
  );
create policy "shifts_insert" on public.shifts
  for insert with check (public.has_roster_manage(restaurant_id));
create policy "shifts_update" on public.shifts
  for update using (public.has_roster_manage(restaurant_id));
create policy "shifts_delete" on public.shifts
  for delete using (public.has_roster_manage(restaurant_id));

create trigger shifts_updated_at
  before update on public.shifts
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- SHIFT TEMPLATES  (saved week patterns to drop into the builder)
-- ============================================================================
create table public.shift_templates (
  id            uuid        primary key default uuid_generate_v4(),
  restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
  name          text        not null,
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index idx_shift_templates_restaurant on public.shift_templates(restaurant_id);

alter table public.shift_templates enable row level security;

create policy "shift_templates_select" on public.shift_templates
  for select using (public.has_roster_manage(restaurant_id));
create policy "shift_templates_insert" on public.shift_templates
  for insert with check (public.has_roster_manage(restaurant_id));
create policy "shift_templates_update" on public.shift_templates
  for update using (public.has_roster_manage(restaurant_id));
create policy "shift_templates_delete" on public.shift_templates
  for delete using (public.has_roster_manage(restaurant_id));

create table public.shift_template_lines (
  id                   uuid    primary key default uuid_generate_v4(),
  template_id          uuid    not null references public.shift_templates(id) on delete cascade,
  employee_id          uuid    references public.profiles(id) on delete set null, -- null = unassigned slot
  day_of_week          integer not null check (day_of_week between 0 and 6),      -- 0 = Monday
  start_time           time    not null,
  end_time             time    not null,
  unpaid_break_minutes integer not null default 0,
  position_id          uuid    references public.positions(id) on delete set null,
  note                 text
);

create index idx_shift_template_lines_template on public.shift_template_lines(template_id);

alter table public.shift_template_lines enable row level security;

create policy "shift_template_lines_all" on public.shift_template_lines
  for all using (
    exists (
      select 1 from public.shift_templates t
      where t.id = shift_template_lines.template_id
        and public.has_roster_manage(t.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.shift_templates t
      where t.id = shift_template_lines.template_id
        and public.has_roster_manage(t.restaurant_id)
    )
  );

-- ============================================================================
-- AVAILABILITY  (recurring weekly rules + one-off date exceptions)
-- ============================================================================
create table public.availability_rules (
  id           uuid        primary key default uuid_generate_v4(),
  employee_id  uuid        not null references public.profiles(id) on delete cascade,
  day_of_week  integer     not null check (day_of_week between 0 and 6), -- 0 = Monday
  is_available boolean     not null default true,
  start_time   time,        -- null = all day
  end_time     time,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (employee_id, day_of_week)
);

create index idx_availability_rules_employee on public.availability_rules(employee_id);

alter table public.availability_rules enable row level security;

create policy "availability_rules_select" on public.availability_rules
  for select using (employee_id = auth.uid() or public.is_roster_manager());
create policy "availability_rules_insert" on public.availability_rules
  for insert with check (employee_id = auth.uid() or public.is_roster_manager());
create policy "availability_rules_update" on public.availability_rules
  for update using (employee_id = auth.uid() or public.is_roster_manager());
create policy "availability_rules_delete" on public.availability_rules
  for delete using (employee_id = auth.uid() or public.is_roster_manager());

create trigger availability_rules_updated_at
  before update on public.availability_rules
  for each row execute function public.handle_updated_at();

create table public.availability_exceptions (
  id           uuid        primary key default uuid_generate_v4(),
  employee_id  uuid        not null references public.profiles(id) on delete cascade,
  date         date        not null,
  is_available boolean     not null default false, -- typically an unavailable day
  start_time   time,
  end_time     time,
  reason       text,
  created_at   timestamptz not null default now(),
  unique (employee_id, date)
);

create index idx_availability_exceptions_employee on public.availability_exceptions(employee_id);
create index idx_availability_exceptions_date     on public.availability_exceptions(date);

alter table public.availability_exceptions enable row level security;

create policy "availability_exceptions_select" on public.availability_exceptions
  for select using (employee_id = auth.uid() or public.is_roster_manager());
create policy "availability_exceptions_insert" on public.availability_exceptions
  for insert with check (employee_id = auth.uid() or public.is_roster_manager());
create policy "availability_exceptions_update" on public.availability_exceptions
  for update using (employee_id = auth.uid() or public.is_roster_manager());
create policy "availability_exceptions_delete" on public.availability_exceptions
  for delete using (employee_id = auth.uid() or public.is_roster_manager());

-- ============================================================================
-- LEAVE REQUESTS
-- ============================================================================
create table public.leave_requests (
  id           uuid        primary key default uuid_generate_v4(),
  employee_id  uuid        not null references public.profiles(id) on delete cascade,
  start_date   date        not null,
  end_date     date        not null,
  leave_type   text        not null default 'other'
                 check (leave_type in ('annual', 'sick', 'unpaid', 'other')),
  note         text,
  status       text        not null default 'pending'
                 check (status in ('pending', 'approved', 'declined')),
  reviewed_by  uuid        references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_leave_requests_employee on public.leave_requests(employee_id);
create index idx_leave_requests_status   on public.leave_requests(status);

alter table public.leave_requests enable row level security;

create policy "leave_requests_select" on public.leave_requests
  for select using (employee_id = auth.uid() or public.is_roster_manager());
-- Employees create their own requests; managers may create on behalf.
create policy "leave_requests_insert" on public.leave_requests
  for insert with check (employee_id = auth.uid() or public.is_roster_manager());
-- Employees can edit their own request; managers approve/decline any.
create policy "leave_requests_update" on public.leave_requests
  for update using (employee_id = auth.uid() or public.is_roster_manager());
create policy "leave_requests_delete" on public.leave_requests
  for delete using (employee_id = auth.uid() or public.is_roster_manager());

create trigger leave_requests_updated_at
  before update on public.leave_requests
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- SHIFT SWAPS
-- ============================================================================
create table public.shift_swaps (
  id          uuid        primary key default uuid_generate_v4(),
  shift_id    uuid        not null references public.shifts(id) on delete cascade,
  offered_by  uuid        not null references public.profiles(id) on delete cascade,
  claimed_by  uuid        references public.profiles(id) on delete set null,
  status      text        not null default 'offered'
                check (status in ('offered', 'claimed', 'approved', 'declined', 'cancelled')),
  note        text,
  reviewed_by uuid        references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_shift_swaps_shift  on public.shift_swaps(shift_id);
create index idx_shift_swaps_status on public.shift_swaps(status);

alter table public.shift_swaps enable row level security;

-- Visible to: the offerer, the claimer, any roster manager, and (for open
-- offers) any rosterable team member who could pick it up.
create policy "shift_swaps_select" on public.shift_swaps
  for select using (
    offered_by = auth.uid()
    or claimed_by = auth.uid()
    or public.is_roster_manager()
    or (status = 'offered' and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_rosterable = true
    ))
  );
-- You may only offer a shift that is yours.
create policy "shift_swaps_insert" on public.shift_swaps
  for insert with check (
    offered_by = auth.uid()
    and exists (
      select 1 from public.shifts s
      where s.id = shift_swaps.shift_id and s.employee_id = auth.uid()
    )
  );
-- Offerer can cancel; a claimer can claim; managers can approve/decline.
create policy "shift_swaps_update" on public.shift_swaps
  for update using (
    offered_by = auth.uid()
    or claimed_by = auth.uid()
    or public.is_roster_manager()
    or (status = 'offered' and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_rosterable = true
    ))
  );
create policy "shift_swaps_delete" on public.shift_swaps
  for delete using (offered_by = auth.uid() or public.is_roster_manager());

create trigger shift_swaps_updated_at
  before update on public.shift_swaps
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- NOTIFICATIONS  (in-app inbox)  +  PUSH SUBSCRIPTIONS (web push, later phase)
-- ============================================================================
create table public.notifications (
  id         uuid        primary key default uuid_generate_v4(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  type       text        not null default 'general',
  title      text        not null,
  body       text,
  data       jsonb       not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

-- Users read/lay down read-state on their own; managers may create (on publish).
create policy "notifications_select" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications_insert" on public.notifications
  for insert with check (public.is_roster_manager());
create policy "notifications_update" on public.notifications
  for update using (user_id = auth.uid());
create policy "notifications_delete" on public.notifications
  for delete using (user_id = auth.uid() or public.is_superadmin());

create table public.push_subscriptions (
  id         uuid        primary key default uuid_generate_v4(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index idx_push_subscriptions_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select" on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy "push_subscriptions_insert" on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy "push_subscriptions_delete" on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- ============================================================================
-- END OF MIGRATION 042
-- ============================================================================
