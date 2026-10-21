-- 096_daily_store_sheet.sql
-- Daily Store Sheet: per-venue end-of-day shift summary + nightly email config.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. daily_store_sheets — one per venue per day ──────────────────────────

create table if not exists public.daily_store_sheets (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  sheet_date    date not null,
  shift_notes   text,
  recorded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint daily_store_sheets_unique unique (restaurant_id, sheet_date)
);

comment on table public.daily_store_sheets is
  'End-of-day shift summary filled by the closing supervisor. One per venue per day.';

-- Index for fast lookups by venue + date range
create index if not exists idx_daily_store_sheets_restaurant_date
  on public.daily_store_sheets (restaurant_id, sheet_date desc);

-- ── 2. daily_store_sheet_settings — per-brand email config ─────────────────

create table if not exists public.daily_store_sheet_settings (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  enabled          boolean not null default true,
  send_time        text not null default '22:00',  -- HH:MM in AEST, 30-min increments
  recipients       text[] not null default '{}',   -- array of profile IDs (uuid as text)
  include_sales    boolean not null default true,
  include_delivery boolean not null default true,
  include_yoy      boolean not null default true,
  include_projections boolean not null default true,
  include_cashup   boolean not null default true,
  include_notes    boolean not null default true,
  include_reviews  boolean not null default true,
  review_lookback_days integer not null default 7,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint daily_store_sheet_settings_brand_unique unique (brand_id)
);

comment on table public.daily_store_sheet_settings is
  'Per-brand configuration for the nightly Daily Store Sheet email.';

-- ── 3. RLS policies ────────────────────────────────────────────────────────

alter table public.daily_store_sheets enable row level security;
alter table public.daily_store_sheet_settings enable row level security;

-- daily_store_sheets: read if superadmin or venue in restaurant_access
create policy "daily_store_sheets_select"
  on public.daily_store_sheets for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'superadmin'
          or p.role = 'area_manager'
          or daily_store_sheets.restaurant_id = any(p.restaurant_access)
        )
    )
  );

-- daily_store_sheets: insert/update if superadmin, area_manager, manager, or shift_supervisor with venue access
create policy "daily_store_sheets_insert"
  on public.daily_store_sheets for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'area_manager', 'manager', 'shift_supervisor')
        and (
          p.role = 'superadmin'
          or daily_store_sheets.restaurant_id = any(p.restaurant_access)
        )
    )
  );

create policy "daily_store_sheets_update"
  on public.daily_store_sheets for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'area_manager', 'manager', 'shift_supervisor')
        and (
          p.role = 'superadmin'
          or daily_store_sheets.restaurant_id = any(p.restaurant_access)
        )
    )
  );

-- daily_store_sheet_settings: only superadmin can read/write
create policy "daily_store_sheet_settings_select"
  on public.daily_store_sheet_settings for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'area_manager')
    )
  );

create policy "daily_store_sheet_settings_insert"
  on public.daily_store_sheet_settings for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'superadmin'
    )
  );

create policy "daily_store_sheet_settings_update"
  on public.daily_store_sheet_settings for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'superadmin'
    )
  );

-- ── 4. Updated_at trigger ──────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_daily_store_sheets_updated_at
  before update on public.daily_store_sheets
  for each row execute function public.set_updated_at();

create trigger set_daily_store_sheet_settings_updated_at
  before update on public.daily_store_sheet_settings
  for each row execute function public.set_updated_at();
