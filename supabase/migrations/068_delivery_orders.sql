-- ============================================================================
-- 068. DELIVERY ORDERS  (hourly delivery feed — Uber Eats et al.)
-- ----------------------------------------------------------------------------
-- Deliberately a MIRROR of `sales_transactions` (migration 057): one row per
-- order, deduped on a platform order id, with the local Melbourne
-- business_date + hour denormalised so a report is a plain GROUP BY hour.
-- Written by an hourly delivery scraper (same shape as `salesfeed-sync`), so
-- re-reading overlapping pages every hour can never double-count an order.
--
-- Why not reuse sales_daily.delivery_sales (migration 024)? That column is a
-- DAILY total from the Uber sales sync — it can't answer "how much delivery did
-- we do at 7pm", which is what the Pulse report needs.
--
-- Scraper contract (what the writer must set):
--   restaurant_id  the venue the order belongs to
--   platform       'uber' | 'doordash' | 'menulog' | 'other'
--   order_ref      the platform's own order id — the dedup key. Upsert on
--                  (restaurant_id, platform, order_ref).
--   placed_at      full timestamp (UTC-stored)
--   business_date  local Melbourne date  ─┐ computed by the scraper, DST-correct,
--   hour           local Melbourne hour  ─┘ exactly like salesfeed-sync does it
--   amount         gross order value (AUD, incl. tax) — the sales figure shown
--   net_amount     ex-GST, when the platform reports it
-- Everything else is optional.
-- ============================================================================

create table if not exists public.delivery_orders (
  id               uuid        primary key default uuid_generate_v4(),
  restaurant_id    uuid        not null references public.restaurants(id) on delete cascade,

  platform         text        not null default 'uber'
                     check (platform in ('uber', 'doordash', 'menulog', 'other')),

  -- Platform order id — the dedup key (unique per venue + platform).
  order_ref        text        not null,
  order_number     text,                            -- human-facing short code, if any

  placed_at        timestamptz not null,            -- full order timestamp (UTC-stored)
  business_date    date        not null,            -- local Melbourne date (grouping)
  hour             smallint    not null check (hour between 0 and 23), -- local hour 0-23

  amount           numeric     not null default 0,  -- gross order value (AUD, incl. tax)
  net_amount       numeric,                          -- ex-GST, if the platform reports it
  tax_amount       numeric,
  fees_amount      numeric,                          -- platform commission / fees
  payout_amount    numeric,                          -- expected payout after fees
  status           text,                             -- delivered / cancelled / refunded …
  customer         text,
  item_count       integer,
  raw              jsonb,                            -- raw scraped row, for debugging

  scraped_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (restaurant_id, platform, order_ref)
);

comment on table public.delivery_orders is
  'Individual delivery-platform orders scraped hourly. One row per order; (restaurant_id, platform, order_ref) is unique so re-scraping never double-counts. Powers the Delivery column of the Pulse report.';
comment on column public.delivery_orders.order_ref is
  'The delivery platform''s own order id — the dedup key. Upsert on (restaurant_id, platform, order_ref).';
comment on column public.delivery_orders.business_date is
  'Local Melbourne calendar date of the order — group hourly reports on this.';
comment on column public.delivery_orders.hour is
  'Local Melbourne hour 0-23 the order fell in.';

create index if not exists idx_delivery_orders_venue_date
  on public.delivery_orders(restaurant_id, business_date);
create index if not exists idx_delivery_orders_venue_date_hour
  on public.delivery_orders(restaurant_id, business_date, hour);
create index if not exists idx_delivery_orders_placed_at
  on public.delivery_orders(placed_at);

alter table public.delivery_orders enable row level security;

-- Same access model as sales_transactions: users see/write venues they have
-- access to; only superadmins delete. The scraper uses the service-role key
-- (bypasses RLS) so it needs no policy of its own.
create policy "delivery_orders_select" on public.delivery_orders
  for select using (public.has_restaurant_access(restaurant_id));
create policy "delivery_orders_insert" on public.delivery_orders
  for insert with check (public.has_restaurant_access(restaurant_id));
create policy "delivery_orders_update" on public.delivery_orders
  for update using (public.has_restaurant_access(restaurant_id));
create policy "delivery_orders_delete" on public.delivery_orders
  for delete using (public.is_superadmin());

create trigger delivery_orders_updated_at
  before update on public.delivery_orders
  for each row execute function public.handle_updated_at();
