-- ============================================================================
-- 020. PROJECTIONS
-- Monthly sales / labour / food cost projections, per restaurant.
-- ============================================================================

create table public.projections (
  id                    uuid        primary key default uuid_generate_v4(),
  restaurant_id         uuid        not null references public.restaurants(id) on delete cascade,
  period_month          date        not null, -- first day of the month, e.g. 2026-08-01
  sales_projection      numeric     not null default 0,
  labour_projection     numeric     not null default 0,
  food_cost_projection  numeric     not null default 0,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (restaurant_id, period_month)
);

create index idx_projections_restaurant on public.projections(restaurant_id);
create index idx_projections_period     on public.projections(period_month);

alter table public.projections enable row level security;

create policy "projections_select" on public.projections
  for select using (public.has_restaurant_access(restaurant_id));

create policy "projections_insert" on public.projections
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "projections_update" on public.projections
  for update using (public.has_restaurant_access(restaurant_id));

create policy "projections_delete" on public.projections
  for delete using (public.is_superadmin());

create trigger projections_updated_at
  before update on public.projections
  for each row execute function public.handle_updated_at();
