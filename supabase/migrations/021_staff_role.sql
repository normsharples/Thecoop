-- ============================================================================
-- 021. STAFF ROLE
-- Adds a restricted "staff" role: restaurant-level team members who can log
-- incident reports, record cash deposits, and enter invoices, but must not
-- see any sales data anywhere in the app.
-- ============================================================================

-- Defensive: normalise any role value that predates this constraint (e.g. a
-- leftover 'team_member' row if migration 019 was never run against this
-- database) so the tightened check constraint below doesn't fail on existing data.
update public.profiles
set role = 'manager'
where role not in ('superadmin', 'area_manager', 'manager', 'staff');

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
    check (role in ('superadmin', 'area_manager', 'manager', 'staff'));

-- Sales-data access deliberately excludes the staff role — unlike
-- has_restaurant_access(), which every operational role still needs for
-- cash deposits / invoices / incidents.
create or replace function public.has_sales_access(rid uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager', 'manager')
      and (role = 'superadmin' or rid = any(restaurant_access))
  );
$$ language sql security definer stable;

drop policy if exists "sales_daily_select" on public.sales_daily;
create policy "sales_daily_select" on public.sales_daily
  for select using (public.has_sales_access(restaurant_id));

drop policy if exists "sales_daily_insert" on public.sales_daily;
create policy "sales_daily_insert" on public.sales_daily
  for insert with check (public.has_sales_access(restaurant_id));

drop policy if exists "sales_daily_update" on public.sales_daily;
create policy "sales_daily_update" on public.sales_daily
  for update using (public.has_sales_access(restaurant_id));

-- sales_daily_delete stays superadmin-only (unchanged, already excludes staff).
