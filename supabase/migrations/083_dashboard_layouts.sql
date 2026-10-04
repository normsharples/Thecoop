-- ============================================================================
-- 083 — Customisable dashboards
--   One table holds every dashboard layout. A row's (user_id, brand_id) pair
--   says what it is:
--
--     user_id  brand_id   meaning
--     -------  --------   ------------------------------------------------
--     null     null       Global default (used when no brand is in view)
--     null     <brand>    Brand default — set by a superadmin
--     <user>   null       A manager's own layout for the "all brands" view
--     <user>   <brand>    A manager's own layout for that brand
--
--   The app resolves: personal → brand default → global default → built-in.
--   Resetting a personal dashboard just deletes the personal row.
--
--   layout jsonb shape: { "version": 1, "widgets": [
--     { "id": "w_abc", "type": "snapshot", "size": "full", "settings": {} } ] }
--
--   Safe to re-run.
-- ============================================================================

create table if not exists public.dashboard_layouts (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles(id) on delete cascade,
  brand_id    uuid references public.brands(id)   on delete cascade,
  layout      jsonb not null default '{"version":1,"widgets":[]}'::jsonb,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- one layout per (user, brand) pair, treating null as a real value so there
  -- is exactly one global default and one default per brand.
  constraint dashboard_layouts_user_brand_key unique nulls not distinct (user_id, brand_id)
);

create index if not exists idx_dashboard_layouts_brand on public.dashboard_layouts(brand_id);

-- Who may build a personal dashboard: the operational tiers.
create or replace function public.can_customise_dashboard()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager', 'manager')
  );
$$ language sql security definer stable;

-- Keep updated_at / updated_by honest.
create or replace function public.touch_dashboard_layout()
returns trigger as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_dashboard_layout on public.dashboard_layouts;
create trigger trg_touch_dashboard_layout
  before insert or update on public.dashboard_layouts
  for each row execute function public.touch_dashboard_layout();

alter table public.dashboard_layouts enable row level security;

drop policy if exists "dashboard_layouts_select" on public.dashboard_layouts;
create policy "dashboard_layouts_select" on public.dashboard_layouts
  for select using (
    auth.uid() is not null
    and (user_id is null or user_id = auth.uid())
  );

-- Defaults (user_id null) are superadmin-only; personal rows belong to their
-- owner and require a manager-tier role.
drop policy if exists "dashboard_layouts_insert" on public.dashboard_layouts;
create policy "dashboard_layouts_insert" on public.dashboard_layouts
  for insert with check (
    (user_id is null and public.is_superadmin())
    or (user_id = auth.uid() and public.can_customise_dashboard())
  );

drop policy if exists "dashboard_layouts_update" on public.dashboard_layouts;
create policy "dashboard_layouts_update" on public.dashboard_layouts
  for update
  using (
    (user_id is null and public.is_superadmin())
    or (user_id = auth.uid() and public.can_customise_dashboard())
  )
  with check (
    (user_id is null and public.is_superadmin())
    or (user_id = auth.uid() and public.can_customise_dashboard())
  );

drop policy if exists "dashboard_layouts_delete" on public.dashboard_layouts;
create policy "dashboard_layouts_delete" on public.dashboard_layouts
  for delete using (
    (user_id is null and public.is_superadmin())
    or (user_id = auth.uid() and public.can_customise_dashboard())
  );
