-- ============================================================================
-- 070. ASK — rollup functions
-- ----------------------------------------------------------------------------
-- Migration 069 gave the assistant per-day and per-day-per-hour rows. That is
-- the right shape for "how did Tuesday go", and the wrong shape for "which
-- hour makes us the most money" — two months of hourly rows is ~640 rows the
-- model has to hold in its head to produce twelve numbers, and it falls over.
--
-- These two functions do that grouping in Postgres, where it belongs. "Which
-- hour is best over the last two months" becomes 12 rows per venue, and "which
-- day of the week is busiest" becomes 7.
--
-- Requires: 069_ask_reporting.sql
-- ============================================================================

-- ============================================================================
-- 1. HOURLY PROFILE — the trading curve across a range
-- ============================================================================

create or replace function public.ask_hourly_profile(
  p_from           date,
  p_to             date,
  p_restaurant_ids uuid[] default null
)
returns table (
  restaurant_id  uuid,
  venue          text,
  hour           smallint,
  days_counted   integer,
  gross_sales    numeric,
  net_sales      numeric,
  delivery_sales numeric,
  orders         integer,
  avg_gross_per_day numeric,
  pct_of_day     numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with pos as (
    select t.restaurant_id, t.hour,
           count(distinct t.business_date)::integer         as days_counted,
           sum(coalesce(t.amount, t.net_amount, 0))         as gross,
           sum(coalesce(t.net_amount, t.amount, 0))         as net,
           count(*)::integer                                as orders
    from public.sales_transactions t
    where t.business_date between p_from and p_to
      and (p_restaurant_ids is null or t.restaurant_id = any(p_restaurant_ids))
    group by 1, 2
  ),
  del as (
    select d.restaurant_id, d.hour,
           sum(coalesce(d.net_amount, d.amount, 0)) as delivery
    from public.delivery_orders d
    where d.business_date between p_from and p_to
      and (p_restaurant_ids is null or d.restaurant_id = any(p_restaurant_ids))
      and coalesce(d.status, '') !~* 'cancel|refund'
    group by 1, 2
  ),
  joined as (
    select
      coalesce(pos.restaurant_id, del.restaurant_id) as rid,
      coalesce(pos.hour, del.hour)                   as hr,
      coalesce(pos.days_counted, 0)                  as days_counted,
      coalesce(pos.gross, 0)                         as gross,
      coalesce(pos.net, 0)                           as net,
      coalesce(del.delivery, 0)                      as delivery,
      coalesce(pos.orders, 0)                        as orders
    from pos
    full outer join del
      on del.restaurant_id = pos.restaurant_id and del.hour = pos.hour
  )
  select
    j.rid,
    r.name,
    j.hr,
    j.days_counted,
    round(j.gross, 2),
    round(j.net, 2),
    round(j.delivery, 2),
    j.orders,
    case when j.days_counted > 0 then round(j.gross / j.days_counted, 2) end,
    round(
      100 * j.gross / nullif(sum(j.gross) over (partition by j.rid), 0),
      1
    )
  from joined j
  join public.restaurants r on r.id = j.rid
  order by r.name, j.hr;
$$;

comment on function public.ask_hourly_profile is
  'The trading curve: sales totalled BY HOUR across a date range, per venue, with each hour''s share of the day. ~12-14 rows per venue rather than one per date-hour. Use for "which hour makes the most money".';

-- ============================================================================
-- 2. WEEKDAY PROFILE — which day of the week trades best
-- ============================================================================

create or replace function public.ask_weekday_profile(
  p_from           date,
  p_to             date,
  p_restaurant_ids uuid[] default null
)
returns table (
  restaurant_id     uuid,
  venue             text,
  day_of_week       smallint,
  weekday           text,
  days_counted      integer,
  total_gross       numeric,
  avg_gross_per_day numeric,
  avg_net_per_day   numeric,
  avg_transactions  integer,
  best_day          date,
  best_day_gross    numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.restaurant_id,
    r.name,
    extract(dow from s.date)::smallint,
    trim(to_char(s.date, 'Day')),
    count(*)::integer,
    round(sum(coalesce(s.total_sales, 0)), 2),
    round(avg(coalesce(s.total_sales, 0)), 2),
    round(avg(coalesce(s.net_sales, s.total_sales, 0)), 2),
    round(avg(coalesce(s.transaction_count, 0)))::integer,
    (array_agg(s.date order by coalesce(s.total_sales, 0) desc))[1],
    round(max(coalesce(s.total_sales, 0)), 2)
  from public.sales_daily s
  join public.restaurants r on r.id = s.restaurant_id
  where s.date between p_from and p_to
    and (p_restaurant_ids is null or s.restaurant_id = any(p_restaurant_ids))
  group by s.restaurant_id, r.name, extract(dow from s.date), trim(to_char(s.date, 'Day'))
  order by r.name, extract(dow from s.date);
$$;

comment on function public.ask_weekday_profile is
  'Sales grouped by day of the week across a range, per venue, with each weekday''s average and its single best day. 7 rows per venue. Use for "which day of the week is busiest".';

-- ============================================================================
-- GRANTS
-- ============================================================================

revoke execute on function public.ask_hourly_profile(date, date, uuid[])  from public;
revoke execute on function public.ask_weekday_profile(date, date, uuid[]) from public;

grant  execute on function public.ask_hourly_profile(date, date, uuid[])  to authenticated;
grant  execute on function public.ask_weekday_profile(date, date, uuid[]) to authenticated;
