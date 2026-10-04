-- ============================================================================
-- 090. PER-VENUE SYNC SETTINGS  (so a new brand needs no code changes)
-- ----------------------------------------------------------------------------
-- Until now the Coop Agent's integration details — Lightspeed venue names, the
-- Deputy address, Uber store IDs, the Bite site numbers, Google review links —
-- were Pollo's, hard-coded in app_settings 'agent' and in the channel-sync
-- scripts. A new brand would have synced nothing.
--
-- Now each venue carries its own details in venue_sync_settings.config:
--
--   {
--     "lightspeed": { "venue_name": "Geelong West" },          -- Insights venue → lightspeed, sales-mix
--     "kounta":     { "site_name":  "Geelong West" },          -- Sales Feed "Site" → salesfeed
--     "deputy":     { "url": "https://xxx.au.deputy.com",
--                     "location_name": "Geelong West" },        -- → deputy, deputy-roster
--     "uber":       { "store_uuid": "…", "store_name": "…" },   -- → delivery, uber, payouts
--     "bite":       { "url": "https://brand.bitebusiness.com",
--                     "site_id": "3697", "connect_id": "3028" },-- → bite, payouts
--     "doordash":   { "enabled": true },                        -- → payouts
--     "google":     { "share_url": "https://share.google/…" },  -- → google
--     "payout_venue": "Pollo"                                   -- channel_payouts.venue
--   }
--
-- A section that's filled in switches those syncs on for the venue; leave it out
-- and the agent simply doesn't run them. The coop-agent edge function builds
-- each agent's settings and sign-in list from this. Venues WITHOUT a row fall
-- back to the old global maps, so nothing changes until a venue is set up.
--
-- Who can edit: the brand's own managers — anyone who can manage that venue's
-- roster (has_roster_manage) — not just superadmins. They can also add, re-pair,
-- revoke and delete their venues' agents. The global default schedules
-- (app_settings 'agent') stay superadmin-only.
--
-- Also creates the public `agent-releases` storage bucket that holds the
-- installers, and app_settings 'agent_release' pointing at the current ones.
--
-- Depends on 088 + 089. Safe to re-run.
-- ============================================================================

create table if not exists public.venue_sync_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  config        jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null
);

alter table public.venue_sync_settings enable row level security;

drop policy if exists "venue_sync_settings_select" on public.venue_sync_settings;
create policy "venue_sync_settings_select" on public.venue_sync_settings
  for select using (public.has_roster_manage(restaurant_id));
drop policy if exists "venue_sync_settings_write" on public.venue_sync_settings;
create policy "venue_sync_settings_write" on public.venue_sync_settings
  for all using (public.has_roster_manage(restaurant_id))
  with check (public.has_roster_manage(restaurant_id));

-- ── Brand managers can manage their own venues' agents ──────────────────────
drop policy if exists "agent_devices_update" on public.agent_devices;
create policy "agent_devices_update" on public.agent_devices
  for update using (public.has_roster_manage(restaurant_id))
  with check (public.has_roster_manage(restaurant_id));
drop policy if exists "agent_devices_delete" on public.agent_devices;
create policy "agent_devices_delete" on public.agent_devices
  for delete using (public.has_roster_manage(restaurant_id));

create or replace function public.agent_device_create(p_restaurant_id uuid, p_name text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare d public.agent_devices;
begin
  if not public.has_roster_manage(p_restaurant_id) then
    raise exception 'You can only add sync agents for venues you manage' using errcode = '42501';
  end if;
  insert into public.agent_devices (restaurant_id, name, pair_code, pair_expires_at, created_by)
  values (p_restaurant_id, coalesce(nullif(trim(p_name), ''), 'Venue computer'),
          public.agent_new_pair_code(), now() + interval '48 hours', auth.uid())
  returning * into d;
  return jsonb_build_object('id', d.id, 'pair_code', d.pair_code, 'pair_expires_at', d.pair_expires_at);
end;
$$;

create or replace function public.agent_device_new_code(p_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare d public.agent_devices;
begin
  select * into d from public.agent_devices where id = p_id;
  if d.id is null then raise exception 'Agent not found'; end if;
  if not public.has_roster_manage(d.restaurant_id) then
    raise exception 'You can only re-pair sync agents for venues you manage' using errcode = '42501';
  end if;
  update public.agent_devices
     set pair_code = public.agent_new_pair_code(),
         pair_expires_at = now() + interval '48 hours',
         token_hash = null,
         paired_at = null,
         active = true
   where id = p_id
  returning * into d;
  return jsonb_build_object('id', d.id, 'pair_code', d.pair_code, 'pair_expires_at', d.pair_expires_at);
end;
$$;

-- ── Seed Pollo's existing details (only for venues that exist) ──────────────
insert into public.venue_sync_settings (restaurant_id, config)
select r.id, v.config
from (values
  ('aaa00000-0000-0000-0000-000000000001'::uuid, $j${
    "lightspeed": { "venue_name": "Geelong West" },
    "kounta":     { "site_name": "Geelong West" },
    "deputy":     { "url": "https://4ce90831091241.au.deputy.com", "location_name": "Geelong West" },
    "uber":       { "store_uuid": "92b61cb6-b323-58ca-b166-f4f4e2997931", "store_name": "Pollo Rotisserie (Geelong)" },
    "bite":       { "url": "https://pollorotisserie.bitebusiness.com", "site_id": "3697", "connect_id": "3028" },
    "doordash":   { "enabled": true },
    "google":     { "share_url": "https://share.google/ukbUgMBVJxN1Fmucx" },
    "payout_venue": "Pollo"
  }$j$::jsonb),
  ('aaa00000-0000-0000-0000-000000000002'::uuid, $j${
    "lightspeed": { "venue_name": "Torquay" },
    "kounta":     { "site_name": "Torquay" },
    "deputy":     { "url": "https://4ce90831091241.au.deputy.com", "location_name": "Torquay" },
    "uber":       { "store_uuid": "1b78a41f-ba7f-5adb-869f-ceed16dc42f5", "store_name": "Pollo Torquay" },
    "bite":       { "url": "https://pollorotisserie.bitebusiness.com", "site_id": "3698", "connect_id": "3029" },
    "google":     { "share_url": "https://share.google/N0b9nAjjctbaKfI2o" },
    "payout_venue": "Pollo - Torquay"
  }$j$::jsonb)
) as v(restaurant_id, config)
join public.restaurants r on r.id = v.restaurant_id
on conflict (restaurant_id) do nothing;

-- ── Installers ───────────────────────────────────────────────────────────────
-- Public bucket: the installers carry no secrets (the pairing code is only in
-- the download's FILE NAME, added per download with ?download=…).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('agent-releases', 'agent-releases', true)
    on conflict (id) do nothing;
  end if;
end $$;

-- Written by "Publish Coop Agent.command": { version, windows, mac } — object
-- paths inside the agent-releases bucket.
insert into public.app_settings (key, value)
values ('agent_release', '{}'::jsonb)
on conflict (key) do nothing;
