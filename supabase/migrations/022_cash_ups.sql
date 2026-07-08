-- ============================================================================
-- 022. DAILY CASH UPS + restrict staff from bank deposits
-- Staff can no longer record/view bank deposits (cash_deposits) — that's a
-- manager-level banking record. Instead they log a daily till reconciliation
-- ("cash up"): till count, the $200 float subtracted, what was actually
-- deposited, and any ad-hoc cash paid out of the till. Admin roles can review
-- these in Reports.
-- ============================================================================

-- Generalises the "sales_access" check added in 021 — same rule (superadmin,
-- or area_manager/manager scoped to their restaurants; staff excluded) now
-- also applies to bank deposits, not just sales data. Replaces has_sales_access.
create or replace function public.has_non_staff_access(rid uuid)
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
  for select using (public.has_non_staff_access(restaurant_id));

drop policy if exists "sales_daily_insert" on public.sales_daily;
create policy "sales_daily_insert" on public.sales_daily
  for insert with check (public.has_non_staff_access(restaurant_id));

drop policy if exists "sales_daily_update" on public.sales_daily;
create policy "sales_daily_update" on public.sales_daily
  for update using (public.has_non_staff_access(restaurant_id));

drop function if exists public.has_sales_access(uuid);

-- ── cash_deposits: staff can no longer read or write bank deposit records ────

drop policy if exists "cash_deposits_select" on public.cash_deposits;
create policy "cash_deposits_select" on public.cash_deposits
  for select using (public.has_non_staff_access(restaurant_id));

drop policy if exists "cash_deposits_insert" on public.cash_deposits;
create policy "cash_deposits_insert" on public.cash_deposits
  for insert with check (public.has_non_staff_access(restaurant_id));

drop policy if exists "cash_deposits_update" on public.cash_deposits;
create policy "cash_deposits_update" on public.cash_deposits
  for update using (public.has_non_staff_access(restaurant_id));

-- ── cash_ups: daily till reconciliation, open to every restaurant-scoped role ─

create table public.cash_ups (
  id                uuid        primary key default uuid_generate_v4(),
  restaurant_id     uuid        not null references public.restaurants(id) on delete cascade,
  cash_up_date      date        not null,
  till_count        numeric     not null default 0,
  float_amount      numeric     not null default 200,
  amount_deposited  numeric     not null default 0,
  cash_outs         jsonb       not null default '[]', -- [{ description: text, amount: numeric }]
  notes             text,
  recorded_by       uuid        references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (restaurant_id, cash_up_date)
);

create index idx_cash_ups_restaurant on public.cash_ups(restaurant_id);
create index idx_cash_ups_date       on public.cash_ups(cash_up_date);

alter table public.cash_ups enable row level security;

create policy "cash_ups_select" on public.cash_ups
  for select using (public.has_restaurant_access(restaurant_id));

create policy "cash_ups_insert" on public.cash_ups
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "cash_ups_update" on public.cash_ups
  for update using (public.has_restaurant_access(restaurant_id));

create policy "cash_ups_delete" on public.cash_ups
  for delete using (public.is_superadmin());

create trigger cash_ups_updated_at
  before update on public.cash_ups
  for each row execute function public.handle_updated_at();
