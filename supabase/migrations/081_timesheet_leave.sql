-- ============================================================================
-- 081. TIMESHEET LEAVE + MANUAL ENTRY
-- ----------------------------------------------------------------------------
-- A manager can mark any timesheet as leave (annual / sick / unpaid). Leave is
-- a decision, not a punch, so the finalize trigger leaves those rows alone.
--
-- Marking leave also writes an APPROVED row to leave_requests (reusing one that
-- already covers the date, if present) so Leave Approvals and the team member's
-- portal stay in agreement with payroll.
--
-- Labour cost: annual + sick carry their hours (real wage expense); unpaid
-- carries none.
-- ============================================================================

alter table public.time_entries
  add column if not exists leave_type text
    check (leave_type in ('annual', 'sick', 'unpaid')),
  add column if not exists leave_request_id uuid
    references public.leave_requests(id) on delete set null;

create index if not exists idx_time_entries_leave on public.time_entries(leave_type)
  where leave_type is not null;

-- ── Finalize trigger: never re-grade a leave row ────────────────────────────
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

  -- Leave is a manager decision — hours stand as recorded, no variance grading.
  if new.leave_type is not null then
    return new;
  end if;

  -- Roster-generated: scheduled hours, not worked hours. Never auto-approve.
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

-- ── Set (or clear) leave on a timesheet ─────────────────────────────────────
-- SECURITY DEFINER so it can write leave_requests, with an explicit manager
-- check — never trust the caller's RLS to cover a second table.
create or replace function public.set_timesheet_leave(
  p_entry_id   uuid,
  p_leave_type text  -- 'annual' | 'sick' | 'unpaid' | null to clear
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e     record;
  v_req uuid;
begin
  select * into e from public.time_entries where id = p_entry_id;
  if e.id is null then
    raise exception 'Timesheet not found';
  end if;

  if not public.has_roster_manage(e.restaurant_id) then
    raise exception 'Not allowed to change this timesheet';
  end if;

  -- Clearing: unlink and drop back to pending for a fresh decision.
  if p_leave_type is null then
    update public.time_entries
       set leave_type       = null,
           leave_request_id = null,
           approval_status  = 'pending',
           approved_by      = null,
           approved_at      = null
     where id = p_entry_id;
    return;
  end if;

  if p_leave_type not in ('annual', 'sick', 'unpaid') then
    raise exception 'Invalid leave type: %', p_leave_type;
  end if;

  -- Reuse an approved request already covering this date before creating one,
  -- so a manager confirming leave the employee already lodged doesn't double up.
  select lr.id into v_req
    from public.leave_requests lr
   where lr.employee_id = e.employee_id
     and lr.leave_type  = p_leave_type
     and lr.status      = 'approved'
     and e.work_date between lr.start_date and lr.end_date
   limit 1;

  if v_req is null then
    insert into public.leave_requests (
      employee_id, start_date, end_date, leave_type, status,
      reviewed_by, reviewed_at, note
    )
    values (
      e.employee_id, e.work_date, e.work_date, p_leave_type, 'approved',
      auth.uid(), now(), 'Recorded from timesheet review'
    )
    returning id into v_req;
  end if;

  update public.time_entries
     set leave_type       = p_leave_type,
         leave_request_id = v_req,
         approval_status  = 'approved',
         approved_by      = auth.uid(),
         approved_at      = now(),
         flag_reason      = null
   where id = p_entry_id;
end;
$$;

grant execute on function public.set_timesheet_leave(uuid, text) to authenticated;

-- ── Labour cost view ────────────────────────────────────────────────────────
-- Paid leave (annual/sick) counts. Unpaid leave contributes nothing.
-- Non-leave rows still need a real clock-out and a non-pending status.
create or replace view public.worked_time_entries
with (security_invoker = true) as
select *
from public.time_entries
where coalesce(leave_type, '') <> 'unpaid'
  and (
        (leave_type is not null and approval_status = 'approved')
     or (leave_type is null
         and clock_out is not null
         and approval_status in ('auto_approved', 'approved', 'flagged'))
      );

grant select on public.worked_time_entries to authenticated;

-- ============================================================================
-- END OF MIGRATION 081
-- ============================================================================
