-- ============================================================================
-- 089. PER-COMPUTER SYNC SCHEDULES
-- ----------------------------------------------------------------------------
-- Lets each Coop Agent override the default schedules (app_settings 'agent')
-- for its own venue, edited from the agent app itself (via the coop-agent edge
-- function's `set-schedule` action) or reset from Settings → Sync Agents.
--
--   schedule_overrides = { "<source>": "daily 06:00" | "hourly :10 10-22" | null }
--
-- A key that's present wins over the default; null means "on request only".
-- A key that's absent falls back to the default. Stored server-side (not on the
-- PC) so it survives a reinstall and shows up in The Coop.
--
-- Depends on 088_sync_agents.sql.
-- ============================================================================

alter table public.agent_devices
  add column if not exists schedule_overrides jsonb not null default '{}'::jsonb;
