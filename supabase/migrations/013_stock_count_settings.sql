-- Migration 013 — Stock count locations, recipes, and recipe ingredients

-- ============================================================================
-- 1. ADD LOCATION COLUMN TO food_cost_items
-- ============================================================================

alter table public.food_cost_items
  add column if not exists location text;

-- ============================================================================
-- 2. STOCK COUNT LOCATIONS
-- ============================================================================

create table if not exists public.stock_count_locations (
  id            uuid        primary key default uuid_generate_v4(),
  name          text        not null,
  description   text,
  display_order integer     not null default 0,
  active        boolean     not null default true,
  created_at    timestamptz not null default now()
);

alter table public.stock_count_locations enable row level security;

create policy "stock_count_locations_select" on public.stock_count_locations
  for select using (auth.uid() is not null);

create policy "stock_count_locations_insert" on public.stock_count_locations
  for insert with check (public.is_superadmin());

create policy "stock_count_locations_update" on public.stock_count_locations
  for update using (public.is_superadmin());

create policy "stock_count_locations_delete" on public.stock_count_locations
  for delete using (public.is_superadmin());

-- ============================================================================
-- 3. STOCK COUNT RECIPES
-- ============================================================================

create table if not exists public.stock_count_recipes (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  category    text,
  description text,
  yield_unit  text        not null default 'each',
  created_at  timestamptz not null default now()
);

alter table public.stock_count_recipes enable row level security;

create policy "stock_count_recipes_select" on public.stock_count_recipes
  for select using (auth.uid() is not null);

create policy "stock_count_recipes_insert" on public.stock_count_recipes
  for insert with check (public.is_superadmin());

create policy "stock_count_recipes_update" on public.stock_count_recipes
  for update using (public.is_superadmin());

create policy "stock_count_recipes_delete" on public.stock_count_recipes
  for delete using (public.is_superadmin());

-- ============================================================================
-- 4. STOCK COUNT RECIPE INGREDIENTS
-- ============================================================================

create table if not exists public.stock_count_recipe_ingredients (
  id                uuid        primary key default uuid_generate_v4(),
  recipe_id         uuid        not null references public.stock_count_recipes on delete cascade,
  food_cost_item_id uuid        not null references public.food_cost_items on delete cascade,
  quantity          numeric     not null check (quantity > 0),
  created_at        timestamptz not null default now()
);

create index idx_recipe_ingredients_recipe on public.stock_count_recipe_ingredients(recipe_id);

alter table public.stock_count_recipe_ingredients enable row level security;

create policy "recipe_ingredients_select" on public.stock_count_recipe_ingredients
  for select using (auth.uid() is not null);

create policy "recipe_ingredients_insert" on public.stock_count_recipe_ingredients
  for insert with check (public.is_superadmin());

create policy "recipe_ingredients_update" on public.stock_count_recipe_ingredients
  for update using (public.is_superadmin());

create policy "recipe_ingredients_delete" on public.stock_count_recipe_ingredients
  for delete using (public.is_superadmin());
