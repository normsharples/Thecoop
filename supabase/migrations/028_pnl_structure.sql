-- ============================================================================
-- 028 — Structured P&L
--   1. Add a `category` column to invoices so COGS can split Food vs Paper.
--   2. Create `weekly_labour` — manually-entered weekly payroll actuals
--      (cost is the source of truth; Deputy remains the source of truth for hours).
--   3. Backfill / remap historical categories onto the new canonical chart of
--      accounts used by the structured P&L report.
--
-- Safe to re-run. Run this in your Supabase SQL editor.
-- ============================================================================

-- ── 1. Invoice category (COGS: Food Cost / Paper Cost) ───────────────────────

alter table public.invoices
  add column if not exists category text;

-- Existing invoices were all food-supplier purchases → default them to Food Cost.
update public.invoices
  set category = 'Food Cost'
  where category is null;


-- ── 2. Weekly labour (manual payroll actuals) ────────────────────────────────

create table if not exists public.weekly_labour (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  week_start    date not null,                    -- Monday of the pay week
  actual_labour numeric not null default 0 check (actual_labour >= 0),
  payroll_tax   numeric not null default 0 check (payroll_tax   >= 0),
  overtime      numeric not null default 0 check (overtime      >= 0),
  penalty_rates numeric not null default 0 check (penalty_rates >= 0),
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint weekly_labour_restaurant_week_key unique (restaurant_id, week_start)
);

create index if not exists idx_weekly_labour_restaurant on public.weekly_labour(restaurant_id);
create index if not exists idx_weekly_labour_week        on public.weekly_labour(week_start);

alter table public.weekly_labour enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'weekly_labour' and policyname = 'weekly_labour_select') then
    create policy "weekly_labour_select" on public.weekly_labour for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_labour' and policyname = 'weekly_labour_insert') then
    create policy "weekly_labour_insert" on public.weekly_labour for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_labour' and policyname = 'weekly_labour_update') then
    create policy "weekly_labour_update" on public.weekly_labour for update using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'weekly_labour' and policyname = 'weekly_labour_delete') then
    create policy "weekly_labour_delete" on public.weekly_labour for delete using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;


-- ── 3. Remap historical overhead categories onto the canonical list ──────────
-- New canonical leaves: Food Cost, Paper Cost, Maintenance & Repairs,
-- Office Expenses, Ops Supplies, Utilities, Occupancy Costs, Equipment Leases,
-- Marketing – Digital, Marketing – Print, Marketing – Sponsorships.
-- Anything not confidently mapped is left as 'Uncategorised' so it stays visible.

update public.expenses set category = case
    when lower(coalesce(category,'')) in ('rent','occupancy','occupancy costs','insurance','rates','property') then 'Occupancy Costs'
    when lower(coalesce(category,'')) in ('utilities','utility','power','electricity','gas','water','internet') then 'Utilities'
    when lower(coalesce(category,'')) in ('repairs & maintenance','repairs and maintenance','repairs','maintenance','maintenance & repairs') then 'Maintenance & Repairs'
    when lower(coalesce(category,'')) in ('software','admin','office','office expenses','bank fees','subscriptions','accounting') then 'Office Expenses'
    when lower(coalesce(category,'')) in ('ops supplies','operational supplies','supplies','consumables') then 'Ops Supplies'
    when lower(coalesce(category,'')) in ('equipment leases','equipment lease','lease','leases','equipment') then 'Equipment Leases'
    when lower(coalesce(category,'')) in ('marketing','advertising','marketing/advertising','marketing / advertising','digital') then 'Marketing – Digital'
    when lower(coalesce(category,'')) in ('print') then 'Marketing – Print'
    when lower(coalesce(category,'')) in ('sponsorship','sponsorships') then 'Marketing – Sponsorships'
    when lower(coalesce(category,'')) in ('food','food cost') then 'Food Cost'
    when lower(coalesce(category,'')) in ('paper','paper cost','packaging') then 'Paper Cost'
    else 'Uncategorised'
  end;

update public.recurring_expenses set category = case
    when lower(coalesce(category,'')) in ('rent','occupancy','occupancy costs','insurance','rates','property') then 'Occupancy Costs'
    when lower(coalesce(category,'')) in ('utilities','utility','power','electricity','gas','water','internet') then 'Utilities'
    when lower(coalesce(category,'')) in ('repairs & maintenance','repairs and maintenance','repairs','maintenance','maintenance & repairs') then 'Maintenance & Repairs'
    when lower(coalesce(category,'')) in ('software','admin','office','office expenses','bank fees','subscriptions','accounting') then 'Office Expenses'
    when lower(coalesce(category,'')) in ('ops supplies','operational supplies','supplies','consumables') then 'Ops Supplies'
    when lower(coalesce(category,'')) in ('equipment leases','equipment lease','lease','leases','equipment') then 'Equipment Leases'
    when lower(coalesce(category,'')) in ('marketing','advertising','marketing/advertising','marketing / advertising','digital') then 'Marketing – Digital'
    when lower(coalesce(category,'')) in ('print') then 'Marketing – Print'
    when lower(coalesce(category,'')) in ('sponsorship','sponsorships') then 'Marketing – Sponsorships'
    else 'Uncategorised'
  end;
