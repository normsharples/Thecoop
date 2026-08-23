-- ============================================================================
-- 057. SALES TRANSACTIONS  (hourly Sales-by-Hour feed)
-- ----------------------------------------------------------------------------
-- One row per individual sale scraped from the Lightspeed (Kounta) Sales Feed
-- at https://my.kounta.com/sale. Written by the new `salesfeed-sync` scraper,
-- which runs HOURLY during trading hours (separate from the nightly
-- lightspeed-sync that writes daily totals into `sales_daily`).
--
-- WHY a per-transaction table rather than pre-aggregated hourly buckets:
--   • Dedup is trivial and bullet-proof — the unique (restaurant_id,
--     transaction_ref) key means re-scraping the same sale just upserts the
--     same row, so a transaction can never be counted twice even though the
--     scraper re-reads overlapping feed pages every hour.
--   • The Sales-by-Hour report is a plain GROUP BY hour; we can also slice by
--     day, order type, or staff later without re-scraping.
--
-- The scraper computes business_date + hour in Australia/Melbourne time and
-- writes them denormalized, so the report needs no timezone math in SQL.
-- ============================================================================

create table if not exists public.sales_transactions (
  id               uuid        primary key default uuid_generate_v4(),
  restaurant_id    uuid        not null references public.restaurants(id) on delete cascade,

  -- Kounta's own sale identifier (receipt / sale number as shown in the feed).
  -- Unique per venue — the dedup key. Stored as text because Kounta refs can be
  -- non-numeric / prefixed.
  transaction_ref  text        not null,

  sold_at          timestamptz not null,          -- full sale timestamp (UTC-stored)
  business_date    date        not null,          -- local Melbourne date (grouping)
  hour             smallint    not null check (hour between 0 and 23), -- local hour 0-23

  amount           numeric     not null default 0,-- sale Total (AUD, incl. tax) — the "Total" column
  net_amount       numeric,                        -- "Net Amount" column (ex-tax)
  tax_amount       numeric,                        -- "Tax Amount" column
  tip_amount       numeric,                        -- "Tip Amount" column
  surcharge_amount numeric,                        -- "Payments Surcharge" column
  sale_number      text,                           -- human sale no. (e.g. SP-233 / 044736026)
  terminal         text,                           -- "Terminal" column (e.g. POS 1)
  customer         text,                           -- "Customer" column, if present
  order_type       text,                           -- 'pos' (SP-…) or 'online' (0447…), inferred from sale_number
  staff            text,                           -- "Operator" column
  item_count       integer,                        -- reserved (not in the feed grid)
  raw              jsonb,                          -- raw scraped row for debugging / future use

  scraped_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (restaurant_id, transaction_ref)
);

comment on table  public.sales_transactions is
  'Individual sales scraped hourly from the Lightspeed/Kounta Sales Feed. One row per sale; (restaurant_id, transaction_ref) is unique so re-scraping never double-counts. Powers the Sales-by-Hour report.';
comment on column public.sales_transactions.transaction_ref is
  'Kounta sale/receipt number as shown in the sales feed. Unique per venue — the dedup key.';
comment on column public.sales_transactions.sold_at is
  'Full timestamp the sale was completed (stored UTC).';
comment on column public.sales_transactions.business_date is
  'Local Melbourne calendar date of the sale — group the Sales-by-Hour report on this.';
comment on column public.sales_transactions.hour is
  'Local Melbourne hour 0-23 the sale fell in.';

-- Report queries hit (venue, date) and (venue, date, hour); sold_at for ordering.
create index if not exists idx_sales_transactions_venue_date
  on public.sales_transactions(restaurant_id, business_date);
create index if not exists idx_sales_transactions_venue_date_hour
  on public.sales_transactions(restaurant_id, business_date, hour);
create index if not exists idx_sales_transactions_sold_at
  on public.sales_transactions(sold_at);

alter table public.sales_transactions enable row level security;

-- Same access model as sales data elsewhere: users see/write venues they have
-- access to; only superadmins can delete. The scraper uses the service-role key
-- (bypasses RLS) so it needs no policy of its own.
create policy "sales_transactions_select" on public.sales_transactions
  for select using (public.has_restaurant_access(restaurant_id));
create policy "sales_transactions_insert" on public.sales_transactions
  for insert with check (public.has_restaurant_access(restaurant_id));
create policy "sales_transactions_update" on public.sales_transactions
  for update using (public.has_restaurant_access(restaurant_id));
create policy "sales_transactions_delete" on public.sales_transactions
  for delete using (public.is_superadmin());

create trigger sales_transactions_updated_at
  before update on public.sales_transactions
  for each row execute function public.handle_updated_at();
