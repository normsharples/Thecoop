-- ============================================================================
-- The Coop - Phase 2: Data Integrations
-- Migration 004 — Integration tables, source tracking, extended columns
-- ============================================================================

-- ============================================================================
-- 1. EXTEND SALES_DAILY
-- ============================================================================

-- Source column already exists as nullable text — make it NOT NULL with default
-- and add check constraint, plus new Phase 2 columns

update public.sales_daily set source = 'manual' where source is null;
alter table public.sales_daily alter column source set not null;
alter table public.sales_daily alter column source set default 'manual';

do $$
begin
  begin
    alter table public.sales_daily
      add constraint sales_daily_source_check
      check (source in ('lightspeed', 'manual', 'override'));
  exception when duplicate_object then null;
  end;
end $$;

alter table public.sales_daily add column if not exists net_sales        numeric;
alter table public.sales_daily add column if not exists sales_by_category jsonb;
alter table public.sales_daily add column if not exists sales_by_hour    jsonb;
alter table public.sales_daily add column if not exists manual_notes     text;
alter table public.sales_daily add column if not exists entered_by       uuid references public.profiles(id) on delete set null;

-- ============================================================================
-- 2. EXTEND LABOUR_DAILY
-- ============================================================================

update public.labour_daily set source = 'manual' where source is null;
alter table public.labour_daily alter column source set not null;
alter table public.labour_daily alter column source set default 'manual';

do $$
begin
  begin
    alter table public.labour_daily
      add constraint labour_daily_source_check
      check (source in ('deputy', 'manual', 'override'));
  exception when duplicate_object then null;
  end;
end $$;

alter table public.labour_daily add column if not exists scheduled_hours numeric;
alter table public.labour_daily add column if not exists overtime_hours  numeric;
alter table public.labour_daily add column if not exists hours_by_role   jsonb;
alter table public.labour_daily add column if not exists manual_notes    text;
alter table public.labour_daily add column if not exists entered_by      uuid references public.profiles(id) on delete set null;

-- ============================================================================
-- 3. EXTEND GOOGLE_REVIEWS (add external ID for dedup on sync)
-- ============================================================================

alter table public.google_reviews add column if not exists google_review_id text;
alter table public.google_reviews add column if not exists source text not null default 'google' check (source in ('google', 'manual'));

create unique index if not exists idx_google_reviews_google_id
  on public.google_reviews(google_review_id)
  where google_review_id is not null;

-- ============================================================================
-- 4. INTEGRATION_CREDENTIALS (per restaurant, per provider)
-- ============================================================================

create table if not exists public.integration_credentials (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid references public.restaurants(id) on delete cascade,
  provider        text not null,
  credentials     jsonb not null default '{}',
  is_manual_only  boolean not null default false,
  last_sync_at    timestamptz,
  sync_status     text not null default 'never'
    check (sync_status in ('never', 'success', 'error', 'syncing')),
  sync_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, provider)
);

create index if not exists idx_integration_credentials_restaurant
  on public.integration_credentials(restaurant_id);
create index if not exists idx_integration_credentials_provider
  on public.integration_credentials(provider);

alter table public.integration_credentials enable row level security;

create policy "integration_credentials_select" on public.integration_credentials
  for select using (public.is_superadmin());

create policy "integration_credentials_insert" on public.integration_credentials
  for insert with check (public.is_superadmin());

create policy "integration_credentials_update" on public.integration_credentials
  for update using (public.is_superadmin());

create policy "integration_credentials_delete" on public.integration_credentials
  for delete using (public.is_superadmin());

create trigger integration_credentials_updated_at
  before update on public.integration_credentials
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 5. INTEGRATION_SETTINGS (global, per provider — Deputy, Google Business)
-- ============================================================================

create table if not exists public.integration_settings (
  id           uuid primary key default uuid_generate_v4(),
  provider     text not null unique,
  credentials  jsonb not null default '{}',
  config       jsonb not null default '{}',
  last_sync_at timestamptz,
  sync_status  text not null default 'never'
    check (sync_status in ('never', 'success', 'error', 'syncing')),
  sync_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.integration_settings enable row level security;

create policy "integration_settings_select" on public.integration_settings
  for select using (public.is_superadmin());

create policy "integration_settings_insert" on public.integration_settings
  for insert with check (public.is_superadmin());

create policy "integration_settings_update" on public.integration_settings
  for update using (public.is_superadmin());

create policy "integration_settings_delete" on public.integration_settings
  for delete using (public.is_superadmin());

create trigger integration_settings_updated_at
  before update on public.integration_settings
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 6. SYNC_LOGS
-- ============================================================================

create table if not exists public.sync_logs (
  id              uuid primary key default uuid_generate_v4(),
  provider        text not null,
  restaurant_id   uuid references public.restaurants(id) on delete set null,
  status          text not null check (status in ('success', 'error', 'skipped')),
  records_synced  integer not null default 0,
  error_message   text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists idx_sync_logs_provider     on public.sync_logs(provider);
create index if not exists idx_sync_logs_started_at   on public.sync_logs(started_at desc);
create index if not exists idx_sync_logs_restaurant   on public.sync_logs(restaurant_id);

alter table public.sync_logs enable row level security;

create policy "sync_logs_select" on public.sync_logs
  for select using (public.is_superadmin());

create policy "sync_logs_insert" on public.sync_logs
  for insert with check (public.is_superadmin());

-- sync_logs are append-only; no update/delete policies

-- ============================================================================
-- 7. SEED DEFAULT INTEGRATION CREDENTIALS FOR GMHBA (manual only)
-- ============================================================================

insert into public.integration_credentials (restaurant_id, provider, is_manual_only)
values ('aaa00000-0000-0000-0000-000000000003', 'lightspeed', true)
on conflict (restaurant_id, provider) do nothing;
