# Daily Store Sheet — Deployment Steps

Run these 5 steps in order.

---

## Step 1: Clean up git locks & push branch

Open Terminal and run:

```bash
cd ~/Claude\ Code\ Files/The\ Coop/the-coop && rm -f .git/index.lock .git/*.lock.bak* && git push -u origin feature/daily-store-sheet
```

---

## Step 2: Run migration 096 in Supabase SQL Editor

Go to: https://supabase.com/dashboard/project/xivsbczrdnexxrrzdlxc/sql/new

Paste and run the contents of `supabase/migrations/096_daily_store_sheet.sql`
(or copy from below):

```sql
-- 096_daily_store_sheet.sql
-- Daily Store Sheet: per-venue end-of-day shift summary + nightly email config.

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

create index if not exists idx_daily_store_sheets_restaurant_date
  on public.daily_store_sheets (restaurant_id, sheet_date desc);

create table if not exists public.daily_store_sheet_settings (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  enabled          boolean not null default true,
  send_time        text not null default '22:00',
  recipients       text[] not null default '{}',
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

alter table public.daily_store_sheets enable row level security;
alter table public.daily_store_sheet_settings enable row level security;

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
```

---

## Step 3: Deploy the Edge Function

In Terminal:

```bash
cd ~/Claude\ Code\ Files/The\ Coop/the-coop && npx supabase functions deploy send-daily-store-sheet --project-ref xivsbczrdnexxrrzdlxc
```

---

## Step 4: Verify env vars

Go to: https://supabase.com/dashboard/project/xivsbczrdnexxrrzdlxc/settings/functions

Confirm these secrets exist (they should already be set from `process-alerts`):
- `RESEND_API_KEY`
- `ALERT_FROM_EMAIL`
- `APP_URL`

---

## Step 5: Set up pg_cron trigger

Go to: https://supabase.com/dashboard/project/xivsbczrdnexxrrzdlxc/sql/new

Paste and run:

```sql
-- Enable pg_cron if not already
create extension if not exists pg_cron with schema pg_catalog;

-- Schedule: fire every 30 minutes, the function self-filters by brand send_time
select cron.schedule(
  'send-daily-store-sheet',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://xivsbczrdnexxrrzdlxc.supabase.co/functions/v1/send-daily-store-sheet',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

---

All done! The nightly email will start firing once a brand has Daily Store Sheet settings configured in ORBIT's Settings page.
