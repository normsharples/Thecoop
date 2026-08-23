-- ============================================================================
-- 062. ROSTER WEEKDAY HOURLY SHAPES (RPC)
-- ----------------------------------------------------------------------------
-- The roster projection needs, for each weekday, the sales-by-hour split of the
-- most recent completed date of that weekday. Doing that in the client meant
-- pulling every raw transaction over a ~12-week window — which Supabase caps at
-- 1000 rows, silently dropping whole days (weekends showed as "even").
--
-- This function returns AT MOST 7×24 rows: for each weekday (0=Sun..6=Sat, same
-- as JS getDay), the most recent date on/before p_before (within 12 weeks) that
-- has sales, broken down by hour. Runs as the caller, so RLS still applies.
-- ============================================================================

create or replace function public.roster_weekday_hourly_shapes(
  p_restaurant_id uuid,
  p_before        date
)
returns table (weekday int, business_date date, hour smallint, amount numeric)
language sql
stable
security invoker
as $$
  with days as (
    select distinct t.business_date
    from public.sales_transactions t
    where t.restaurant_id = p_restaurant_id
      and t.business_date <= p_before
      and t.business_date >  p_before - 84
  ),
  ranked as (
    select business_date,
           extract(dow from business_date)::int as wd,
           row_number() over (
             partition by extract(dow from business_date)
             order by business_date desc
           ) as rn
    from days
  ),
  picked as (
    select business_date, wd from ranked where rn = 1
  )
  select p.wd as weekday,
         p.business_date,
         t.hour,
         sum(t.amount) as amount
  from picked p
  join public.sales_transactions t
    on t.restaurant_id = p_restaurant_id
   and t.business_date = p.business_date
  group by p.wd, p.business_date, t.hour
  order by p.wd, t.hour;
$$;

grant execute on function public.roster_weekday_hourly_shapes(uuid, date) to authenticated;
