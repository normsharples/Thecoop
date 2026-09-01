-- ============================================================================
-- 079. PENDING TIMESHEETS  (supersedes / repairs 078)
-- ----------------------------------------------------------------------------
-- Every rostered shift gets a timesheet. No clock-in => a row pre-filled with
-- the rostered times, left at approval_status 'pending' for a manager.
-- Clock-in with no clock-out already lands on 'pending' via the table default,
-- so both cases share one bucket, as intended.
--
-- 078 was written against guessed column names. It added a redundant `status`
-- enum alongside the real `approval_status`, and its insert could never run
-- (work_date is NOT NULL; source 'auto' failed the CHECK). This undoes that
-- and rebuilds it on the actual 052 schema.
-- ============================================================================

-- ── 1. Undo 078 ─────────────────────────────────────────────────────────────
drop view if exists public.approved_time_entries;
alter table public.time_entries drop column if exists status;
drop type if exists timesheet_status;

-- ── 2. Allow roster-generated rows ──────────────────────────────────────────
alter table public.time_entries drop constraint if exists time_entries_source_check;
alter table public.time_entries
  add constraint time_entries_source_check
  check (source in ('kiosk', 'app', 'manual', 'auto'));

-- ── 3. Venue timezone (shifts store wall-clock time, not timestamptz) ───────
create or replace function public.venue_timezone(p_state text)
returns text language sql immutable as $$
  select case p_state
    when 'NSW' then 'Australia/Sydney'    when 'VIC' then 'Australia/Melbourne'
    when 'QLD' then 'Australia/Brisbane'  when 'SA'  then 'Australia/Adelaide'
    when 'WA'  then 'Australia/Perth'     when 'TAS' then 'Australia/Hobart'
    when 'NT'  then 'Australia/Darwin'    when 'ACT' then 'Australia/Sydney'
    else 'Australia/Melbourne'
  end;
$$;

-- ── 4. Finalize trigger must not auto-approve a shift nobody worked ─────────
-- Same logic as 052, with one guard: 'auto' rows get worked_minutes computed
-- but keep their 'pending' status until a human decides.
create or replace function public.time_entries_finalize()
returns trigger language plpgsql security definer as $$
declare
  tol      integer;
  brk_min  integer := 0;
  rostered integer;
  sh       record;
  diff     integer;
begin
  if new.clock_out is null or new.approval_status in ('approved','rejected') then
    return new;
  end if;

  if new.break_start is not null and new.break_end is not null then
    brk_min := greatest(0, round(extract(epoch from (new.break_end - new.break_start)) / 60)::int);
  end if;

  new.worked_minutes := greatest(0,
    round(extract(epoch from (new.clock_out - new.clock_in)) / 60)::int - brk_min);

  -- Roster-generated: these are scheduled hours, not worked hours. Never
  -- auto-approve them — that is the whole point of the pending state.
  if new.source = 'auto' then
    return new;
  end if;

  select coalesce((value->>'clock_tolerance_min')::int, 15) into tol
    from public.app_settings where key = 'payroll';
  if tol is null then tol := 15; end if;

  select s.* into sh
    from public.shifts s
    where s.employee_id = new.employee_id
      and s.restaurant_id = new.restaurant_id
      and s.date = new.work_date
    order by s.start_time
    limit 1;

  if sh.id is null then
    new.approval_status := 'flagged';
    new.flag_reason := 'No rostered shift for this day';
    return new;
  end if;

  rostered := (extract(epoch from (sh.end_time - sh.start_time)) / 60)::int;
  if rostered < 0 then rostered := rostered + 1440; end if;
  rostered := rostered - coalesce(sh.unpaid_break_minutes, 0);

  diff := new.worked_minutes - rostered;
  if abs(diff) <= tol then
    new.approval_status := 'auto_approved';
    new.flag_reason := null;
  else
    new.approval_status := 'flagged';
    new.flag_reason := format('%s rostered %sm vs worked %sm (%s%sm)',
      'Variance:', rostered, new.worked_minutes,
      case when diff > 0 then '+' else '' end, diff);
  end if;
  return new;
end;
$$;

-- ── 5. The generator ────────────────────────────────────────────────────────
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
      s.unpaid_break_minutes,
      ((s.date + s.start_time) at time zone venue_timezone(r.state)) as start_ts,
      ((s.date + s.end_time
         + case when s.end_time <= s.start_time then interval '1 day'
                else interval '0' end)
        at time zone venue_timezone(r.state)) as end_ts
    from public.shifts s
    join public.restaurants r on r.id = s.restaurant_id
    where s.date between current_date - 14 and current_date
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

-- ── 6. Labour cost must ignore hours nobody actually worked ─────────────────
-- Point labour / payroll queries at this view instead of time_entries.
-- 'flagged' IS included: those are real punches awaiting review. Only
-- 'pending' (open punch or roster-generated no-show) and 'rejected' drop out.
create or replace view public.worked_time_entries
with (security_invoker = true) as
select *
from public.time_entries
where clock_out is not null
  and approval_status in ('auto_approved', 'approved', 'flagged');

grant select on public.worked_time_entries to authenticated;

-- ============================================================================
-- END OF MIGRATION 079
-- ============================================================================
