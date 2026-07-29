-- ============================================================================
-- 035 — Brands
--   Introduces a brand concept so venues (restaurants) can belong to different
--   brands, not just Pollo Rotisserie. Adds:
--     * brands table (name, colour, icon)
--     * restaurants.brand_id
--   Seeds a default "Pollo Rotisserie" brand and backfills all existing venues.
--
--   Safe to re-run.
-- ============================================================================

-- ── 1. Brands catalogue ──────────────────────────────────────────────────────
create table if not exists public.brands (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  color      text not null default '#C9A84C',   -- hex, drives the app accent
  icon       text not null default 'Bird',       -- lucide icon key
  created_at timestamptz not null default now()
);

alter table public.brands enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='brands' and policyname='brands_select') then
    create policy "brands_select" on public.brands for select using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename='brands' and policyname='brands_insert') then
    create policy "brands_insert" on public.brands for insert with check (public.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='brands' and policyname='brands_update') then
    create policy "brands_update" on public.brands for update using (public.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='brands' and policyname='brands_delete') then
    create policy "brands_delete" on public.brands for delete using (public.is_superadmin());
  end if;
end $$;

-- ── 2. Link restaurants to a brand ───────────────────────────────────────────
alter table public.restaurants
  add column if not exists brand_id uuid references public.brands on delete set null;

create index if not exists idx_restaurants_brand on public.restaurants(brand_id);

-- ── 3. Seed the default brand and backfill existing venues ───────────────────
insert into public.brands (name, color, icon)
values ('Pollo Rotisserie', '#C9A84C', 'Bird')
on conflict (name) do nothing;

update public.restaurants
set brand_id = (select id from public.brands where name = 'Pollo Rotisserie')
where brand_id is null;
