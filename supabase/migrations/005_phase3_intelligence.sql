-- ============================================================================
-- The Coop - Phase 3: Intelligence Layer
-- Migration 005 — Targets v2, Alert Configs v2, Alert History, App Settings
-- ============================================================================

-- ============================================================================
-- 1. REPLACE TARGETS TABLE
--    Phase 1 schema used target_value/amber_threshold/red_threshold.
--    Phase 3 uses value + day_of_week with a composite unique constraint.
-- ============================================================================

drop table if exists public.targets cascade;

create table public.targets (
  id            uuid        primary key default uuid_generate_v4(),
  restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
  metric        text        not null,
  period        text        not null default 'current',
  day_of_week   integer     check (day_of_week >= 0 and day_of_week <= 6),
  value         numeric     not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, metric, period, day_of_week)
);

create index idx_targets_restaurant on public.targets(restaurant_id);
create index idx_targets_metric     on public.targets(metric);

alter table public.targets enable row level security;

-- Anyone authenticated can read targets (needed for Pulse, Leaderboard)
create policy "targets_select" on public.targets
  for select using (true);

create policy "targets_insert" on public.targets
  for insert with check (public.is_superadmin());

create policy "targets_update" on public.targets
  for update using (public.is_superadmin());

create policy "targets_delete" on public.targets
  for delete using (public.is_superadmin());

create trigger targets_updated_at
  before update on public.targets
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 2. REPLACE ALERT_CONFIGS TABLE
--    Phase 1 schema was per-restaurant with metric/condition/threshold.
--    Phase 3 uses global alert types with per-restaurant overrides as JSONB.
-- ============================================================================

drop table if exists public.alert_configs cascade;

create table public.alert_configs (
  id                   uuid        primary key default uuid_generate_v4(),
  alert_type           text        not null,
  enabled              boolean     not null default true,
  global_threshold     jsonb       not null,
  restaurant_overrides jsonb       not null default '{}',
  recipients           uuid[]      not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (alert_type)
);

alter table public.alert_configs enable row level security;

create policy "alert_configs_select" on public.alert_configs
  for select using (auth.uid() is not null);

create policy "alert_configs_insert" on public.alert_configs
  for insert with check (public.is_superadmin());

create policy "alert_configs_update" on public.alert_configs
  for update using (public.is_superadmin());

create policy "alert_configs_delete" on public.alert_configs
  for delete using (public.is_superadmin());

create trigger alert_configs_updated_at
  before update on public.alert_configs
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 3. ALERT HISTORY
--    Append-only log of triggered alerts per restaurant per day.
--    Deduplication enforced by process-alerts function (one per type/restaurant/day).
-- ============================================================================

create table if not exists public.alert_history (
  id               uuid        primary key default uuid_generate_v4(),
  alert_type       text        not null,
  restaurant_id    uuid        not null references public.restaurants(id) on delete cascade,
  severity         text        not null check (severity in ('warning', 'urgent', 'critical')),
  title            text        not null,
  message          text        not null,
  metric_value     numeric,
  threshold_value  numeric,
  triggered_at     timestamptz not null default now(),
  acknowledged     boolean     not null default false,
  acknowledged_by  uuid        references public.profiles(id) on delete set null,
  acknowledged_at  timestamptz,
  email_sent       boolean     not null default false,
  email_sent_at    timestamptz
);

create index idx_alert_history_restaurant   on public.alert_history(restaurant_id);
create index idx_alert_history_triggered_at on public.alert_history(triggered_at desc);
create index idx_alert_history_acknowledged on public.alert_history(acknowledged);
create index idx_alert_history_type         on public.alert_history(alert_type);

alter table public.alert_history enable row level security;

create policy "alert_history_select" on public.alert_history
  for select using (
    public.is_superadmin()
    or public.has_restaurant_access(restaurant_id)
  );

create policy "alert_history_insert" on public.alert_history
  for insert with check (public.is_superadmin());

create policy "alert_history_update" on public.alert_history
  for update using (
    public.is_superadmin()
    or public.has_restaurant_access(restaurant_id)
  );


-- ============================================================================
-- 4. APP SETTINGS
--    Key/value store for global configuration: leaderboard weights, etc.
-- ============================================================================

create table if not exists public.app_settings (
  id         uuid        primary key default uuid_generate_v4(),
  key        text        not null unique,
  value      jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "app_settings_select" on public.app_settings
  for select using (auth.uid() is not null);

create policy "app_settings_insert" on public.app_settings
  for insert with check (public.is_superadmin());

create policy "app_settings_update" on public.app_settings
  for update using (public.is_superadmin());

create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 5. SEED ALERT CONFIGS
-- ============================================================================

insert into public.alert_configs (alert_type, enabled, global_threshold, recipients) values
  ('sales_dip',         true,  '{"percentage": 80}',      '{}'),
  ('labour_spike',      true,  '{"percentage": 35}',      '{}'),
  ('bad_review',        true,  '{"stars": 2}',            '{}'),
  ('overtime_warning',  true,  '{"hours": 38}',           '{}'),
  ('low_transactions',  true,  '{"percentage": 80}',      '{}'),
  ('missing_deposit',   true,  '{"business_days": 2}',    '{}'),
  ('overdue_whs_audit', false, '{"days_overdue": 0}',     '{}'),
  ('serious_incident',  false, '{"severity": "serious"}', '{}')
on conflict (alert_type) do nothing;


-- ============================================================================
-- 6. SEED APP SETTINGS (leaderboard weights + visibility settings)
--    Phase 3 effective weights (food_cost/checklists/waste/whs disabled):
--    Sales 31.25%, Labour 25%, Rating 25%, Transactions 18.75%
-- ============================================================================

insert into public.app_settings (key, value) values
  ('leaderboard_weights', '{
    "sales": 31.25,
    "labour": 25.0,
    "rating": 25.0,
    "transactions": 18.75,
    "food_cost": 0,
    "checklists": 0,
    "waste": 0,
    "whs": 0
  }')
on conflict (key) do nothing;

insert into public.app_settings (key, value) values
  ('leaderboard_settings', '{
    "allow_manager_view": true,
    "grace_period_days": 30
  }')
on conflict (key) do nothing;
