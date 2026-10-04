-- ============================================================================
-- 088. SYNC AGENTS  (the "Coop Agent" desktop app on each venue computer)
-- ----------------------------------------------------------------------------
-- Replaces "Norm's Mac runs every scraper with the service-role key" with a
-- small desktop app per venue. Each install is PAIRED to one restaurant:
--
--   1. A superadmin creates an agent in Settings → Sync Agents → gets a one-time
--      pairing code (e.g. K7QF-29XM, valid 48h).
--   2. The venue types the code into the Coop Agent app → agent_pair() swaps it
--      for a long random device token. Only its SHA-256 is stored here.
--   3. The app never holds the service-role key. Every database call goes
--      through the `coop-agent` edge function, which resolves the token to a
--      restaurant and only lets the agent touch an allow-list of sync tables,
--      scoped to its own restaurant_id.
--
-- Also makes refresh_requests venue-aware: a request can target one venue
-- (restaurant_id) or all (null). Each agent records its own run in
-- refresh_request_runs; the edge function rolls those up into the request's
-- status, so the dashboard's existing polling keeps working unchanged.
--
-- SCHEMA-DRIFT CHECK — confirm before running:
--   select table_name, string_agg(column_name, ', ' order by ordinal_position)
--   from information_schema.columns where table_schema = 'public'
--     and table_name in ('refresh_requests','restaurants','app_settings','profiles')
--   group by table_name;
-- Expect refresh_requests(id, source, status, error_message, requested_by,
-- requested_at, started_at, completed_at), restaurants(id, name),
-- app_settings(key, value), profiles(role, restaurant_access).
-- ============================================================================

-- pgcrypto lives in `extensions` on Supabase — see the search_path notes below.
create extension if not exists pgcrypto;

-- ── Paired agents ────────────────────────────────────────────────────────────
create table if not exists public.agent_devices (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  name            text not null,                  -- "Geelong West — office PC"
  token_hash      text unique,                    -- sha256 hex of the device token; null until paired
  pair_code       text unique,                    -- one-time code, cleared once used
  pair_expires_at timestamptz,
  paired_at       timestamptz,
  active          boolean not null default true,
  last_seen_at    timestamptz,
  app_version     text,
  platform        text,                           -- 'darwin' | 'win32'
  status          jsonb not null default '{}'::jsonb,  -- last heartbeat: browser up, signed-in portals, queue
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_agent_devices_restaurant on public.agent_devices(restaurant_id);

alter table public.agent_devices enable row level security;

-- Managers can SEE their venues' agents (status page). Only superadmins create,
-- re-pair or revoke — an agent can write sales/labour data, so it's an admin act.
drop policy if exists "agent_devices_select" on public.agent_devices;
create policy "agent_devices_select" on public.agent_devices
  for select using (public.has_roster_manage(restaurant_id));
drop policy if exists "agent_devices_update" on public.agent_devices;
create policy "agent_devices_update" on public.agent_devices
  for update using (public.is_superadmin()) with check (public.is_superadmin());
drop policy if exists "agent_devices_delete" on public.agent_devices;
create policy "agent_devices_delete" on public.agent_devices
  for delete using (public.is_superadmin());
-- No insert policy: creation goes through agent_device_create() so the code is
-- generated server-side.

-- ── Run history (one row per scraper run on an agent) ────────────────────────
create table if not exists public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.agent_devices(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  source        text not null,                    -- 'lightspeed' | 'salesfeed' | …
  trigger       text not null default 'schedule'
                  check (trigger in ('schedule', 'refresh', 'manual', 'roster')),
  status        text not null default 'running'
                  check (status in ('running', 'done', 'error')),
  exit_code     integer,
  log_tail      text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists idx_agent_runs_device_started on public.agent_runs(device_id, started_at desc);

alter table public.agent_runs enable row level security;
drop policy if exists "agent_runs_select" on public.agent_runs;
create policy "agent_runs_select" on public.agent_runs
  for select using (public.has_roster_manage(restaurant_id));
-- Written only by the edge function (service role).

-- ── Venue-aware refresh queue ────────────────────────────────────────────────
alter table public.refresh_requests
  add column if not exists restaurant_id uuid references public.restaurants(id) on delete cascade;

create table if not exists public.refresh_request_runs (
  request_id    uuid not null references public.refresh_requests(id) on delete cascade,
  device_id     uuid not null references public.agent_devices(id) on delete cascade,
  status        text not null default 'running'
                  check (status in ('running', 'done', 'error')),
  error_message text,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  primary key (request_id, device_id)
);
alter table public.refresh_request_runs enable row level security;
drop policy if exists "refresh_request_runs_select" on public.refresh_request_runs;
create policy "refresh_request_runs_select" on public.refresh_request_runs
  for select to authenticated using (true);

-- ============================================================================
-- Manager-side RPCs
-- ============================================================================

-- 8 chars from an unambiguous alphabet (no 0/O/1/I/L), shown as XXXX-XXXX.
create or replace function public.agent_new_pair_code()
returns text language plpgsql volatile
set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := gen_random_bytes(8);
  out text := '';
  i int;
begin
  for i in 0..7 loop
    out := out || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return substr(out, 1, 4) || '-' || substr(out, 5, 4);
end;
$$;
revoke all on function public.agent_new_pair_code() from public;

-- Create an agent for a venue and return its pairing code.
create or replace function public.agent_device_create(p_restaurant_id uuid, p_name text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare d public.agent_devices;
begin
  if not public.is_superadmin() then
    raise exception 'Only a superadmin can add a sync agent' using errcode = '42501';
  end if;
  insert into public.agent_devices (restaurant_id, name, pair_code, pair_expires_at, created_by)
  values (p_restaurant_id, coalesce(nullif(trim(p_name), ''), 'Venue computer'),
          public.agent_new_pair_code(), now() + interval '48 hours', auth.uid())
  returning * into d;
  return jsonb_build_object('id', d.id, 'pair_code', d.pair_code, 'pair_expires_at', d.pair_expires_at);
end;
$$;

-- Issue a fresh pairing code. Unpairs the current computer (its token stops
-- working) — use when replacing a PC or if a token may have leaked.
create or replace function public.agent_device_new_code(p_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare d public.agent_devices;
begin
  if not public.is_superadmin() then
    raise exception 'Only a superadmin can re-pair a sync agent' using errcode = '42501';
  end if;
  update public.agent_devices
     set pair_code = public.agent_new_pair_code(),
         pair_expires_at = now() + interval '48 hours',
         token_hash = null,
         paired_at = null,
         active = true
   where id = p_id
  returning * into d;
  if d.id is null then raise exception 'Agent not found'; end if;
  return jsonb_build_object('id', d.id, 'pair_code', d.pair_code, 'pair_expires_at', d.pair_expires_at);
end;
$$;

-- ============================================================================
-- Agent-side RPC (anon) — the ONLY thing anon can call here
-- ============================================================================
-- Swap a pairing code for a device token. The token is returned exactly once;
-- only its hash is kept. Expected failures return {ok:false} rather than
-- raising, so the app can show a friendly message.
create or replace function public.agent_pair(p_code text, p_platform text default null, p_version text default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  d       public.agent_devices;
  v_code  text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_token text;
begin
  if length(v_code) <> 8 then
    return jsonb_build_object('ok', false, 'error', 'That code should be 8 letters/numbers, like K7QF-29XM.');
  end if;
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);

  select * into d from public.agent_devices
   where pair_code = v_code and active
   for update;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Code not recognised. Check it, or create a new one in The Coop → Settings → Sync Agents.');
  end if;
  if d.pair_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'That code has expired. Create a new one in The Coop → Settings → Sync Agents.');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  update public.agent_devices
     set token_hash = encode(digest(v_token, 'sha256'), 'hex'),
         pair_code = null,
         pair_expires_at = null,
         paired_at = now(),
         last_seen_at = now(),
         platform = left(p_platform, 20),
         app_version = left(p_version, 40)
   where id = d.id;

  return jsonb_build_object(
    'ok',              true,
    'token',           v_token,
    'device_id',       d.id,
    'device_name',     d.name,
    'restaurant_id',   d.restaurant_id,
    'restaurant_name', (select name from public.restaurants where id = d.restaurant_id)
  );
end;
$$;

revoke all on function public.agent_pair(text, text, text) from public;
grant execute on function public.agent_pair(text, text, text) to anon, authenticated;
revoke all on function public.agent_device_create(uuid, text) from public;
grant execute on function public.agent_device_create(uuid, text) to authenticated;
revoke all on function public.agent_device_new_code(uuid) from public;
grant execute on function public.agent_device_new_code(uuid) to authenticated;

-- ============================================================================
-- Agent config  (app_settings key 'agent')
-- ----------------------------------------------------------------------------
-- One config for every agent. The edge function hands each agent a copy with
-- every *_MAP env var FILTERED to entries containing that agent's restaurant
-- UUID — so the scrapers only ever see (and write) their own venue.
--
-- schedule: "daily HH:MM"  or  "hourly :MM HH-HH" (inclusive hour window).
-- portals : the tabs the app's Coop Browser opens for sign-in; `match` is how
--           the app recognises a signed-in tab (a URL substring that only
--           appears once you're past the login page).
-- payout_venues: channel_payouts.venue name per restaurant (that table keys on
--           a text venue name, not restaurant_id).
-- ============================================================================
insert into public.app_settings (key, value) values ('agent', $json$
{
  "sources": {
    "google":     { "label": "Google Reviews",       "schedule": "daily 03:00", "env": { "STORE_MAP": "https://share.google/ukbUgMBVJxN1Fmucx|aaa00000-0000-0000-0000-000000000001,https://share.google/N0b9nAjjctbaKfI2o|aaa00000-0000-0000-0000-000000000002" } },
    "lightspeed": { "label": "Lightspeed Sales",     "schedule": "daily 04:00", "env": { "VENUE_MAP": "Geelong West:aaa00000-0000-0000-0000-000000000001,Torquay:aaa00000-0000-0000-0000-000000000002" } },
    "sales-mix":  { "label": "Lightspeed Sales Mix", "schedule": "daily 04:35", "env": { "VENUE_MAP": "Geelong West:aaa00000-0000-0000-0000-000000000001,Torquay:aaa00000-0000-0000-0000-000000000002" } },
    "deputy":     { "label": "Deputy Labour",        "schedule": "daily 05:00", "env": { "VENUE_MAP": "Geelong West:aaa00000-0000-0000-0000-000000000001,Torquay:aaa00000-0000-0000-0000-000000000002", "DEPUTY_URL": "https://4ce90831091241.au.deputy.com" } },
    "deputy-roster": { "label": "Deputy Roster (next 2 weeks)", "schedule": "daily 05:20", "env": { "VENUE_MAP": "Geelong West:aaa00000-0000-0000-0000-000000000001,Torquay:aaa00000-0000-0000-0000-000000000002", "DEPUTY_URL": "https://4ce90831091241.au.deputy.com" } },
    "salesfeed":  { "label": "Sales by Hour",        "schedule": "hourly :05 09-23", "env": { "VENUE_MAP": "Geelong West:aaa00000-0000-0000-0000-000000000001,Torquay:aaa00000-0000-0000-0000-000000000002", "SALESFEED_URL": "https://my.kounta.com/sale" } },
    "delivery":   { "label": "Delivery Orders",      "schedule": "hourly :15 09-23", "env": { "STORE_MAP": "geelong:92b61cb6-b323-58ca-b166-f4f4e2997931:aaa00000-0000-0000-0000-000000000001:Pollo Rotisserie (Geelong),torquay:1b78a41f-ba7f-5adb-869f-ceed16dc42f5:aaa00000-0000-0000-0000-000000000002:Pollo Torquay", "UBER_ORDERS_URL": "https://merchants.ubereats.com/manager/orders" } },
    "bite":       { "label": "Bite Online Sales",    "schedule": null, "env": {} },
    "uber":       { "label": "Uber Eats Sales",      "schedule": null, "env": {} },
    "payouts":    { "label": "Channel Payouts",      "schedule": null, "env": {} }
  },
  "refresh_all": ["lightspeed", "sales-mix", "deputy", "google", "bite", "uber", "payouts"],
  "payout_venues": {
    "aaa00000-0000-0000-0000-000000000001": "Pollo",
    "aaa00000-0000-0000-0000-000000000002": "Pollo - Torquay"
  },
  "portals": [
    { "key": "lightspeed", "name": "Lightspeed Insights", "url": "https://insights.kounta.com/insights?url=/embed/dashboards-next/1216", "match": "insights.kounta.com/insights" },
    { "key": "kounta",     "name": "Lightspeed Back Office (Sales Feed)", "url": "https://my.kounta.com/sale", "match": "my.kounta.com/sale" },
    { "key": "deputy",     "name": "Deputy",            "url": "https://4ce90831091241.au.deputy.com/#/roster/insights", "match": "deputy.com/#" },
    { "key": "uber",       "name": "Uber Eats Manager", "url": "https://merchants.ubereats.com/manager/home", "match": "merchants.ubereats.com/manager" },
    { "key": "bite",       "name": "Bite Business",     "url": "https://pollorotisserie.bitebusiness.com/admin", "match": "bitebusiness.com/admin" },
    { "key": "doordash",   "name": "DoorDash Merchant", "url": "https://merchant.doordash.com", "match": "merchant.doordash.com/merchant" }
  ]
}
$json$::jsonb)
on conflict (key) do nothing;
