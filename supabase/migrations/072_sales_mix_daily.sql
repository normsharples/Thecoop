-- ============================================================================
-- 072. SALES MIX DAILY  (full product + category mix from Insights dash 1216)
-- ----------------------------------------------------------------------------
-- Until now the nightly `sales-mix-sync` wrote only `sales_daily.sales_by_category`
-- (a JSONB array of {name, amount}). That answers "how much CHICKEN MEALS did we
-- sell" but nothing else: no quantities, no cost, no gross profit, no product
-- level at all, and JSONB can't be grouped or trended in SQL.
--
-- This table is the relational home for the whole mix, one row per
-- (venue, date, level, item). `level` = 'category' or 'product'. The scraper
-- upserts on that key, so re-running a night is idempotent and a backfill can
-- be replayed safely.
--
-- The JSONB columns on sales_daily are still written for backwards
-- compatibility with the existing Sales report — this table is the source of
-- truth for anything new.
--
-- Scraper contract (sales-mix-sync/sync.mjs):
--   restaurant_id   the venue
--   business_date   local Melbourne trading date the mix belongs to
--   level           'category' | 'product'
--   item_name       the POS Category name, or the Product name
--   sales_amount    the tile's "$ Sales" column — the figure everything sorts by
--   everything else optional; whatever the tile exposes gets filled in
-- ============================================================================

create table if not exists public.sales_mix_daily (
  id                uuid        primary key default uuid_generate_v4(),
  restaurant_id     uuid        not null references public.restaurants(id) on delete cascade,

  business_date     date        not null,          -- local Melbourne trading date
  level             text        not null
                      check (level in ('category', 'product')),
  item_name         text        not null,          -- category name, or product name
  category_name     text,                          -- for products: parent category, when the tile exposes it

  quantity          numeric,                       -- Total Quantity
  sales_amount      numeric     not null default 0,-- $ Sales
  tax_amount        numeric,                       -- Total Tax
  cost_amount       numeric,                       -- Cost
  num_sales         numeric,                       -- # of Sales
  num_products      numeric,                       -- # of products (category rows only)
  pct_quantity      numeric,                       -- % of Quantity
  pct_sales         numeric,                       -- % of Sale Amount
  gross_profit_pct  numeric,                       -- Gross Profit %

  raw               jsonb,                         -- every cell as scraped, keyed by header

  scraped_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (restaurant_id, business_date, level, item_name)
);

comment on table public.sales_mix_daily is
  'Daily sales mix from Lightspeed Insights dashboard 1216 (Product sales). One row per venue/date/level/item; level is category or product. Upsert key is (restaurant_id, business_date, level, item_name) so a re-run or backfill never duplicates.';
comment on column public.sales_mix_daily.level is
  'category = the Sales By Category tile; product = the Sales By Product tile.';
comment on column public.sales_mix_daily.sales_amount is
  'The tile''s "$ Sales" column for this item, as Lightspeed reports it.';
comment on column public.sales_mix_daily.raw is
  'Every column of the scraped row keyed by its header name — so a new Looker column is captured even before this table gains a column for it.';

create index if not exists idx_sales_mix_daily_venue_date
  on public.sales_mix_daily(restaurant_id, business_date);
create index if not exists idx_sales_mix_daily_venue_date_level
  on public.sales_mix_daily(restaurant_id, business_date, level);
create index if not exists idx_sales_mix_daily_item
  on public.sales_mix_daily(level, item_name);

alter table public.sales_mix_daily enable row level security;

-- Same access model as sales_transactions / delivery_orders. The scraper uses
-- the service-role key (bypasses RLS) so it needs no policy of its own.
create policy "sales_mix_daily_select" on public.sales_mix_daily
  for select using (public.has_restaurant_access(restaurant_id));
create policy "sales_mix_daily_insert" on public.sales_mix_daily
  for insert with check (public.has_restaurant_access(restaurant_id));
create policy "sales_mix_daily_update" on public.sales_mix_daily
  for update using (public.has_restaurant_access(restaurant_id));
create policy "sales_mix_daily_delete" on public.sales_mix_daily
  for delete using (public.is_superadmin());

create trigger sales_mix_daily_updated_at
  before update on public.sales_mix_daily
  for each row execute function public.handle_updated_at();
