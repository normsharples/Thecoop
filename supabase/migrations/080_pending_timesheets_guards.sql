-- ============================================================================
-- 080. PENDING TIMESHEETS — skip unassigned and unpublished shifts
-- ----------------------------------------------------------------------------
-- 079's generator hit a not-null violation on time_entries.employee_id.
-- Migration 045 made shifts.employee_id nullable so managers can lay out OPEN
-- shifts and fill them later; an open shift has nobody to build a timesheet for.
--
-- Same pass adds the publication guard: roster_weeks gates a week draft ->
-- published, and a draft roster is a plan, not a commitment. Generating
-- timesheets off unpublished shifts would invent payroll from a scratchpad.
-- ============================================================================

create or replace function public.generate_pending_timesheets(
  p_grace interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
begin
  with candidate as (
    select
      s.id            as shift_id,
      s.restaurant_id,
      s.employee_id,
      s.date          as work_date,
      ((s.date + s.start_time) at time zone venue_timezone(r.state)) as start_ts,
      ((s.date + s.end_time
         + case when s.end_time <= s.start_time then interval '1 day'
                else interval '0' end)
        at time zone venue_timezone(r.state)) as end_ts
    from public.shifts s
    join public.restaurants r on r.id = s.restaurant_id
    where s.date between current_date - 14 and current_date
      -- Open/unassigned shift: nobody to raise a timesheet for.
      and s.employee_id is not null
      -- Only rosters the venue actually committed to.
      and exists (
        select 1
        from public.roster_weeks w
        where w.restaurant_id = s.restaurant_id
          and w.week_start    = (date_trunc('week', s.date)::date)
          and w.status        = 'published'
      )
  ),
  inserted as (
    insert into public.time_entries (
      restaurant_id, employee_id, shift_id, work_date,
      clock_in, clock_out, source, approval_status, flag_reason
    )
    select
      c.restaurant_id, c.employee_id, c.shift_id, c.work_date,
      c.start_ts, c.end_ts, 'auto', 'pending', 'No clock-in — rostered times shown'
    from candidate c
    where c.end_ts + p_grace < now()
      and not exists (
        select 1
        from public.time_entries te
        where te.employee_id   = c.employee_id
          and te.restaurant_id = c.restaurant_id
          and (te.shift_id = c.shift_id or te.work_date = c.work_date)
      )
    returning 1
  )
  select count(*) into v_created from inserted;

  return v_created;
end;
$$;

-- ============================================================================
-- END OF MIGRATION 080
-- ============================================================================
