-- ============================================================================
-- 077. HOURLY SHAPE — TWO-WEEK AVERAGE
-- ----------------------------------------------------------------------------
-- Was (062): the hourly sales curve for each weekday came from the single most
-- recent completed same-weekday. One odd trading day (weather, a function, a
-- POS outage) bent the whole roster for that day.
--
-- Now: the two most recent completed same-weekdays — last week and the week
-- before — averaged.
--
-- Each day is normalised to its own share-of-day FIRST, then the two shares are
-- averaged. That gives both weeks equal say in the shape. Averaging raw dollars
-- instead would let the busier of the two weeks dominate the curve.
--
-- Still at most 7×24 rows out, still security invoker (RLS applies), still
-- walks back up to 12 weeks when a weekday has no data. A weekday with only one
-- day of history just uses that one.
--
-- `amount` is now a fraction of the day (the 7 hours of a weekday sum to 1.0),
-- not dollars. The client renormalises before scaling to the entered daily
-- projection, so this is a no-op there — but don't read the column as $.
-- ============================================================================

drop function if exists public.roster_weekday_hourly_shapes(uuid, date);

create or replace function public.roster_weekday_hourly_shapes(
  p_restaurant_id uuid,
  p_before        date
)
returns table (
  weekday       int,
  business_date date,
  hour          smallint,
  amount        numeric,
  days_used     int
)
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
  -- rn <= 2 is the whole change: last week AND the week before.
  picked as (
    select business_date, wd, rn from ranked where rn <= 2
  ),
  per_day_hour as (
    select p.wd, p.business_date, t.hour, sum(t.amount) as amount
    from picked p
    join public.sales_transactions t
      on t.restaurant_id = p_restaurant_id
     and t.business_date = p.business_date
    group by p.wd, p.business_date, t.hour
  ),
  per_day_total as (
    select wd, business_date, sum(amount) as day_total
    from per_day_hour
    group by wd, business_date
    having sum(amount) > 0
  ),
  -- Each day's hourly share of its own total.
  per_day_frac as (
    select h.wd, h.business_date, h.hour, h.amount / d.day_total as frac
    from per_day_hour h
    join per_day_total d
      on d.wd = h.wd and d.business_date = h.business_date
  ),
  -- Latest date per weekday, kept so the UI can still name a reference week.
  latest as (
    select wd, max(business_date) as business_date, count(*)::int as days_used
    from per_day_total
    group by wd
  )
  select f.wd                          as weekday,
         l.business_date               as business_date,
         f.hour                        as hour,
         -- sum / days_used, not avg(): an hour that traded in only one of the
         -- two weeks counts as $0 in the other, rather than being averaged over
         -- a single day and coming out overweight.
         sum(f.frac) / l.days_used     as amount,
         l.days_used                   as days_used
  from per_day_frac f
  join latest l on l.wd = f.wd
  group by f.wd, l.business_date, f.hour, l.days_used
  order by f.wd, f.hour;
$$;

grant execute on function public.roster_weekday_hourly_shapes(uuid, date) to authenticated;
