-- ============================================================================
-- 052. TIME & ATTENDANCE  (Payroll T1 — capture)
-- ----------------------------------------------------------------------------
-- First real timesheet layer. Staff clock in/out (+ one unpaid meal break) from
-- a shared venue KIOSK (manager session + 4-digit PIN) or their own PHONE
-- (authenticated portal). A finalize trigger auto-approves punches within a
-- tolerance of the rostered shift and flags the rest for a manager.
--
-- Deputy remains the source of truth for labour_daily until the Coop pay run is
-- validated at parity — nothing here touches labour_daily / sales_daily.
--
-- Adds:  profiles.pin_hash, profiles.date_of_birth, restaurants.state
-- Tables: time_entries
-- RPCs:  set_pin(uuid, text), verify_pin(uuid, text)   [pgcrypto bcrypt]
-- Trigger: time_entries_finalize  (worked_minutes + approval on clock-out)
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Profile: PIN (for kiosk) + date of birth (for junior award rates, T2) ────
alter table public.profiles
  add column if not exists pin_hash      text,
  add column if not exists date_of_birth date;

-- ── Restaurant: state (drives the public-holiday calendar, T2) ───────────────
alter table public.restaurants
  add column if not exists state text
    check (state in ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT'));

-- ── PIN helpers (SECURITY DEFINER so pin_hash never leaves the DB) ────────────
-- Set a PIN for yourself, or (as a roster manager) for a team member.
create or replace function public.set_pin(target uuid, pin text)
returns void language plpgsql security definer as $$
begin
  if target <> auth.uid() and not public.is_roster_manager() then
    raise exception 'Not allowed to set this PIN';
  end if;
  if pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4–6 digits';
  end if;
  update public.profiles
    set pin_hash = crypt(pin, gen_salt('bf'))
    where id = target;
end;
$$;

-- Verify a team member's PIN (used by the kiosk under a manager session).
create or replace function public.verify_pin(target uuid, pin text)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = target
      and pin_hash is not null
      and pin_hash = crypt(pin, pin_hash)
  );
$$;

-- ============================================================================
-- TIME ENTRIES  (one row per punched shift/day)
-- ============================================================================
create table public.time_entries (
  id              uuid        primary key default uuid_generate_v4(),
  restaurant_id   uuid        not null references public.restaurants(id) on delete cascade,
  employee_id     uuid        not null references public.profiles(id)    on delete cascade,
  shift_id        uuid        references public.shifts(id) on delete set null,
  work_date       date        not null,                       -- venue-local roster date
  clock_in        timestamptz not null default now(),
  clock_out       timestamptz,
  break_start     timestamptz,
  break_end       timestamptz,
  source          text        not null default 'kiosk'
                    check (source in ('kiosk', 'app', 'manual')),
  worked_minutes  integer,                                    -- set by finalize trigger
  approval_status text        not null default 'pending'
                    check (approval_status in
                      ('pending','auto_approved','flagged','approved','rejected')),
  flag_reason     text,
  approved_by     uuid        references public.profiles(id) on delete set null,
  approved_at     timestamptz,
  created_by      uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_time_entries_restaurant_date on public.time_entries(restaurant_id, work_date);
create index idx_time_entries_employee_date    on public.time_entries(employee_id, work_date);
create index idx_time_entries_approval         on public.time_entries(approval_status);
-- At most one OPEN punch per employee at a time (clock_out null).
create unique index uniq_time_entries_open
  on public.time_entries(employee_id) where (clock_out is null);

alter table public.time_entries enable row level security;

-- Managers: full control of their stores' entries.
-- Employee: read own; may create own; may update/delete own only while still open.
create policy "time_entries_select" on public.time_entries
  for select using (
    public.has_roster_manage(restaurant_id) or employee_id = auth.uid()
  );
create policy "time_entries_insert" on public.time_entries
  for insert with check (
    public.has_roster_manage(restaurant_id) or employee_id = auth.uid()
  );
create policy "time_entries_update" on public.time_entries
  for update using (
    public.has_roster_manage(restaurant_id)
    or (employee_id = auth.uid() and approval_status = 'pending')
  );
create policy "time_entries_delete" on public.time_entries
  for delete using (
    public.has_roster_manage(restaurant_id)
    or (employee_id = auth.uid() and approval_status = 'pending')
  );

create trigger time_entries_updated_at
  before update on public.time_entries
  for each row execute function public.handle_updated_at();

-- ── Finalize: compute worked minutes + auto-approve vs the rostered shift ─────
-- SECURITY DEFINER so the auto-approve check can always read the rostered shift
-- and payroll settings, regardless of who is punching (kiosk manager or the
-- employee on their phone).
create or replace function public.time_entries_finalize()
returns trigger language plpgsql security definer as $$
declare
  tol      integer;
  brk_min  integer := 0;
  rostered integer;
  sh       record;
  diff     integer;
begin
  -- Only evaluate completed punches, and never re-touch a manual decision.
  if new.clock_out is null or new.approval_status in ('approved','rejected') then
    return new;
  end if;

  -- Tolerance (minutes) from app_settings 'payroll', default 15.
  select coalesce((value->>'clock_tolerance_min')::int, 15) into tol
    from public.app_settings where key = 'payroll';
  if tol is null then tol := 15; end if;

  if new.break_start is not null and new.break_end is not null then
    brk_min := greatest(0, round(extract(epoch from (new.break_end - new.break_start)) / 60)::int);
  end if;

  new.worked_minutes := greatest(0,
    round(extract(epoch from (new.clock_out - new.clock_in)) / 60)::int - brk_min);

  -- Closest rostered shift that day (if any).
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

  -- Rostered paid minutes (handle shifts that cross midnight).
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

drop trigger if exists time_entries_finalize on public.time_entries;
create trigger time_entries_finalize
  before insert or update on public.time_entries
  for each row execute function public.time_entries_finalize();

-- ============================================================================
-- END OF MIGRATION 052
-- ============================================================================
