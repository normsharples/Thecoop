-- ============================================================================
-- 041. GENERIC REFRESH REQUEST QUEUE
-- Powers the Data Management → Refresh Data buttons and the Dashboard's
-- "Refresh data" button without the web app ever calling the user's Mac
-- directly (which browsers block over https → http://localhost — mixed content,
-- CORS, Private Network Access, cert trust).
--
-- Instead the web app INSERTS a 'pending' row here. A small always-running
-- watcher on the Mac (refresh-watcher/watch.mjs) polls this table, runs the
-- matching scraper against the open Coop Chrome, and marks the row done/error.
-- The browser only ever talks to Supabase (https), so it works in Safari, on
-- iPad, anywhere — same pattern already used by roster_refresh_requests (037).
--
-- Idempotent-ish: safe to run once. Uses uuid_generate_v4() like the rest of
-- the schema.
-- ============================================================================

create table public.refresh_requests (
  id            uuid        primary key default uuid_generate_v4(),
  source        text        not null,  -- 'lightspeed' | 'sales-mix' | 'deputy' |
                                       -- 'google' | 'bite' | 'uber' | 'payouts' | 'all'
  status        text        not null default 'pending'
                  check (status in ('pending', 'running', 'done', 'error')),
  error_message text,
  requested_by  uuid        references public.profiles(id) on delete set null,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create index idx_refresh_requests_status  on public.refresh_requests(status);
create index idx_refresh_requests_pending on public.refresh_requests(requested_at)
  where status = 'pending';

alter table public.refresh_requests enable row level security;

-- Any signed-in user may queue a refresh and watch its progress. The refresh
-- request carries no restaurant-scoped data, so it's not gated per venue.
create policy "refresh_requests_select" on public.refresh_requests
  for select to authenticated using (true);
create policy "refresh_requests_insert" on public.refresh_requests
  for insert to authenticated with check (true);
create policy "refresh_requests_delete" on public.refresh_requests
  for delete using (public.is_superadmin());

-- The local watcher connects with the service-role key, which bypasses RLS, so
-- it needs no update policy to move rows through running → done/error.
