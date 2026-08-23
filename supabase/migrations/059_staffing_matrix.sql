-- ============================================================================
-- 059. STAFFING MATRIX + SALES-DRIVEN ROSTERING CONFIG
-- ----------------------------------------------------------------------------
-- Powers "Build from sales" in the roster builder. Two tables:
--
--   staffing_matrix — the "sales vs required staff" grid (from Norm's sheet).
--     One row per required staffing SLOT. A slot switches ON for an hour once
--     that hour's projected sales reach threshold_sales, and stays on above it
--     (matches the sheet where an X starts at a column and continues right).
--     Duplicate station_name rows = a 2nd/3rd body on that station at higher
--     volume (e.g. a second FRYER from $3300). position_id maps the station to
--     a roster position so training + auto-assign apply; null = unmapped (still
--     generates an open shift, labelled by station_name).
--
--   staffing_config — per-venue knobs for the projection engine + shift rules.
--     Projection blends same-weekday LAST YEAR and LAST WEEK hourly sales
--     (weights) then applies a growth %. Shift rules: min length, and the
--     unpaid break added to long shifts.
-- ============================================================================

create table if not exists public.staffing_matrix (
  id              uuid        primary key default uuid_generate_v4(),
  restaurant_id   uuid        not null references public.restaurants(id) on delete cascade,
  station_name    text        not null,                 -- e.g. 'FRYER', 'POS'
  position_id     uuid        references public.positions(id) on delete set null,
  threshold_sales numeric     not null default 0,       -- hourly $ at/above which this slot is needed
  slot_order      integer     not null default 0,       -- display order (sheet row order)
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_staffing_matrix_restaurant on public.staffing_matrix(restaurant_id);

alter table public.staffing_matrix enable row level security;

-- Read by anyone with venue access; only roster managers edit the model.
create policy "staffing_matrix_select" on public.staffing_matrix
  for select using (public.has_restaurant_access(restaurant_id));
create policy "staffing_matrix_insert" on public.staffing_matrix
  for insert with check (public.has_roster_manage(restaurant_id));
create policy "staffing_matrix_update" on public.staffing_matrix
  for update using (public.has_roster_manage(restaurant_id));
create policy "staffing_matrix_delete" on public.staffing_matrix
  for delete using (public.has_roster_manage(restaurant_id));

create trigger staffing_matrix_updated_at
  before update on public.staffing_matrix
  for each row execute function public.handle_updated_at();

-- ── Per-venue config (one row per restaurant) ────────────────────────────────
create table if not exists public.staffing_config (
  restaurant_id         uuid        primary key references public.restaurants(id) on delete cascade,
  ly_weight             numeric     not null default 0.5,   -- weight: same weekday last year
  lw_weight             numeric     not null default 0.5,   -- weight: same weekday last week
  growth_pct            numeric     not null default 0,     -- manual growth % on top (5 = +5%)
  growth_auto           boolean     not null default true,  -- compute growth from data; fall back to growth_pct
  open_hour             smallint    not null default 10,    -- local hour the venue opens
  close_hour            smallint    not null default 21,    -- local hour the venue closes (exclusive)
  min_shift_hours       numeric     not null default 3,     -- shifts must be at least this long
  break_threshold_hours numeric     not null default 5,     -- shifts LONGER than this get a break
  break_minutes         integer     not null default 30,    -- unpaid break added to long shifts
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.staffing_config enable row level security;

create policy "staffing_config_select" on public.staffing_config
  for select using (public.has_restaurant_access(restaurant_id));
create policy "staffing_config_insert" on public.staffing_config
  for insert with check (public.has_roster_manage(restaurant_id));
create policy "staffing_config_update" on public.staffing_config
  for update using (public.has_roster_manage(restaurant_id));
create policy "staffing_config_delete" on public.staffing_config
  for delete using (public.has_roster_manage(restaurant_id));

create trigger staffing_config_updated_at
  before update on public.staffing_config
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- END OF MIGRATION 059
-- ============================================================================
