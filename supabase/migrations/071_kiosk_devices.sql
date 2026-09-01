-- ============================================================================
-- 071. KIOSK DEVICES  (standalone Coop Clock app)
-- ----------------------------------------------------------------------------
-- The Coop Clock is a SEPARATE front-end (folder `coop-clock/`) that runs on a
-- wall tablet in each venue. It talks to THIS Supabase project with the anon key
-- and NO user session at all — so a tablet left unattended can never be used to
-- open The Coop itself.
--
-- Instead each tablet is "paired" with a device token. Every call carries the
-- token; the SECURITY DEFINER RPCs below resolve the token to a restaurant, and
-- the staff member's own 4–6 digit PIN authorises the punch. The anon role gets
-- EXECUTE on exactly three functions and no table access whatsoever.
--
--   kiosk_hello(token)                        -> which venue is this tablet?
--   kiosk_roster(token)                       -> today's punchable staff + state
--   kiosk_punch(token, employee, pin, action) -> write a punch
--
-- Punches land in time_entries exactly as the in-app kiosk's did (source
-- 'kiosk'), so the 052 finalize trigger, Rostering → Timesheets, the award
-- engine and the pay run all keep working untouched.
--
-- Depends on 052_time_attendance.sql (time_entries, profiles.pin_hash, pgcrypto).
--
-- SCHEMA-DRIFT CHECK — run this first and confirm the columns exist:
--   select table_name, string_agg(column_name, ', ' order by ordinal_position)
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('time_entries','profiles','shifts','restaurants')
--   group by table_name;
-- Expect: time_entries(... clock_in, clock_out, break_start, break_end, source,
-- work_date, shift_id), profiles(pin_hash, is_rosterable, home_restaurant_id,
-- display_colour, full_name), shifts(date, start_time, end_time, restaurant_id,
-- employee_id, position_id).
-- ============================================================================

create extension if not exists pgcrypto;

-- NOTE ON search_path: the functions below that call pgcrypto (crypt, gen_salt,
-- gen_random_bytes) declare `set search_path = public, extensions`. Supabase
-- installs pgcrypto into the `extensions` schema, so pinning search_path to
-- public alone makes those calls fail with "function ... does not exist" (42883).
-- Listing both covers either layout.

-- ── Paired tablets ───────────────────────────────────────────────────────────
create table if not exists public.kiosk_devices (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,                       -- "Geelong West — front counter"
  token         text not null unique,                -- pairing secret (32 hex chars)
  active        boolean not null default true,
  last_seen_at  timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_kiosk_devices_restaurant
  on public.kiosk_devices(restaurant_id);

alter table public.kiosk_devices enable row level security;

-- Managers manage their own venues' tablets. anon gets NOTHING here — the RPCs
-- below are SECURITY DEFINER and read the table on the caller's behalf.
drop policy if exists "kiosk_devices_select" on public.kiosk_devices;
create policy "kiosk_devices_select" on public.kiosk_devices
  for select using (public.has_roster_manage(restaurant_id));
drop policy if exists "kiosk_devices_write" on public.kiosk_devices;
create policy "kiosk_devices_write" on public.kiosk_devices
  for all using (public.has_roster_manage(restaurant_id))
  with check (public.has_roster_manage(restaurant_id));

-- ── Wrong-PIN throttle (per tablet + person) ─────────────────────────────────
create table if not exists public.kiosk_pin_attempts (
  device_id    uuid not null references public.kiosk_devices(id) on delete cascade,
  employee_id  uuid not null references public.profiles(id) on delete cascade,
  fails        integer not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (device_id, employee_id)
);
alter table public.kiosk_pin_attempts enable row level security;  -- no policies: definer-only

-- ── Idempotency log (an offline tablet may replay a queued punch) ────────────
create table if not exists public.kiosk_punch_log (
  client_id  text primary key,
  device_id  uuid references public.kiosk_devices(id) on delete cascade,
  result     jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.kiosk_punch_log enable row level security;      -- no policies: definer-only

-- ============================================================================
-- Helpers
-- ============================================================================

-- Venue-local "today". Timezone comes from app_settings 'award' (the same source
-- the award engine uses), falling back to Australia/Melbourne.
create or replace function public.kiosk_venue_today()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
    (select value->>'tz' from public.app_settings where key = 'award'),
    'Australia/Melbourne'))::date;
$$;

-- Resolve a device token to its row, or raise. Also stamps last_seen_at.
create or replace function public.kiosk_resolve(p_token text, p_touch boolean default true)
returns public.kiosk_devices language plpgsql security definer set search_path = public as $$
declare d public.kiosk_devices;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'This tablet is not paired' using errcode = '28000';
  end if;
  select * into d from public.kiosk_devices where token = p_token and active;
  if d.id is null then
    raise exception 'This tablet is not paired' using errcode = '28000';
  end if;
  if p_touch then
    update public.kiosk_devices set last_seen_at = now() where id = d.id;
  end if;
  return d;
end;
$$;
revoke all on function public.kiosk_resolve(text, boolean) from public;

-- ============================================================================
-- RPC 1 — kiosk_hello: which venue is this tablet?
-- ============================================================================
create or replace function public.kiosk_hello(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.kiosk_devices; r record;
begin
  d := public.kiosk_resolve(p_token);
  select name into r from public.restaurants where id = d.restaurant_id;
  return jsonb_build_object(
    'device_id',       d.id,
    'device_name',     d.name,
    'restaurant_id',   d.restaurant_id,
    'restaurant_name', r.name,
    'work_date',       public.kiosk_venue_today(),
    'server_time',     now()
  );
end;
$$;

-- ============================================================================
-- RPC 2 — kiosk_roster: who can punch here today, and where are they up to?
-- ----------------------------------------------------------------------------
-- Shown: anyone rostered at this venue today, anyone whose home store is this
-- venue, and anyone currently clocked in here. Returns names + punch state only
-- — no PIN hashes, no contact details, no pay data.
-- ============================================================================
create or replace function public.kiosk_roster(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d      public.kiosk_devices;
  v_day  date;
  v_rows jsonb;
begin
  d := public.kiosk_resolve(p_token);
  v_day := public.kiosk_venue_today();

  select coalesce(jsonb_agg(x order by x->>'full_name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'employee_id',    p.id,
      'full_name',      p.full_name,
      'display_colour', p.display_colour,
      'has_pin',        (p.pin_hash is not null),
      'shift', case when s.id is null then null else jsonb_build_object(
        'id',         s.id,
        'start_time', s.start_time,
        'end_time',   s.end_time,
        'position',   pos.name
      ) end,
      'entry', case when e.id is null then null else jsonb_build_object(
        'id',          e.id,
        'clock_in',    e.clock_in,
        'break_start', e.break_start,
        'break_end',   e.break_end
      ) end,
      'state', case
        when e.id is null then 'out'
        when e.break_start is not null and e.break_end is null then 'on_break'
        else 'in' end
    ) as x
    from public.profiles p
    left join lateral (
      select s2.* from public.shifts s2
      where s2.employee_id = p.id
        and s2.restaurant_id = d.restaurant_id
        and s2.date = v_day
      order by s2.start_time
      limit 1
    ) s on true
    left join public.positions pos on pos.id = s.position_id
    left join lateral (
      select e2.* from public.time_entries e2
      where e2.employee_id = p.id
        and e2.restaurant_id = d.restaurant_id
        and e2.clock_out is null
      order by e2.clock_in desc
      limit 1
    ) e on true
    where coalesce(p.is_rosterable, false)
      and (s.id is not null or e.id is not null or p.home_restaurant_id = d.restaurant_id)
  ) q;

  return jsonb_build_object(
    'restaurant_id',   d.restaurant_id,
    'restaurant_name', (select name from public.restaurants where id = d.restaurant_id),
    'work_date',       v_day,
    'server_time',     now(),
    'staff',           v_rows
  );
end;
$$;

-- ============================================================================
-- RPC 3 — kiosk_punch: PIN-authorised clock in / break / out
-- ----------------------------------------------------------------------------
-- p_at        optional real punch time (an offline tablet flushing its queue).
--             Clamped to the last 12 hours; never in the future.
-- p_client_id optional idempotency key — replaying the same key returns the
--             original result instead of writing a second punch.
--
-- Returns jsonb. Expected failures come back as {ok:false, error:'...'} rather
-- than a raised exception, on purpose: a RAISE would roll back the wrong-PIN
-- counter in the same transaction and the lockout would never bite.
-- ============================================================================
create or replace function public.kiosk_punch(
  p_token     text,
  p_employee  uuid,
  p_pin       text,
  p_action    text,
  p_at        timestamptz default null,
  p_client_id text default null
)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$  -- extensions: crypt() lives there
declare
  d        public.kiosk_devices;
  v_day    date;
  v_at     timestamptz;
  v_att    public.kiosk_pin_attempts;
  v_prof   record;
  v_shift  record;
  v_entry  public.time_entries;
  v_result jsonb;
begin
  if p_action not in ('in', 'break_start', 'break_end', 'out') then
    return jsonb_build_object('ok', false, 'error', format('Unknown action %s', p_action));
  end if;

  -- Replay of an already-accepted punch -> return the original answer.
  if p_client_id is not null then
    select result into v_result from public.kiosk_punch_log where client_id = p_client_id;
    if v_result is not null then
      return v_result || jsonb_build_object('replayed', true);
    end if;
  end if;

  begin
    d := public.kiosk_resolve(p_token);
  exception when others then
    return jsonb_build_object('ok', false, 'unpaired', true, 'error', 'This tablet is not paired');
  end;

  v_day := public.kiosk_venue_today();

  v_at := coalesce(p_at, now());
  if v_at > now() + interval '2 minutes' then v_at := now(); end if;
  if v_at < now() - interval '12 hours'   then v_at := now() - interval '12 hours'; end if;

  -- Throttle. NOTE: every failure path below RETURNS rather than RAISEs — a
  -- raised exception would roll back the failed-attempt counter with it.
  select * into v_att from public.kiosk_pin_attempts
    where device_id = d.id and employee_id = p_employee;
  if v_att.locked_until is not null and v_att.locked_until > now() then
    return jsonb_build_object('ok', false, 'locked', true,
      'error', 'Too many wrong PINs - try again in a minute');
  end if;

  -- Who is this, and may they punch at this venue?
  select p.id, p.full_name, p.pin_hash, p.is_rosterable, p.home_restaurant_id
    into v_prof
    from public.profiles p where p.id = p_employee;
  if v_prof.id is null or not coalesce(v_prof.is_rosterable, false) then
    return jsonb_build_object('ok', false, 'error', 'Not a rosterable team member');
  end if;
  if v_prof.pin_hash is null then
    return jsonb_build_object('ok', false, 'error', 'No PIN set - ask your manager to set one');
  end if;

  select s.* into v_shift
    from public.shifts s
    where s.employee_id = p_employee
      and s.restaurant_id = d.restaurant_id
      and s.date = v_day
    order by s.start_time
    limit 1;

  select e.* into v_entry
    from public.time_entries e
    where e.employee_id = p_employee
      and e.restaurant_id = d.restaurant_id
      and e.clock_out is null
    order by e.clock_in desc
    limit 1;

  if v_shift.id is null and v_entry.id is null
     and v_prof.home_restaurant_id is distinct from d.restaurant_id then
    return jsonb_build_object('ok', false, 'error', 'Not rostered at this venue today');
  end if;

  -- PIN
  if v_prof.pin_hash <> crypt(coalesce(p_pin, ''), v_prof.pin_hash) then
    insert into public.kiosk_pin_attempts (device_id, employee_id, fails, updated_at)
      values (d.id, p_employee, 1, now())
    on conflict (device_id, employee_id) do update
      set fails        = case when public.kiosk_pin_attempts.fails + 1 >= 5
                              then 0 else public.kiosk_pin_attempts.fails + 1 end,
          updated_at   = now(),
          locked_until = case when public.kiosk_pin_attempts.fails + 1 >= 5
                              then now() + interval '60 seconds' end;
    return jsonb_build_object('ok', false, 'wrong_pin', true, 'error', 'Wrong PIN');
  end if;
  delete from public.kiosk_pin_attempts where device_id = d.id and employee_id = p_employee;

  -- Punch
  begin
    if p_action = 'in' then
      if v_entry.id is not null then
        return jsonb_build_object('ok', false,
          'error', format('%s is already clocked in', split_part(v_prof.full_name, ' ', 1)));
      end if;
      insert into public.time_entries
        (restaurant_id, employee_id, shift_id, work_date, clock_in, source, created_by)
      values
        (d.restaurant_id, p_employee, v_shift.id, v_day, v_at, 'kiosk', p_employee)
      returning * into v_entry;

    else
      if v_entry.id is null then
        return jsonb_build_object('ok', false,
          'error', format('%s is not clocked in', split_part(v_prof.full_name, ' ', 1)));
      end if;

      if p_action = 'break_start' then
        if v_entry.break_start is not null and v_entry.break_end is null then
          return jsonb_build_object('ok', false, 'error', 'Already on break');
        end if;
        if v_entry.break_start is not null then
          return jsonb_build_object('ok', false, 'error', 'Break already taken this shift');
        end if;
        update public.time_entries set break_start = greatest(v_at, v_entry.clock_in)
          where id = v_entry.id returning * into v_entry;

      elsif p_action = 'break_end' then
        if v_entry.break_start is null or v_entry.break_end is not null then
          return jsonb_build_object('ok', false, 'error', 'Not on break');
        end if;
        update public.time_entries set break_end = greatest(v_at, v_entry.break_start)
          where id = v_entry.id returning * into v_entry;

      else -- out
        update public.time_entries
          set clock_out = greatest(v_at, v_entry.clock_in),
              break_end = case when v_entry.break_start is not null and v_entry.break_end is null
                               then greatest(v_at, v_entry.break_start) else v_entry.break_end end
          where id = v_entry.id returning * into v_entry;
      end if;
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false,
        'error', format('%s is already clocked in', split_part(v_prof.full_name, ' ', 1)));
    when others then
      return jsonb_build_object('ok', false, 'error', 'Could not record that punch');
  end;

  v_result := jsonb_build_object(
    'ok',             true,
    'action',         p_action,
    'first_name',     split_part(v_prof.full_name, ' ', 1),
    'at',             v_at,
    'entry_id',       v_entry.id,
    'worked_minutes', v_entry.worked_minutes,
    'state', case
      when v_entry.clock_out is not null then 'done'
      when v_entry.break_start is not null and v_entry.break_end is null then 'on_break'
      else 'in' end
  );

  if p_client_id is not null then
    insert into public.kiosk_punch_log (client_id, device_id, result)
      values (p_client_id, d.id, v_result)
    on conflict (client_id) do nothing;
  end if;

  return v_result;
end;
$$;

-- ============================================================================
-- Grants — the anon role may call these three functions and nothing else.
-- ============================================================================
revoke all on function public.kiosk_hello(text)  from public;
revoke all on function public.kiosk_roster(text) from public;
revoke all on function public.kiosk_punch(text, uuid, text, text, timestamptz, text) from public;
revoke all on function public.kiosk_venue_today() from public;

grant execute on function public.kiosk_hello(text)  to anon, authenticated;
grant execute on function public.kiosk_roster(text) to anon, authenticated;
grant execute on function public.kiosk_punch(text, uuid, text, text, timestamptz, text)
  to anon, authenticated;

-- ============================================================================
-- Pairing helpers (managers, from the SQL editor or a future admin screen)
-- ============================================================================
create or replace function public.kiosk_device_create(p_restaurant uuid, p_name text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$  -- extensions: gen_random_bytes()
declare v_token text; v_id uuid;
begin
  if not public.has_roster_manage(p_restaurant) then
    raise exception 'Not allowed to pair a tablet for this venue';
  end if;
  v_token := encode(gen_random_bytes(16), 'hex');
  insert into public.kiosk_devices (restaurant_id, name, token, created_by)
    values (p_restaurant, p_name, v_token, auth.uid())
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'name', p_name);
end;
$$;
revoke all on function public.kiosk_device_create(uuid, text) from public;
grant execute on function public.kiosk_device_create(uuid, text) to authenticated;

-- Housekeeping: punch-log rows older than 7 days are useless (a tablet only ever
-- replays within its offline window). Safe to run from a cron job.
create or replace function public.kiosk_punch_log_prune()
returns void language sql security definer set search_path = public as $$
  delete from public.kiosk_punch_log where created_at < now() - interval '7 days';
$$;
revoke all on function public.kiosk_punch_log_prune() from public;

-- ============================================================================
-- END OF MIGRATION 071
-- ============================================================================
