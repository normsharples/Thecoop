-- ============================================================================
-- 073. RECIPE BOOK — R1: model, book, costing
--   See RECIPE_BOOK_PLAN.md. This is also the foundation of INVENTORY_PLAN.md
--   Phase C (menu recipes → POS aliases → nightly depletion), which lands in R3.
--
--   * recipes                — one table, two types: 'prep' (batch) | 'menu' (POS item)
--   * recipe_lines           — a line is EITHER a food_cost_item OR another recipe,
--                              so sub-recipes and combos nest
--   * recipe_steps           — numbered method, one optional photo per step
--   * recipe_venue_settings  — per-venue availability + par level (par used in R2)
--   * unit conversion        — enter in any unit, store the converted base qty
--   * recipe_explode()       — flatten to raw items through any depth, cycle-guarded
--   * recipe_cost()          — standard (global) or live (per-venue moving avg)
--
--   DEFENSIVE BY DESIGN: the migrations folder is not the live DB. Everything
--   here is idempotent, and every reference to the inventory tables (030+) and
--   to sales_mix_daily (072) is guarded with to_regclass so this migration
--   applies and runs correctly whether or not those are live yet. Live-basis
--   costing silently falls back to standard cost when inventory_levels is absent.
--
--   Safe to re-run.
-- ============================================================================


-- ── 0. Helper: the operational tier (superadmin / area_manager / manager) ────
-- Mirrors is_roster_manager() but named for what it gates here. Cost figures
-- never leave the server for anyone below this line.
create or replace function public.can_manage_recipe_ops()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('superadmin', 'area_manager', 'manager')
  );
$$ language sql security definer stable;


-- ── 1. Units ─────────────────────────────────────────────────────────────────
-- Three families, each with a base: mass → kg, volume → L, count → each.
-- Anything not listed is an opaque unit that only converts to itself.
create or replace function public.unit_base(p_unit text)
returns table (family text, to_base numeric)
language sql immutable as $$
  select f.family, f.to_base
  from (values
    ('mg','mass',0.000001),
    ('g','mass',0.001),('gram','mass',0.001),('grams','mass',0.001),('gm','mass',0.001),
    ('kg','mass',1),('kilo','mass',1),('kilos','mass',1),('kilogram','mass',1),('kilograms','mass',1),
    ('ml','volume',0.001),('millilitre','volume',0.001),('millilitres','volume',0.001),
    ('milliliter','volume',0.001),('milliliters','volume',0.001),
    ('l','volume',1),('lt','volume',1),('ltr','volume',1),('litre','volume',1),('litres','volume',1),
    ('liter','volume',1),('liters','volume',1),
    ('each','count',1),('ea','count',1),('unit','count',1),('units','count',1),
    ('pc','count',1),('pcs','count',1),('piece','count',1),('pieces','count',1),
    ('portion','count',1),('portions','count',1),('serve','count',1),('serves','count',1)
  ) as f(u, family, to_base)
  where f.u = lower(btrim(coalesce(p_unit, '')));
$$;

comment on function public.unit_base(text) is
  'Unit → (family, factor to that family base). Bases: mass=kg, volume=L, count=each. Empty result = unrecognised unit.';

-- Convert a quantity between units. Returns NULL when the conversion is not
-- possible — the caller surfaces that as a recipe issue rather than guessing.
-- Cross-family conversion is supported for mass ↔ count only, via the item's
-- weight_per_each (stored in kg).
create or replace function public.convert_qty(
  p_qty             numeric,
  p_from            text,
  p_to              text,
  p_weight_per_each numeric default null
) returns numeric
language plpgsql immutable as $$
declare
  f_family text; f_base numeric;
  t_family text; t_base numeric;
begin
  if p_qty is null then return null; end if;

  select family, to_base into f_family, f_base from public.unit_base(p_from);
  select family, to_base into t_family, t_base from public.unit_base(p_to);

  -- Unrecognised unit on either side: only an exact text match passes through.
  if f_family is null or t_family is null then
    if lower(btrim(coalesce(p_from, ''))) = lower(btrim(coalesce(p_to, ''))) then
      return p_qty;
    end if;
    return null;
  end if;

  if f_family = t_family then
    return p_qty * f_base / t_base;
  end if;

  if p_weight_per_each is null or p_weight_per_each <= 0 then
    return null;
  end if;

  if f_family = 'mass' and t_family = 'count' then
    return (p_qty * f_base) / p_weight_per_each;          -- kg → each
  elsif f_family = 'count' and t_family = 'mass' then
    return (p_qty * p_weight_per_each) / t_base;          -- each → kg → target
  end if;

  return null;  -- volume ↔ count needs a density we don't hold
end $$;

comment on function public.convert_qty(numeric, text, text, numeric) is
  'Convert a quantity between units. NULL = not convertible (surfaced by recipe_issues, never guessed).';


-- ── 2. Item catalogue additions ──────────────────────────────────────────────
alter table public.food_cost_items
  add column if not exists allergens       text[] not null default '{}';
alter table public.food_cost_items
  add column if not exists weight_per_each numeric;

comment on column public.food_cost_items.weight_per_each is
  'Kilograms per "each" — lets a recipe call for 180 g of an item stocked by the each (and vice versa).';
comment on column public.food_cost_items.allergens is
  'Allergen tags on the ingredient. Recipe allergens are DERIVED from these, never typed, so they cannot go stale.';


-- ── 3. Recipes ───────────────────────────────────────────────────────────────
create table if not exists public.recipes (
  id                       uuid primary key default uuid_generate_v4(),
  name                     text not null,
  type                     text not null default 'prep' check (type in ('prep','menu')),
  category                 text,
  description              text,
  method_intro             text,

  -- Yield is the NET usable output: what you actually end up with, already
  -- net of trim and cook loss. Cost per yield unit = ingredient cost / yield_qty.
  yield_qty                numeric not null default 1 check (yield_qty > 0),
  yield_unit               text    not null default 'each',
  portions                 numeric check (portions is null or portions > 0),
  -- Expected loss against raw input. Display + R2 production variance only;
  -- it does NOT enter the cost maths (yield_qty already carries it).
  yield_loss_pct           numeric check (yield_loss_pct is null or (yield_loss_pct >= 0 and yield_loss_pct < 100)),

  -- false (default) = explode at sale: consuming this consumes its ingredients.
  -- true            = production-logged stocked batch (R2); its output is a
  --                   tracked item in its own right and parents consume THAT.
  is_stocked               boolean not null default false,
  output_food_cost_item_id uuid references public.food_cost_items on delete set null,

  shelf_life_hours         numeric check (shelf_life_hours is null or shelf_life_hours > 0),
  prep_time_mins           integer check (prep_time_mins is null or prep_time_mins >= 0),
  equipment                text,
  station_id               uuid references public.positions on delete set null,
  hero_image_path          text,
  -- Allergens introduced by the process, not by an ingredient (shared fryer).
  extra_allergens          text[] not null default '{}',

  active                   boolean not null default true,
  created_by               uuid references public.profiles on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- Only a prep batch can be stocked; a menu item is sold, not stored.
  constraint recipes_stocked_is_prep check (type = 'prep' or is_stocked = false)
);

create index if not exists idx_recipes_type     on public.recipes(type) where active;
create index if not exists idx_recipes_name     on public.recipes(lower(name));
create index if not exists idx_recipes_station  on public.recipes(station_id);
create index if not exists idx_recipes_output   on public.recipes(output_food_cost_item_id);

comment on table public.recipes is
  'The recipe book. type=prep is a batch made in-house; type=menu is what the POS sells. Global — one spec for every venue; per-venue differences live in recipe_venue_settings.';


-- ── 4. Recipe lines ──────────────────────────────────────────────────────────
-- A line is EITHER an ingredient or another recipe. qty_stock_units is the
-- quantity in the component's own base unit — the item's stock unit, or the
-- sub-recipe's yield unit — stamped by trigger, exactly like invoice_lines.
create table if not exists public.recipe_lines (
  id                uuid primary key default uuid_generate_v4(),
  recipe_id         uuid not null references public.recipes on delete cascade,
  component_type    text not null check (component_type in ('item','recipe')),
  food_cost_item_id uuid references public.food_cost_items on delete restrict,
  sub_recipe_id     uuid references public.recipes         on delete restrict,

  qty_entered       numeric not null check (qty_entered > 0),
  unit_entered      text,
  qty_stock_units   numeric,          -- NULL = unit not convertible; flagged, never guessed

  note              text,             -- "finely diced", "reserve the juice"
  optional          boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),

  constraint recipe_lines_one_component check (
    (component_type = 'item'   and food_cost_item_id is not null and sub_recipe_id is null) or
    (component_type = 'recipe' and sub_recipe_id     is not null and food_cost_item_id is null)
  ),
  constraint recipe_lines_no_self check (sub_recipe_id is null or sub_recipe_id <> recipe_id)
);

create index if not exists idx_recipe_lines_recipe on public.recipe_lines(recipe_id, sort_order);
create index if not exists idx_recipe_lines_item   on public.recipe_lines(food_cost_item_id);
create index if not exists idx_recipe_lines_sub    on public.recipe_lines(sub_recipe_id);


-- ── 5. Method steps ──────────────────────────────────────────────────────────
create table if not exists public.recipe_steps (
  id         uuid primary key default uuid_generate_v4(),
  recipe_id  uuid not null references public.recipes on delete cascade,
  step_no    integer not null check (step_no > 0),
  body       text not null,
  image_path text,
  created_at timestamptz not null default now(),
  unique (recipe_id, step_no)
);

create index if not exists idx_recipe_steps_recipe on public.recipe_steps(recipe_id, step_no);


-- ── 6. Per-venue settings ────────────────────────────────────────────────────
-- Recipes are global. A venue only decides whether it makes the item, and how
-- much it wants on hand (par drives the R2 prep list).
create table if not exists public.recipe_venue_settings (
  recipe_id     uuid not null references public.recipes     on delete cascade,
  restaurant_id uuid not null references public.restaurants on delete cascade,
  available     boolean not null default true,
  par_qty       numeric check (par_qty is null or par_qty >= 0),
  par_unit      text,
  updated_at    timestamptz not null default now(),
  primary key (recipe_id, restaurant_id)
);

create index if not exists idx_recipe_venue_restaurant on public.recipe_venue_settings(restaurant_id);


-- ── 7. Triggers ──────────────────────────────────────────────────────────────
-- Stamp qty_stock_units from whatever unit the line was typed in.
create or replace function public.recipe_line_stamp()
returns trigger language plpgsql as $$
declare
  v_base_unit text;
  v_wpe       numeric;
begin
  if new.component_type = 'item' then
    select fci.unit, fci.weight_per_each
      into v_base_unit, v_wpe
      from public.food_cost_items fci
     where fci.id = new.food_cost_item_id;
  else
    select r.yield_unit, null::numeric
      into v_base_unit, v_wpe
      from public.recipes r
     where r.id = new.sub_recipe_id;
  end if;

  -- No unit typed = the line is already in the component's own unit.
  new.qty_stock_units := public.convert_qty(
    new.qty_entered,
    coalesce(nullif(btrim(new.unit_entered), ''), v_base_unit),
    v_base_unit,
    v_wpe
  );
  return new;
end $$;

drop trigger if exists trg_recipe_line_stamp on public.recipe_lines;
create trigger trg_recipe_line_stamp
  before insert or update of qty_entered, unit_entered, food_cost_item_id, sub_recipe_id, component_type
  on public.recipe_lines
  for each row execute function public.recipe_line_stamp();

-- Changing an item's unit or weight_per_each silently invalidates every line
-- that referenced it. Restamp them rather than leaving stale conversions.
create or replace function public.recipe_restamp_for_item()
returns trigger language plpgsql as $$
begin
  if new.unit is distinct from old.unit
     or new.weight_per_each is distinct from old.weight_per_each then
    update public.recipe_lines
       set qty_entered = qty_entered   -- no-op write; fires the stamp trigger
     where component_type = 'item' and food_cost_item_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_recipe_restamp_for_item on public.food_cost_items;
create trigger trg_recipe_restamp_for_item
  after update of unit, weight_per_each on public.food_cost_items
  for each row execute function public.recipe_restamp_for_item();

create or replace function public.recipe_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_recipe_touch on public.recipes;
create trigger trg_recipe_touch
  before update on public.recipes
  for each row execute function public.recipe_touch();

-- Same idea for a sub-recipe's yield unit, but this MUST run AFTER the update:
-- a BEFORE trigger would restamp the children while recipes still holds the old
-- yield_unit, leaving every parent line converted against the unit that just
-- changed. (Caught by the dry-run; do not move it back to BEFORE.)
create or replace function public.recipe_restamp_children()
returns trigger language plpgsql as $$
begin
  if new.yield_unit is distinct from old.yield_unit then
    update public.recipe_lines
       set qty_entered = qty_entered   -- no-op write; fires the stamp trigger
     where component_type = 'recipe' and sub_recipe_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists trg_recipe_restamp_children on public.recipes;
create trigger trg_recipe_restamp_children
  after update of yield_unit on public.recipes
  for each row execute function public.recipe_restamp_children();


-- ── 8. RLS ───────────────────────────────────────────────────────────────────
-- Read: every signed-in role, staff included — the book is a training document.
-- These tables carry NO cost column; cost only ever comes from the RPCs below,
-- which are gated on can_manage_recipe_ops().
-- Write: superadmin owns the spec. Managers get photos (via RPC) and par levels.
alter table public.recipes               enable row level security;
alter table public.recipe_lines          enable row level security;
alter table public.recipe_steps          enable row level security;
alter table public.recipe_venue_settings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['recipes','recipe_lines','recipe_steps'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_select') then
      execute format('create policy %I on public.%I for select using (auth.uid() is not null)', t||'_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_insert') then
      execute format('create policy %I on public.%I for insert with check (public.is_superadmin())', t||'_insert', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_update') then
      execute format('create policy %I on public.%I for update using (public.is_superadmin())', t||'_update', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_delete') then
      execute format('create policy %I on public.%I for delete using (public.is_superadmin())', t||'_delete', t);
    end if;
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='recipe_venue_settings' and policyname='rvs_select') then
    create policy "rvs_select" on public.recipe_venue_settings
      for select using (auth.uid() is not null);
  end if;
  -- Par + availability are the venue's business: manager tier, own venues.
  if not exists (select 1 from pg_policies where tablename='recipe_venue_settings' and policyname='rvs_insert') then
    create policy "rvs_insert" on public.recipe_venue_settings
      for insert with check (public.has_non_staff_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='recipe_venue_settings' and policyname='rvs_update') then
    create policy "rvs_update" on public.recipe_venue_settings
      for update using (public.has_non_staff_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='recipe_venue_settings' and policyname='rvs_delete') then
    create policy "rvs_delete" on public.recipe_venue_settings
      for delete using (public.is_superadmin());
  end if;
end $$;


-- ── 9. Photos ────────────────────────────────────────────────────────────────
-- Managers can put a picture on a card without being able to touch the spec.
-- Postgres has no column-level RLS, so the write goes through a definer RPC.
create or replace function public.recipe_set_photo(p_recipe_id uuid, p_path text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.can_manage_recipe_ops() then
    raise exception 'recipe_set_photo: insufficient privilege' using errcode = '42501';
  end if;
  update public.recipes set hero_image_path = p_path where id = p_recipe_id;
end $$;

create or replace function public.recipe_step_set_photo(p_step_id uuid, p_path text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.can_manage_recipe_ops() then
    raise exception 'recipe_step_set_photo: insufficient privilege' using errcode = '42501';
  end if;
  update public.recipe_steps set image_path = p_path where id = p_step_id;
end $$;

-- Public bucket: recipe photos are not sensitive, and useFileUpload resolves
-- them with getPublicUrl.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-media', 'recipe-media', true, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='recipe_media_select') then
    create policy "recipe_media_select" on storage.objects
      for select using (bucket_id = 'recipe-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='recipe_media_insert') then
    create policy "recipe_media_insert" on storage.objects
      for insert with check (bucket_id = 'recipe-media' and public.can_manage_recipe_ops());
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='recipe_media_delete') then
    create policy "recipe_media_delete" on storage.objects
      for delete using (bucket_id = 'recipe-media' and public.can_manage_recipe_ops());
  end if;
end $$;


-- ── 10. Explode: flatten a recipe to raw items ───────────────────────────────
-- Walks sub-recipes to any depth, scaling by each sub-recipe's yield, and
-- STOPS at a stocked prep recipe — that one's output is a tracked item in its
-- own right, so the parent consumes the item, not the ingredients behind it.
-- Cycle-guarded by path membership and a depth cap; a line whose unit could not
-- be converted surfaces as incomplete rather than silently costing nothing.
create or replace function public.recipe_explode(
  p_recipe_id uuid,
  p_batches   numeric default 1
) returns table (food_cost_item_id uuid, qty numeric, incomplete boolean)
language sql stable as $$
  with recursive exp as (
    select rl.component_type,
           rl.food_cost_item_id,
           rl.sub_recipe_id,
           rl.qty_stock_units * p_batches      as qty,
           array[p_recipe_id]::uuid[]          as path
      from public.recipe_lines rl
     where rl.recipe_id = p_recipe_id

    union all

    select rl.component_type,
           rl.food_cost_item_id,
           rl.sub_recipe_id,
           rl.qty_stock_units * (e.qty / nullif(sr.yield_qty, 0)),
           e.path || e.sub_recipe_id
      from exp e
      join public.recipes sr
        on sr.id = e.sub_recipe_id
       and coalesce(sr.is_stocked, false) = false
      join public.recipe_lines rl
        on rl.recipe_id = e.sub_recipe_id
     where e.component_type = 'recipe'
       and not (e.sub_recipe_id = any (e.path))
       and coalesce(array_length(e.path, 1), 0) < 12
  ),
  leaves as (
    select coalesce(e.food_cost_item_id, sr.output_food_cost_item_id) as item_id,
           e.qty
      from exp e
      left join public.recipes sr
        on sr.id = e.sub_recipe_id
       and coalesce(sr.is_stocked, false) = true
     where e.component_type = 'item'
        or sr.id is not null
  )
  select item_id, sum(qty), bool_or(qty is null)
    from leaves
   where item_id is not null
   group by item_id;
$$;

comment on function public.recipe_explode(uuid, numeric) is
  'Flatten a recipe to raw food_cost_items. Stops at stocked prep recipes (they are stock themselves). Cycle-guarded, depth-capped at 12. incomplete=true means a line unit could not be converted.';


-- ── 11. Cost ─────────────────────────────────────────────────────────────────
-- basis 'live'     → that venue's moving-average from inventory_levels,
--                    falling back to the global standard cost per item.
-- basis 'standard' → food_cost_items.cost_per_unit everywhere.
-- Live basis degrades to standard when the inventory tables are not live yet.
-- Gated: nobody below the manager tier can obtain a cost figure.
create or replace function public.recipe_cost(
  p_recipe_id     uuid,
  p_restaurant_id uuid default null,
  p_basis         text default 'live'
) returns table (
  total_cost          numeric,
  cost_per_yield_unit numeric,
  cost_per_portion    numeric,
  missing_cost_items  integer,
  incomplete          boolean
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_live       boolean;
  v_yield      numeric;
  v_portions   numeric;
  v_total      numeric := 0;
  v_missing    integer := 0;
  v_incomplete boolean := false;
begin
  if not public.can_manage_recipe_ops() then
    raise exception 'recipe_cost: insufficient privilege' using errcode = '42501';
  end if;

  select r.yield_qty, r.portions into v_yield, v_portions
    from public.recipes r where r.id = p_recipe_id;
  if v_yield is null then return; end if;

  v_live := (coalesce(p_basis, 'live') = 'live'
             and p_restaurant_id is not null
             and to_regclass('public.inventory_levels') is not null);

  if v_live then
    execute $q$
      select coalesce(sum(x.qty * coalesce(nullif(il.avg_cost, 0), fci.cost_per_unit, 0)), 0),
             count(*) filter (
               where coalesce(nullif(il.avg_cost, 0), nullif(fci.cost_per_unit, 0)) is null),
             coalesce(bool_or(x.incomplete), false)
        from public.recipe_explode($1, 1) x
        join public.food_cost_items fci on fci.id = x.food_cost_item_id
        left join public.inventory_levels il
               on il.food_cost_item_id = x.food_cost_item_id
              and il.restaurant_id     = $2
    $q$
    into v_total, v_missing, v_incomplete
    using p_recipe_id, p_restaurant_id;
  else
    select coalesce(sum(x.qty * coalesce(fci.cost_per_unit, 0)), 0),
           count(*) filter (where nullif(fci.cost_per_unit, 0) is null),
           coalesce(bool_or(x.incomplete), false)
      into v_total, v_missing, v_incomplete
      from public.recipe_explode(p_recipe_id, 1) x
      join public.food_cost_items fci on fci.id = x.food_cost_item_id;
  end if;

  return query select
    coalesce(v_total, 0),
    case when v_yield > 0 then coalesce(v_total, 0) / v_yield end,
    case when coalesce(v_portions, 0) > 0 then coalesce(v_total, 0) / v_portions end,
    coalesce(v_missing, 0),
    coalesce(v_incomplete, false);
end $$;

-- One round trip for the whole book (the list view would otherwise be N calls).
create or replace function public.recipe_cost_all(
  p_restaurant_id uuid default null,
  p_basis         text default 'live'
) returns table (
  recipe_id           uuid,
  total_cost          numeric,
  cost_per_yield_unit numeric,
  cost_per_portion    numeric,
  missing_cost_items  integer,
  incomplete          boolean
)
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  c record;
begin
  if not public.can_manage_recipe_ops() then
    raise exception 'recipe_cost_all: insufficient privilege' using errcode = '42501';
  end if;

  for r in select id from public.recipes where active order by name loop
    select * into c from public.recipe_cost(r.id, p_restaurant_id, p_basis);
    recipe_id           := r.id;
    total_cost          := c.total_cost;
    cost_per_yield_unit := c.cost_per_yield_unit;
    cost_per_portion    := c.cost_per_portion;
    missing_cost_items  := c.missing_cost_items;
    incomplete          := c.incomplete;
    return next;
  end loop;
end $$;


-- ── 12. Allergens (derived, never typed) ─────────────────────────────────────
-- Staff-callable: carries no cost.
create or replace function public.recipe_allergens(p_recipe_id uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select array_agg(distinct s.a order by s.a)
      from (
        select unnest(fci.allergens) as a
          from public.recipe_explode(p_recipe_id, 1) x
          join public.food_cost_items fci on fci.id = x.food_cost_item_id
        union
        select unnest(r.extra_allergens)
          from public.recipes r
         where r.id = p_recipe_id
      ) s
     where s.a is not null and btrim(s.a) <> ''
  ), '{}'::text[]);
$$;


-- ── 13. Recipe health ────────────────────────────────────────────────────────
-- What is wrong with this recipe, in the order it matters. Manager tier only.
create or replace function public.recipe_issues(p_recipe_id uuid)
returns table (kind text, detail text)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.can_manage_recipe_ops() then
    raise exception 'recipe_issues: insufficient privilege' using errcode = '42501';
  end if;

  -- No lines at all
  return query
    select 'no_lines'::text, 'This recipe has no ingredients yet.'::text
     where not exists (select 1 from public.recipe_lines rl where rl.recipe_id = p_recipe_id);

  -- Units that could not be converted
  return query
    select 'unit'::text,
           format('%s: %s %s cannot be converted to %s',
                  coalesce(fci.name, sr.name, '?'),
                  rl.qty_entered, coalesce(rl.unit_entered, '?'),
                  coalesce(fci.unit, sr.yield_unit, '?'))
      from public.recipe_lines rl
      left join public.food_cost_items fci on fci.id = rl.food_cost_item_id
      left join public.recipes sr          on sr.id  = rl.sub_recipe_id
     where rl.recipe_id = p_recipe_id
       and rl.qty_stock_units is null;

  -- Stocked prep recipe with nowhere to put the output
  return query
    select 'stocked_without_output'::text,
           'This batch is stocked but has no output item, so production cannot post to the ledger.'::text
      from public.recipes r
     where r.id = p_recipe_id
       and r.is_stocked
       and r.output_food_cost_item_id is null;

  -- Ingredients with no cost on file
  return query
    select 'missing_cost'::text, format('%s has no cost per unit set.', fci.name)
      from public.recipe_explode(p_recipe_id, 1) x
      join public.food_cost_items fci on fci.id = x.food_cost_item_id
     where coalesce(fci.cost_per_unit, 0) = 0;

  -- Circular sub-recipes
  return query
    with recursive walk as (
      select rl.sub_recipe_id as rid,
             array[p_recipe_id]::uuid[] as path,
             false as cyc
        from public.recipe_lines rl
       where rl.recipe_id = p_recipe_id and rl.component_type = 'recipe'
      union all
      select rl.sub_recipe_id,
             w.path || w.rid,
             (rl.sub_recipe_id = any (w.path || w.rid))
        from walk w
        join public.recipe_lines rl
          on rl.recipe_id = w.rid and rl.component_type = 'recipe'
       where not w.cyc
         and coalesce(array_length(w.path, 1), 0) < 12
    )
    select distinct 'cycle'::text,
           format('%s refers back into itself through a sub-recipe.',
                  coalesce((select name from public.recipes where id = w.rid), 'A sub-recipe'))
      from walk w
     where w.cyc;
end $$;


-- ── 14. Coverage + the unmapped queue (drives the R1 rollout) ────────────────
-- R1 matches a POS product to a menu recipe on NAME. R3 replaces this with
-- pos_product_aliases; the shape of the answer stays the same.
create or replace function public.recipe_coverage(
  p_restaurant_id uuid default null,
  p_from          date default (now() at time zone 'utc')::date - 27,
  p_to            date default (now() at time zone 'utc')::date
) returns table (
  total_sales       numeric,
  mapped_sales      numeric,
  coverage_pct      numeric,
  unmapped_products integer
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.can_manage_recipe_ops() then
    raise exception 'recipe_coverage: insufficient privilege' using errcode = '42501';
  end if;

  if to_regclass('public.sales_mix_daily') is null then
    return query select 0::numeric, 0::numeric, 0::numeric, 0;
    return;
  end if;

  return query execute $q$
    with p as (
      select smd.item_name, sum(coalesce(smd.sales_amount, 0)) as amt
        from public.sales_mix_daily smd
       where smd.level = 'product'
         and ($1::uuid is null or smd.restaurant_id = $1::uuid)
         and smd.business_date between $2 and $3
       group by smd.item_name
    ), m as (
      select p.item_name, p.amt,
             exists (
               select 1 from public.recipes r
                where r.type = 'menu' and r.active
                  and lower(btrim(r.name)) = lower(btrim(p.item_name))
             ) as mapped
        from p
    )
    select coalesce(sum(m.amt), 0),
           coalesce(sum(m.amt) filter (where m.mapped), 0),
           case when coalesce(sum(m.amt), 0) > 0
                then round(100 * coalesce(sum(m.amt) filter (where m.mapped), 0) / sum(m.amt), 1)
                else 0 end,
           (count(*) filter (where not m.mapped))::integer
      from m
  $q$ using p_restaurant_id, p_from, p_to;
end $$;

-- The work list: POS products with no menu recipe, biggest money first.
create or replace function public.recipe_unmapped_products(
  p_restaurant_id uuid default null,
  p_from          date default (now() at time zone 'utc')::date - 27,
  p_to            date default (now() at time zone 'utc')::date,
  p_limit         integer default 50
) returns table (
  item_name     text,
  category_name text,
  sales_amount  numeric,
  quantity      numeric
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.can_manage_recipe_ops() then
    raise exception 'recipe_unmapped_products: insufficient privilege' using errcode = '42501';
  end if;

  if to_regclass('public.sales_mix_daily') is null then
    return;
  end if;

  return query execute $q$
    select smd.item_name,
           max(smd.category_name),
           sum(coalesce(smd.sales_amount, 0)),
           sum(coalesce(smd.quantity, 0))
      from public.sales_mix_daily smd
     where smd.level = 'product'
       and ($1::uuid is null or smd.restaurant_id = $1::uuid)
       and smd.business_date between $2 and $3
       and not exists (
         select 1 from public.recipes r
          where r.type = 'menu' and r.active
            and lower(btrim(r.name)) = lower(btrim(smd.item_name))
       )
     group by smd.item_name
     order by 3 desc
     limit $4
  $q$ using p_restaurant_id, p_from, p_to, p_limit;
end $$;


-- ── 15. Migrate the existing stock-count recipes ─────────────────────────────
-- Ids are preserved, so StockCountsPage keeps working against the same rows
-- after it is repointed, and re-running this migration cannot duplicate them.
-- The old tables are left in place, unused, until Norm has verified the move.
do $$
declare
  v_recipes integer := 0;
  v_lines   integer := 0;
  v_skipped integer := 0;
begin
  if to_regclass('public.stock_count_recipes') is null then
    raise notice 'recipe_book: no stock_count_recipes table — nothing to migrate.';
    return;
  end if;

  insert into public.recipes
    (id, name, type, category, description, yield_qty, yield_unit, is_stocked, active, created_at)
  select scr.id,
         scr.name,
         'prep',
         scr.category,
         scr.description,
         1,
         coalesce(nullif(btrim(scr.yield_unit), ''), 'each'),
         false,
         true,
         scr.created_at
    from public.stock_count_recipes scr
  on conflict (id) do nothing;
  get diagnostics v_recipes = row_count;

  if to_regclass('public.stock_count_recipe_ingredients') is not null then
    -- Existing quantities are already in the item's stock unit, so the unit is
    -- stamped as that and converts 1:1.
    insert into public.recipe_lines
      (id, recipe_id, component_type, food_cost_item_id, qty_entered, unit_entered, sort_order, created_at)
    select i.id, i.recipe_id, 'item', i.food_cost_item_id, i.quantity, fci.unit, 0, i.created_at
      from public.stock_count_recipe_ingredients i
      join public.food_cost_items fci on fci.id = i.food_cost_item_id
      join public.recipes r           on r.id  = i.recipe_id
     where coalesce(i.quantity, 0) > 0
    on conflict (id) do nothing;
    get diagnostics v_lines = row_count;

    select count(*) into v_skipped
      from public.stock_count_recipe_ingredients i
     where coalesce(i.quantity, 0) <= 0;
  end if;

  raise notice 'recipe_book: migrated % recipes, % lines (% zero-qty lines skipped).',
    v_recipes, v_lines, v_skipped;
end $$;
