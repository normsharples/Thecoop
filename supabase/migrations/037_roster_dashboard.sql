-- ============================================================================
-- 037. ROSTER DASHBOARD
-- Supports the Labour Reports → Roster dashboard:
--   • daily_projections     — per-day projected sales driving Required hours
--   • roster_notes          — one free-text note per roster week, per store
--   • roster_refresh_requests — queue the local Deputy scraper polls so the
--                               web app can trigger an on-demand roster refresh
--
-- SPMH target and minimum roster hours are stored in the existing `targets`
-- table (metric = 'spmh' / 'min_roster_hours', day_of_week = null), so no new
-- table is needed for those.
-- ============================================================================

-- ── Daily projected sales ────────────────────────────────────────────────────
create table public.daily_projections (
  id              uuid        primary key default uuid_generate_v4(),
  restaurant_id   uuid        not null references public.restaurants(id) on delete cascade,
  date            date        not null,
  projected_sales numeric     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, date)
);

create index idx_daily_projections_restaurant on public.daily_projections(restaurant_id);
create index idx_daily_projections_date       on public.daily_projections(date);

alter table public.daily_projections enable row level security;

create policy "daily_projections_select" on public.daily_projections
  for select using (public.has_restaurant_access(restaurant_id));
create policy "daily_projections_insert" on public.daily_projections
  for insert with check (public.has_restaurant_access(restaurant_id));
create policy "daily_projections_update" on public.daily_projections
  for update using (public.has_restaurant_access(restaurant_id));
create policy "daily_projections_delete" on public.daily_projections
  for delete using (public.has_restaurant_access(restaurant_id));

create trigger daily_projections_updated_at
  before update on public.daily_projections
  for each row execute function public.handle_updated_at();

-- ── Roster notes (per week, per store) ───────────────────────────────────────
create table public.roster_notes (
  id              uuid        primary key default uuid_generate_v4(),
  restaurant_id   uuid        not null references public.restaurants(id) on delete cascade,
  week_start_date date        not null, -- Monday of the roster week
  note            text        not null default '',
  updated_by      uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, week_start_date)
);

create index idx_roster_notes_restaurant on public.roster_notes(restaurant_id);

alter table public.roster_notes enable row level security;

create policy "roster_notes_select" on public.roster_notes
  for select using (public.has_restaurant_access(restaurant_id));
create policy "roster_notes_insert" on public.roster_notes
  for insert with check (public.has_restaurant_access(restaurant_id));
create policy "roster_notes_update" on public.roster_notes
  for update using (public.has_restaurant_access(restaurant_id));
create policy "roster_notes_delete" on public.roster_notes
  for delete using (public.has_restaurant_access(restaurant_id));

create trigger roster_notes_updated_at
  before update on public.roster_notes
  for each row execute function public.handle_updated_at();

-- ── Roster refresh requests ──────────────────────────────────────────────────
-- The dashboard inserts a 'pending' row; the local Deputy scraper (sync.mjs
-- --watch) polls for pending rows, scrapes the requested week, then marks the
-- row 'done' (or 'error'). The dashboard polls the row to show progress.
create table public.roster_refresh_requests (
  id              uuid        primary key default uuid_generate_v4(),
  restaurant_id   uuid        not null references public.restaurants(id) on delete cascade,
  week_start      date        not null, -- Monday of the week to refresh
  status          text        not null default 'pending'
                    check (status in ('pending', 'running', 'done', 'error')),
  error_message   text,
  requested_by    uuid        references public.profiles(id) on delete set null,
  requested_at    timestamptz not null default now(),
  completed_at    timestamptz
);

create index idx_roster_refresh_status  on public.roster_refresh_requests(status);
create index idx_roster_refresh_pending on public.roster_refresh_requests(requested_at)
  where status = 'pending';

alter table public.roster_refresh_requests enable row level security;

create policy "roster_refresh_select" on public.roster_refresh_requests
  for select using (public.has_restaurant_access(restaurant_id));
create policy "roster_refresh_insert" on public.roster_refresh_requests
  for insert with check (public.has_restaurant_access(restaurant_id));
create policy "roster_refresh_update" on public.roster_refresh_requests
  for update using (public.has_restaurant_access(restaurant_id));
create policy "roster_refresh_delete" on public.roster_refresh_requests
  for delete using (public.is_superadmin());
