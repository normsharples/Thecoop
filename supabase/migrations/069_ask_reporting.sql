-- ============================================================================
-- 069. ASK — reporting functions for the in-app AI assistant
-- ----------------------------------------------------------------------------
-- The `ask` edge function does NOT write SQL. It calls these functions, and
-- only these functions, through PostgREST **as the signed-in user**.
--
-- Why functions rather than letting the model query tables directly:
--   • Every function is SECURITY INVOKER, so the RLS policies on sales_daily,
--     labour_daily, sales_transactions, delivery_orders and targets apply
--     exactly as they do in the app. A manager asking about a venue they can't
--     see gets zero rows — the model has no way around it, because it never
--     holds the service-role key.
--   • The aggregation happens in Postgres, so a month-wide question returns a
--     few dozen rows instead of thousands, which keeps the answer fast and the
--     token cost small.
--   • The metric definitions live in ONE place. Gross/net/delivery/SPMH here
--     mean the same thing they mean on the Sales, Labour and Pulse reports,
--     so the assistant can never quietly disagree with the dashboard.
--
-- Metric definitions (mirrors src/hooks/usePulseHours.ts and the reports):
--   gross_sales     sales_daily.total_sales — what the till rang up, incl. GST
--   net_sales       sales_daily.net_sales — gross less tax, as lightspeed-sync
--                   writes it; falls back to gross when the sync didn't set it
--
-- NOTE: this database has no discounts_amount / refunds_amount columns
-- (migration 011 was never applied here, and nothing writes those figures), so
-- the assistant does not report on discounts or refunds. Adding the columns
-- would only give it permanent zeroes to quote.
--   delivery_sales  sales_daily.delivery_sales — Uber Eats et al.
--   online_sales    sales_daily.online_sales — web/app ordering
--   spmh            sales ÷ labour hours (Sales Per Man Hour)
--
-- Requires: 068_delivery_orders.sql
-- ============================================================================

do $$
begin
  if to_regclass('public.delivery_orders') is null then
    raise exception
      'Apply 068_delivery_orders.sql before 069 — the ask reporting functions read delivery_orders.';
  end if;
end $$;

-- ============================================================================
-- 1. VENUES — what the caller is allowed to ask about
-- ============================================================================

create or replace function public.ask_venues()
returns table (
  restaurant_id uuid,
  venue         text,
  address       text,
  status        text
)
language sql
stable
security invoker
set search_path = public
as $$
  select r.id, r.name, r.address, r.status
  from public.restaurants r
  order by r.name;
$$;

comment on function public.ask_venues is
  'Venues the calling user can see (RLS-scoped). The assistant calls this first to resolve names like "Torquay" to ids.';

-- ============================================================================
-- 2. DAILY SALES
-- ============================================================================

create or replace function public.ask_daily_sales(
  p_from           date,
  p_to             date,
  p_restaurant_ids uuid[] default null
)
returns table (
  restaurant_id   uuid,
  venue           text,
  date            date,
  weekday         text,
  gross_sales     numeric,
  net_sales       numeric,
  delivery_sales  numeric,
  online_sales    numeric,
  transactions    integer,
  avg_transaction numeric,
  source          text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.restaurant_id,
    r.name,
    s.date,
    trim(to_char(s.date, 'Day')),
    round(coalesce(s.total_sales, 0), 2),
    round(coalesce(s.net_sales, s.total_sales, 0), 2),
    round(coalesce(s.delivery_sales, 0), 2),
    round(coalesce(s.online_sales, 0), 2),
    coalesce(s.transaction_count, 0),
    round(coalesce(s.average_transaction, 0), 2),
    s.source
  from public.sales_daily s
  join public.restaurants r on r.id = s.restaurant_id
  where s.date between p_from and p_to
    and (p_restaurant_ids is null or s.restaurant_id = any(p_restaurant_ids))
  order by s.date, r.name;
$$;

comment on function public.ask_daily_sales is
  'One row per venue per day. gross_sales = till total incl. GST; net_sales = ex-tax; delivery_sales and online_sales are the channel splits. RLS-scoped.';

-- ============================================================================
-- 3. HOURLY SALES  (the Sales-by-Hour / Pulse feed)
-- ============================================================================

create or replace function public.ask_hourly_sales(
  p_from           date,
  p_to             date,
  p_restaurant_ids uuid[] default null
)
returns table (
  restaurant_id  uuid,
  venue          text,
  business_date  date,
  hour           smallint,
  gross_sales    numeric,
  net_sales      numeric,
  delivery_sales numeric,
  orders         integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with pos as (
    select t.restaurant_id, t.business_date, t.hour,
           sum(coalesce(t.amount, t.net_amount, 0))     as gross,
           sum(coalesce(t.net_amount, t.amount, 0))     as net,
           count(*)::integer                            as orders
    from public.sales_transactions t
    where t.business_date between p_from and p_to
      and (p_restaurant_ids is null or t.restaurant_id = any(p_restaurant_ids))
    group by 1,2,3
  ),
  del as (
    -- Delivery orders sit INSIDE the POS net total (the tills see them), which
    -- is why they are reported alongside, not added on. Same rule as Pulse.
    select d.restaurant_id, d.business_date, d.hour,
           sum(coalesce(d.net_amount, d.amount, 0)) as delivery
    from public.delivery_orders d
    where d.business_date between p_from and p_to
      and (p_restaurant_ids is null or d.restaurant_id = any(p_restaurant_ids))
      and coalesce(d.status, '') !~* 'cancel|refund'
    group by 1,2,3
  )
  select
    coalesce(pos.restaurant_id, del.restaurant_id),
    r.name,
    coalesce(pos.business_date, del.business_date),
    coalesce(pos.hour, del.hour),
    round(coalesce(pos.gross, 0), 2),
    round(coalesce(pos.net, 0), 2),
    round(coalesce(del.delivery, 0), 2),
    coalesce(pos.orders, 0)
  from pos
  full outer join del
    on  del.restaurant_id = pos.restaurant_id
    and del.business_date = pos.business_date
    and del.hour          = pos.hour
  join public.restaurants r
    on r.id = coalesce(pos.restaurant_id, del.restaurant_id)
  order by 3, 2, 4;
$$;

comment on function public.ask_hourly_sales is
  'Hourly sales per venue from the Kounta feed, with delivery reported alongside (delivery is a slice of net, not an addition). Melbourne local hours 0-23. RLS-scoped.';

-- ============================================================================
-- 4. LABOUR
-- ============================================================================

create or replace function public.ask_labour(
  p_from           date,
  p_to             date,
  p_restaurant_ids uuid[] default null
)
returns table (
  restaurant_id   uuid,
  venue           text,
  date            date,
  weekday         text,
  actual_hours    numeric,
  scheduled_hours numeric,
  overtime_hours  numeric,
  labour_cost     numeric,
  labour_percent  numeric,
  gross_sales     numeric,
  spmh            numeric,
  source          text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.restaurant_id,
    r.name,
    l.date,
    trim(to_char(l.date, 'Day')),
    round(coalesce(l.total_hours, 0), 2),
    round(l.scheduled_hours, 2),
    round(l.overtime_hours, 2),
    round(coalesce(l.total_cost, 0), 2),
    round(coalesce(l.labour_percent, 0), 2),
    round(coalesce(s.total_sales, 0), 2),
    case when coalesce(l.total_hours, 0) > 0
         then round(coalesce(s.total_sales, 0) / l.total_hours, 2) end,
    l.source
  from public.labour_daily l
  join public.restaurants r on r.id = l.restaurant_id
  left join public.sales_daily s
    on s.restaurant_id = l.restaurant_id and s.date = l.date
  where l.date between p_from and p_to
    and (p_restaurant_ids is null or l.restaurant_id = any(p_restaurant_ids))
  order by l.date, r.name;
$$;

comment on function public.ask_labour is
  'Daily labour per venue with the matching sales row, so labour % and SPMH (gross sales / actual hours) come back computed. RLS-scoped.';

-- ============================================================================
-- 5. TARGETS  (so the assistant can say "against target", not just a number)
-- ============================================================================

create or replace function public.ask_targets(
  p_restaurant_ids uuid[] default null
)
returns table (
  restaurant_id uuid,
  venue         text,
  metric        text,
  period        text,
  day_of_week   smallint,
  value         numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  -- `value` is the column the app writes; `target_value` is the original
  -- schema's name, still populated on rows created before migration 039.
  select t.restaurant_id, r.name, t.metric, t.period, t.day_of_week,
         coalesce(t.value, t.target_value)
  from public.targets t
  join public.restaurants r on r.id = t.restaurant_id
  where (p_restaurant_ids is null or t.restaurant_id = any(p_restaurant_ids))
    and coalesce(t.value, t.target_value) is not null
  order by r.name, t.metric, t.day_of_week nulls first;
$$;

comment on function public.ask_targets is
  'Configured targets per venue and metric. day_of_week is 0=Sunday..6=Saturday, null = applies to every day. RLS-scoped.';

-- ============================================================================
-- 6. PROJECTIONS  (what we said we would do, so variance is answerable)
-- ============================================================================

create or replace function public.ask_projections(
  p_from           date,
  p_to             date,
  p_restaurant_ids uuid[] default null
)
returns table (
  restaurant_id    uuid,
  venue            text,
  date             date,
  projected_sales  numeric,
  actual_sales     numeric,
  variance         numeric,
  variance_percent numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.restaurant_id,
    r.name,
    p.date,
    round(coalesce(p.projected_sales, 0), 2),
    round(coalesce(s.total_sales, 0), 2),
    round(coalesce(s.total_sales, 0) - coalesce(p.projected_sales, 0), 2),
    case when coalesce(p.projected_sales, 0) > 0
         then round(((coalesce(s.total_sales,0) - p.projected_sales) / p.projected_sales) * 100, 1) end
  from public.daily_projections p
  join public.restaurants r on r.id = p.restaurant_id
  left join public.sales_daily s
    on s.restaurant_id = p.restaurant_id and s.date = p.date
  where p.date between p_from and p_to
    and (p_restaurant_ids is null or p.restaurant_id = any(p_restaurant_ids))
  order by p.date, r.name;
$$;

comment on function public.ask_projections is
  'Projected vs actual sales per venue per day. RLS-scoped.';

-- ============================================================================
-- GRANTS — authenticated users only; RLS inside does the real scoping.
-- ============================================================================

-- Functions are granted to PUBLIC by default, so the revoke has to come first
-- or anon keeps an inherited EXECUTE. (RLS would still return nothing to an
-- anonymous caller — this just stops them from reaching the function at all.)
revoke execute on function public.ask_venues()                         from public;
revoke execute on function public.ask_daily_sales(date, date, uuid[])  from public;
revoke execute on function public.ask_hourly_sales(date, date, uuid[]) from public;
revoke execute on function public.ask_labour(date, date, uuid[])       from public;
revoke execute on function public.ask_targets(uuid[])                  from public;
revoke execute on function public.ask_projections(date, date, uuid[])  from public;

grant execute on function public.ask_venues()                          to authenticated;
grant execute on function public.ask_daily_sales(date, date, uuid[])   to authenticated;
grant execute on function public.ask_hourly_sales(date, date, uuid[])  to authenticated;
grant execute on function public.ask_labour(date, date, uuid[])        to authenticated;
grant execute on function public.ask_targets(uuid[])                   to authenticated;
grant execute on function public.ask_projections(date, date, uuid[])   to authenticated;
