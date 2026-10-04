-- ============================================================================
-- 087 — Square POS
--   Venues on Square (any business, any brand) sync their sales through the
--   sync-square edge function. Credentials live in integration_credentials with
--   provider = 'square' (superadmin-only, like Lightspeed):
--     { access_token, environment: 'production'|'sandbox',
--       location_id, location_name, timezone }
--
--   Square writes the same tables Lightspeed does, so every report works:
--     sales_daily          daily totals (source = 'square')
--     sales_transactions   one row per order  → Sales by Hour, Daily Activity
--     sales_mix_daily      category + product → Sales Mix
--
--   Safe to re-run.
-- ============================================================================

-- Columns the daily totals use. Some came in earlier migrations that may not
-- have been applied to every database — add them here so they're guaranteed.
alter table public.sales_daily
  add column if not exists net_sales                    numeric,
  add column if not exists sales_by_category            jsonb,
  add column if not exists sales_by_hour                jsonb,
  add column if not exists discounts_amount             numeric not null default 0,
  add column if not exists discounts_count              integer not null default 0,
  add column if not exists refunds_amount               numeric not null default 0,
  add column if not exists refunds_count                integer not null default 0,
  add column if not exists online_sales                 numeric,
  add column if not exists online_transaction_count     integer,
  add column if not exists online_average_transaction   numeric,
  add column if not exists delivery_sales               numeric not null default 0,
  add column if not exists delivery_transaction_count   integer not null default 0,
  add column if not exists delivery_average_transaction numeric not null default 0;

alter table public.sales_daily drop constraint if exists sales_daily_source_check;
alter table public.sales_daily
  add constraint sales_daily_source_check
  check (source in ('lightspeed', 'square', 'manual', 'override'));

-- Make PostgREST see the new columns straight away.
notify pgrst, 'reload schema';

-- Optional: keep today's numbers live. Runs every 30 min and re-syncs today +
-- yesterday for every Square venue. Needs pg_cron + pg_net enabled, and your
-- project URL + service-role key filled in:
--
--   select cron.schedule('coop-square-sync', '*/30 * * * *', $$
--     select net.http_post(
--       url     := 'https://YOUR-PROJECT.supabase.co/functions/v1/sync-square',
--       headers := jsonb_build_object(
--                    'Content-Type', 'application/json',
--                    'Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY'),
--       body    := '{"action":"sync"}'::jsonb
--     );
--   $$);
