-- ============================================================================
-- 048. SHIFT SUPERVISOR ROLE
-- A floor-lead role between team_member and manager. Can:
--   • view the whole week's roster for their store(s) (read-only, no sales/cost)
--   • log incidents and do banking / cash (via has_restaurant_access, like staff)
-- Deliberately NOT granted sales access (not added to has_sales_access) and NOT
-- granted roster management (insert/update/delete stay has_roster_manage only).
-- ============================================================================

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
    check (role in ('superadmin', 'area_manager', 'manager', 'staff', 'team_member', 'shift_supervisor'));

-- Can VIEW rosters for a store (managers + shift supervisors).
create or replace function public.has_roster_view(rid uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager', 'manager', 'shift_supervisor')
      and (role = 'superadmin' or rid = any(restaurant_access))
  );
$$ language sql security definer stable;

-- Can view the team list (for roster display).
create or replace function public.is_roster_viewer()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager', 'manager', 'shift_supervisor')
  );
$$ language sql security definer stable;

-- Shifts: managers + supervisors read their stores; team_member reads own published.
drop policy if exists "shifts_select" on public.shifts;
create policy "shifts_select" on public.shifts
  for select using (
    public.has_roster_view(restaurant_id)
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

-- Roster weeks: viewers see their stores; anyone sees a published week.
drop policy if exists "roster_weeks_select" on public.roster_weeks;
create policy "roster_weeks_select" on public.roster_weeks
  for select using (public.has_roster_view(restaurant_id) or status = 'published');

-- Profiles: roster viewers (now incl. supervisors) can read rosterable team.
drop policy if exists "profiles_select_roster_manager" on public.profiles;
create policy "profiles_select_roster_manager" on public.profiles
  for select using (public.is_roster_viewer() and is_rosterable = true);
