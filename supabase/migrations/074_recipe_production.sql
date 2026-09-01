-- ============================================================================
-- 074. RECIPE BOOK — R2: production logging, par levels, prep list
--   See RECIPE_BOOK_PLAN.md. Builds on 073 (recipes) and 030 (the ledger).
--
--   * production_in / production_out movement types + the costing rules for them
--   * production_runs   — a logged batch: what was made, how much came out, cost
--   * prep_checks       — a light on-hand snapshot for recipes that aren't stocked
--   * post_production_run / void_production_run / prep_list RPCs
--   * kiosk_recipes / kiosk_recipe / kiosk_prep_list / kiosk_prep_done — the
--     tablet's cost-free anon surface, following the 071 device-token pattern
--
--   THE RULE THAT MATTERS: a production run only touches the ledger when the
--   recipe is_stocked. A non-stocked prep recipe explodes at sale — consuming
--   its ingredients at production time as well would deplete them twice. Those
--   runs are still recorded (for the prep list, labels and "who made it"), they
--   just post nothing. posted=false says so on the row.
--
--   Guarded with to_regclass throughout, so it applies whether or not the
--   inventory tables (030) are live.
--
--   Safe to re-run.
-- ============================================================================


-- ── 1. Two new movement types ────────────────────────────────────────────────
-- production_in  → COSTED RECEIPT: the batch output, priced at the rolled cost
--                  of what went into it (cost carries, exactly like a transfer)
-- production_out → ISSUE: the ingredients, valued at the current average
do $$
declare
  v_con text;
begin
  if to_regclass('public.inventory_movements') is null then
    raise notice 'recipe_production: inventory_movements not present — skipping ledger wiring.';
    return;
  end if;

  select con.conname into v_con
    from pg_constraint con
   where con.conrelid = 'public.inventory_movements'::regclass
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%movement_type%';

  if v_con is not null then
    execute format('alter table public.inventory_movements drop constraint %I', v_con);
  end if;

  alter table public.inventory_movements
    add constraint inventory_movements_movement_type_check
    check (movement_type in (
      'opening','purchase','sale_depletion','waste','count_adjustment',
      'transfer_out','transfer_in','in_transit_loss',
      'production_in','production_out'));
end $$;

-- One place that decides what a costed receipt is, so the next new type is a
-- one-line change instead of two function bodies.
create or replace function public.inv_is_receipt(p_type text)
returns boolean language sql immutable as $$
  select p_type in ('purchase','transfer_in','opening','production_in');
$$;


-- ── 2. Re-state 030's costing triggers with production_in as a receipt ───────
-- These SUPERSEDE the definitions in 030_inventory_core.sql. The only change is
-- that both now ask inv_is_receipt() instead of listing the types inline.
do $$ begin
  if to_regclass('public.inventory_movements') is null then return; end if;

  execute $fn$
    create or replace function public.inv_move_stamp_cost()
    returns trigger as $body$
    declare
      cur_avg  numeric;
      fallback numeric;
    begin
      select avg_cost into cur_avg
        from public.inventory_levels
       where restaurant_id = new.restaurant_id
         and food_cost_item_id = new.food_cost_item_id;
      cur_avg := coalesce(cur_avg, 0);

      if public.inv_is_receipt(new.movement_type) then
        -- Costed receipt: the caller supplies the incoming cost. If it is
        -- missing, fall back to the catalogue cost_per_unit.
        if new.unit_cost is null or new.unit_cost = 0 then
          select cost_per_unit into fallback
            from public.food_cost_items where id = new.food_cost_item_id;
          new.unit_cost := coalesce(fallback, 0);
        end if;
      else
        -- Issue or quantity fix: value at the current average.
        if cur_avg = 0 then
          select cost_per_unit into fallback
            from public.food_cost_items where id = new.food_cost_item_id;
          new.unit_cost := coalesce(fallback, 0);
        else
          new.unit_cost := cur_avg;
        end if;
      end if;

      new.value_delta := round(new.qty_delta * new.unit_cost, 4);
      return new;
    end;
    $body$ language plpgsql security definer;
  $fn$;

  execute $fn$
    create or replace function public.inv_move_apply_level()
    returns trigger as $body$
    declare
      cur_qty numeric; cur_avg numeric;
      new_qty numeric; new_avg numeric;
    begin
      select qty_on_hand, avg_cost into cur_qty, cur_avg
        from public.inventory_levels
       where restaurant_id = new.restaurant_id
         and food_cost_item_id = new.food_cost_item_id
       for update;
      if not found then cur_qty := 0; cur_avg := 0; end if;

      new_qty := cur_qty + new.qty_delta;

      if public.inv_is_receipt(new.movement_type) then
        if new_qty <> 0 then
          new_avg := (cur_qty * cur_avg + new.qty_delta * new.unit_cost) / new_qty;
        else
          new_avg := new.unit_cost;
        end if;
      else
        new_avg := cur_avg;
      end if;

      insert into public.inventory_levels
        (restaurant_id, food_cost_item_id, qty_on_hand, avg_cost, total_value, updated_at)
      values
        (new.restaurant_id, new.food_cost_item_id, new_qty, new_avg,
         round(new_qty * new_avg, 4), now())
      on conflict (restaurant_id, food_cost_item_id) do update
        set qty_on_hand = excluded.qty_on_hand,
            avg_cost    = excluded.avg_cost,
            total_value = excluded.total_value,
            updated_at  = now();

      return null;
    end;
    $body$ language plpgsql security definer;
  $fn$;
end $$;


-- ── 3. Production runs ───────────────────────────────────────────────────────
create table if not exists public.production_runs (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  recipe_id     uuid not null references public.recipes     on delete restrict,

  batches       numeric not null check (batches > 0),
  expected_qty  numeric,                    -- batches × yield at the time it was made
  produced_qty  numeric,                    -- what actually came out
  produced_unit text,

  business_date date not null default (now() at time zone 'utc')::date,
  made_at       timestamptz not null default now(),
  made_by       uuid references public.profiles on delete set null,
  made_by_name  text,                       -- free text when logged from a tablet
  notes         text,

  -- Ledger outcome. false = deliberately not posted (a non-stocked recipe, or
  -- the inventory tables are not live) — never a silent failure.
  posted        boolean not null default false,
  batch_cost    numeric,                    -- rolled cost of the ingredients consumed
  use_by        timestamptz,                -- made_at + the recipe's shelf life

  voided_at     timestamptz,
  voided_by     uuid references public.profiles on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_production_runs_venue_date
  on public.production_runs(restaurant_id, business_date desc);
create index if not exists idx_production_runs_recipe
  on public.production_runs(recipe_id, made_at desc);

comment on table public.production_runs is
  'A logged prep batch. posted=true means it moved stock (only ever for is_stocked recipes); posted=false is a deliberate no-op, not a failure.';

alter table public.production_runs enable row level security;

do $$ begin
  -- Reads for anyone with venue access. Writes go through the RPCs below, which
  -- are the only path that keeps the ledger honest.
  if not exists (select 1 from pg_policies where tablename='production_runs' and policyname='production_runs_select') then
    create policy "production_runs_select" on public.production_runs
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;


-- ── 4. Prep checks ───────────────────────────────────────────────────────────
-- Par vs on-hand needs an on-hand. A stocked batch has one in inventory_levels.
-- Everything else needs someone to glance at the shelf — this is that glance,
-- kept deliberately light: one number, once a day, per recipe.
create table if not exists public.prep_checks (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  recipe_id     uuid not null references public.recipes     on delete cascade,
  business_date date not null default (now() at time zone 'utc')::date,
  on_hand_qty   numeric not null check (on_hand_qty >= 0),
  unit          text,
  checked_by    uuid references public.profiles on delete set null,
  checked_at    timestamptz not null default now(),
  unique (restaurant_id, recipe_id, business_date)
);

create index if not exists idx_prep_checks_venue_date
  on public.prep_checks(restaurant_id, business_date desc);

alter table public.prep_checks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='prep_checks' and policyname='prep_checks_select') then
    create policy "prep_checks_select" on public.prep_checks
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='prep_checks' and policyname='prep_checks_insert') then
    create policy "prep_checks_insert" on public.prep_checks
      for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='prep_checks' and policyname='prep_checks_update') then
    create policy "prep_checks_update" on public.prep_checks
      for update using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;


-- ── 5. Log a batch ───────────────────────────────────────────────────────────
-- Callable by anyone with access to the venue — the people who do the prep are
-- the people who log it. Returns the run id; never returns a cost.
-- The engine. No access check of its own — every caller must do that first,
-- because the tablet authenticates by device token rather than by auth.uid().
-- Revoked from public below; only the two wrappers reach it.
create or replace function public.production_run_post_internal(
  p_restaurant_id uuid,
  p_recipe_id     uuid,
  p_batches       numeric,
  p_produced_qty  numeric default null,
  p_notes         text    default null,
  p_made_by_name  text    default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  r          record;
  v_run      uuid;
  v_expected numeric;
  v_produced numeric;
  v_cost     numeric := 0;
  v_date     date;
  v_row      record;
begin
  if coalesce(p_batches, 0) <= 0 then
    raise exception 'post_production_run: batches must be greater than zero';
  end if;

  select * into r from public.recipes where id = p_recipe_id and active;
  if r.id is null then
    raise exception 'post_production_run: recipe not found or inactive';
  end if;
  if r.type <> 'prep' then
    raise exception 'post_production_run: only prep recipes are made in batches';
  end if;
  if r.is_stocked and r.output_food_cost_item_id is null then
    raise exception
      'post_production_run: % is stocked but has no output item, so the batch has nowhere to go', r.name;
  end if;

  v_date     := (now() at time zone 'utc')::date;
  v_expected := p_batches * r.yield_qty;
  v_produced := coalesce(p_produced_qty, v_expected);

  insert into public.production_runs
    (restaurant_id, recipe_id, batches, expected_qty, produced_qty, produced_unit,
     business_date, made_by, made_by_name, notes, use_by)
  values
    (p_restaurant_id, p_recipe_id, p_batches, v_expected, v_produced, r.yield_unit,
     v_date, auth.uid(), p_made_by_name, p_notes,
     case when r.shelf_life_hours is not null
          then now() + make_interval(hours => r.shelf_life_hours::int) end)
  returning id into v_run;

  -- Only a stocked batch moves stock. A non-stocked recipe is depleted through
  -- its parent at sale time; posting here as well would consume it twice.
  if r.is_stocked and to_regclass('public.inventory_movements') is not null then
    for v_row in select * from public.recipe_explode(p_recipe_id, p_batches) loop
      if v_row.qty is null or v_row.qty <= 0 then continue; end if;
      insert into public.inventory_movements
        (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
         movement_date, source_type, source_id, notes, created_by)
      values
        (p_restaurant_id, v_row.food_cost_item_id, 'production_out', -v_row.qty, 0,
         v_date, 'production_run', v_run, format('made %s', r.name), auth.uid());
    end loop;

    -- The output carries the cost of what actually went in, the same way a
    -- transfer carries cost to the receiving venue.
    select coalesce(-sum(value_delta), 0) into v_cost
      from public.inventory_movements
     where source_type = 'production_run'
       and source_id   = v_run
       and movement_type = 'production_out';

    if v_produced > 0 then
      insert into public.inventory_movements
        (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
         movement_date, source_type, source_id, notes, created_by)
      values
        (p_restaurant_id, r.output_food_cost_item_id, 'production_in', v_produced,
         v_cost / v_produced, v_date, 'production_run', v_run,
         format('%s × %s batch', p_batches, r.name), auth.uid());
    end if;

    update public.production_runs
       set posted = true, batch_cost = v_cost
     where id = v_run;
  end if;

  return v_run;
end $$;

revoke all on function public.production_run_post_internal(uuid, uuid, numeric, numeric, text, text) from public;

-- Signed-in callers: anyone with access to the venue. The people who do the
-- prep are the people who log it. Returns the run id; never returns a cost.
create or replace function public.post_production_run(
  p_restaurant_id uuid,
  p_recipe_id     uuid,
  p_batches       numeric,
  p_produced_qty  numeric default null,
  p_notes         text    default null,
  p_made_by_name  text    default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_restaurant_access(p_restaurant_id) then
    raise exception 'post_production_run: no access to that venue' using errcode = '42501';
  end if;
  return public.production_run_post_internal(
    p_restaurant_id, p_recipe_id, p_batches, p_produced_qty, p_notes, p_made_by_name);
end $$;

comment on function public.post_production_run(uuid, uuid, numeric, numeric, text, text) is
  'Log a prep batch. Moves stock only for is_stocked recipes — posted=false on the run means deliberately not posted, never a failure.';


-- ── 6. Void a run ────────────────────────────────────────────────────────────
-- The ledger is append-only, so a void posts compensating movements rather than
-- deleting anything. Unlike the waste reversal in 032 — which returns stock at
-- TODAY'S average and so leaves the moving average permanently a little off —
-- this reverses each leg at the cost it was originally posted at, as a receipt.
-- That restores both the quantity and the moving average exactly:
--   output   +q @ c   →  reversed by  -q @ c
--   ingredient -q @ a →  reversed by  +q @ a
-- Both are receipts, so the average recomputes back to precisely where it was.
create or replace function public.void_production_run(
  p_run_id uuid,
  p_reason text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  run record;
  mv  record;
begin
  select * into run from public.production_runs where id = p_run_id;
  if run.id is null then
    raise exception 'void_production_run: run not found';
  end if;
  if run.voided_at is not null then
    raise exception 'void_production_run: that run is already voided';
  end if;
  -- coalesce is load-bearing: a run logged on the tablet has made_by NULL, so
  -- `made_by = auth.uid()` is NULL, and `not (false or NULL)` is NULL — which
  -- plpgsql treats as false and skips the raise. That let staff void anything.
  if not (coalesce(public.has_non_staff_access(run.restaurant_id), false)
          or coalesce(run.made_by = auth.uid(), false)) then
    raise exception 'void_production_run: insufficient privilege' using errcode = '42501';
  end if;

  if run.posted and to_regclass('public.inventory_movements') is not null then
    for mv in
      select * from public.inventory_movements
       where source_type = 'production_run' and source_id = p_run_id
       order by created_at
    loop
      insert into public.inventory_movements
        (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
         movement_date, source_type, source_id, notes, created_by)
      values
        (mv.restaurant_id, mv.food_cost_item_id, 'production_in',
         -mv.qty_delta, mv.unit_cost,
         (now() at time zone 'utc')::date, 'production_run_void', p_run_id,
         coalesce(p_reason, 'production run voided'), auth.uid());
    end loop;
  end if;

  update public.production_runs
     set voided_at = now(),
         voided_by = auth.uid(),
         notes = trim(both ' ' from coalesce(notes, '')
                                 || ' · voided: ' || coalesce(p_reason, 'no reason given'))
   where id = p_run_id;
end $$;


-- ── 7. The prep list ─────────────────────────────────────────────────────────
-- What this venue should make today. Par comes from recipe_venue_settings;
-- on-hand comes from the ledger for a stocked batch, or from today's prep_check
-- for everything else, or is simply unknown and says so. No cost in the answer,
-- so this is safe for staff and for the tablet.
-- A named row type, so the engine and its checked wrapper share one shape
-- instead of two copies of the column list drifting apart.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'prep_list_row'
                   and typnamespace = 'public'::regnamespace) then
    create type public.prep_list_row as (
      recipe_id        uuid,
      name             text,
      category         text,
      yield_qty        numeric,
      yield_unit       text,
      is_stocked       boolean,
      par_qty          numeric,
      on_hand          numeric,
      on_hand_source   text,      -- 'stock' | 'checked' | 'unknown'
      to_make          numeric,
      batches_to_make  numeric,
      prep_time_mins   integer,
      shelf_life_hours numeric,
      hero_image_path  text,
      made_today       numeric,
      last_made_at     timestamptz
    );
  end if;
end $$;

-- The engine, again without an access check — see production_run_post_internal.
create or replace function public.prep_list_rows(p_restaurant_id uuid)
returns setof public.prep_list_row
language plpgsql security definer
set search_path = public
as $$
declare
  v_levels text;
begin
  -- The ledger may not be live yet; fall back to prep checks alone.
  v_levels := case
    when to_regclass('public.inventory_levels') is not null
    then 'left join public.inventory_levels il
            on il.restaurant_id = $1 and il.food_cost_item_id = r.output_food_cost_item_id'
    else 'left join (select null::uuid as food_cost_item_id, null::numeric as qty_on_hand) il on false'
  end;

  return query execute format($q$
    with today as (
      select (now() at time zone 'utc')::date as d
    ),
    runs as (
      select pr.recipe_id,
             sum(pr.produced_qty) filter (where pr.business_date = (select d from today)) as made_today,
             max(pr.made_at) as last_made_at
        from public.production_runs pr
       where pr.restaurant_id = $1 and pr.voided_at is null
       group by pr.recipe_id
    )
    select r.id, r.name, r.category, r.yield_qty, r.yield_unit, r.is_stocked,
           v.par_qty,
           oh.qty, oh.src,
           case when oh.qty is null then null
                else greatest(0, v.par_qty - oh.qty) end,
           case when oh.qty is null or r.yield_qty <= 0 then null
                else round(greatest(0, v.par_qty - oh.qty) / r.yield_qty, 2) end,
           r.prep_time_mins, r.shelf_life_hours, r.hero_image_path,
           coalesce(runs.made_today, 0), runs.last_made_at
      from public.recipes r
      join public.recipe_venue_settings v
        on v.recipe_id = r.id and v.restaurant_id = $1
       and v.available and coalesce(v.par_qty, 0) > 0
      %s
      left join public.prep_checks pc
        on pc.restaurant_id = $1 and pc.recipe_id = r.id
       and pc.business_date = (select d from today)
      left join runs on runs.recipe_id = r.id
      cross join lateral (
        select case when r.is_stocked and il.qty_on_hand is not null then il.qty_on_hand
                    when pc.on_hand_qty is not null then pc.on_hand_qty end as qty,
               case when r.is_stocked and il.qty_on_hand is not null then 'stock'
                    when pc.on_hand_qty is not null then 'checked'
                    else 'unknown' end as src
      ) oh
     where r.active and r.type = 'prep'
     order by (oh.qty is null), (case when oh.qty is null then 0
                                      else greatest(0, v.par_qty - oh.qty) end) desc, r.name
  $q$, v_levels)
  using p_restaurant_id;
end $$;

revoke all on function public.prep_list_rows(uuid) from public;

create or replace function public.prep_list(p_restaurant_id uuid)
returns setof public.prep_list_row
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_restaurant_access(p_restaurant_id) then
    raise exception 'prep_list: no access to that venue' using errcode = '42501';
  end if;
  return query select * from public.prep_list_rows(p_restaurant_id);
end $$;

comment on function public.prep_list(uuid) is
  'What this venue should make today: par vs on-hand, biggest gap first. Carries no cost — safe for staff and for the tablet.';


-- ============================================================================
-- 8. The tablet — cost-free anon surface (follows the 071 device-token pattern)
-- ----------------------------------------------------------------------------
-- coop-clock has no login: the device token identifies the venue. These four
-- functions are the ONLY recipe surface the anon role can reach, and none of
-- them returns a cost, an average, a supplier or a price. That is by
-- construction, not by the UI choosing not to render it.
--
-- Wrapped in a guard because plpgsql resolves `declare d public.kiosk_devices`
-- at CREATE time, not first call — without 071 live, plain CREATEs here abort
-- the whole migration.
-- ============================================================================
do $outer$
begin
  if to_regclass('public.kiosk_devices') is null then
    raise notice 'recipe_production: kiosk_devices not present (migration 071) — skipping the tablet RPCs.';
    return;
  end if;

  -- Every recipe, as a card index. No cost.
  execute $fn$
    create or replace function public.kiosk_recipes(p_token text)
    returns jsonb language plpgsql security definer set search_path = public as $body$
    declare d public.kiosk_devices;
    begin
      d := public.kiosk_resolve(p_token);
      return coalesce((
        select jsonb_agg(x order by x->>'name')
          from (
            select jsonb_build_object(
                     'id',              r.id,
                     'name',            r.name,
                     'type',            r.type,
                     'category',        r.category,
                     'yield_qty',       r.yield_qty,
                     'yield_unit',      r.yield_unit,
                     'portions',        r.portions,
                     'prep_time_mins',  r.prep_time_mins,
                     'hero_image_path', r.hero_image_path
                   ) as x
              from public.recipes r
              left join public.recipe_venue_settings v
                on v.recipe_id = r.id and v.restaurant_id = d.restaurant_id
             where r.active and coalesce(v.available, true)
          ) s
      ), '[]'::jsonb);
    end $body$;
  $fn$;

  -- One card: ingredients as written, method, allergens. No cost.
  execute $fn$
    create or replace function public.kiosk_recipe(p_token text, p_recipe_id uuid)
    returns jsonb language plpgsql security definer set search_path = public as $body$
    declare
      d public.kiosk_devices;
      r public.recipes;
    begin
      d := public.kiosk_resolve(p_token);
      select * into r from public.recipes where id = p_recipe_id and active;
      if r.id is null then
        raise exception 'That recipe is not available' using errcode = 'P0002';
      end if;

      return jsonb_build_object(
        'id',               r.id,
        'name',             r.name,
        'type',             r.type,
        'category',         r.category,
        'description',      r.description,
        'method_intro',     r.method_intro,
        'yield_qty',        r.yield_qty,
        'yield_unit',       r.yield_unit,
        'portions',         r.portions,
        'prep_time_mins',   r.prep_time_mins,
        'shelf_life_hours', r.shelf_life_hours,
        'equipment',        r.equipment,
        'hero_image_path',  r.hero_image_path,
        'is_stocked',       r.is_stocked,
        'allergens',        to_jsonb(public.recipe_allergens(r.id)),
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'name',          coalesce(fci.name, sr.name),
                   'qty',           l.qty_entered,
                   'unit',          coalesce(l.unit_entered, fci.unit, sr.yield_unit),
                   'note',          l.note,
                   'optional',      l.optional,
                   'sub_recipe_id', l.sub_recipe_id
                 ) order by l.sort_order)
            from public.recipe_lines l
            left join public.food_cost_items fci on fci.id = l.food_cost_item_id
            left join public.recipes sr          on sr.id  = l.sub_recipe_id
           where l.recipe_id = r.id
        ), '[]'::jsonb),
        'steps', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'step_no', st.step_no, 'body', st.body, 'image_path', st.image_path
                 ) order by st.step_no)
            from public.recipe_steps st where st.recipe_id = r.id
        ), '[]'::jsonb)
      );
    end $body$;
  $fn$;

  -- What to make here today.
  execute $fn$
    create or replace function public.kiosk_prep_list(p_token text)
    returns jsonb language plpgsql security definer set search_path = public as $body$
    declare d public.kiosk_devices;
    begin
      d := public.kiosk_resolve(p_token);
      return coalesce((
        select jsonb_agg(to_jsonb(p)) from public.prep_list_rows(d.restaurant_id) p
      ), '[]'::jsonb);
    end $body$;
  $fn$;

  -- Tick a batch done. No PIN: logging prep is not pay-affecting, and friction
  -- here just means it doesn't get logged. Who made it is free text.
  execute $fn$
    create or replace function public.kiosk_prep_done(
      p_token        text,
      p_recipe_id    uuid,
      p_batches      numeric,
      p_produced_qty numeric default null,
      p_made_by_name text    default null,
      p_notes        text    default null
    ) returns jsonb language plpgsql security definer set search_path = public as $body$
    declare
      d     public.kiosk_devices;
      v_run uuid;
      run   public.production_runs;
    begin
      d := public.kiosk_resolve(p_token);
      v_run := public.production_run_post_internal(
        d.restaurant_id, p_recipe_id, p_batches, p_produced_qty,
        coalesce(p_notes, format('logged on %s', d.name)), p_made_by_name);

      select * into run from public.production_runs where id = v_run;
      return jsonb_build_object(
        'run_id',       run.id,
        'recipe_id',    run.recipe_id,
        'batches',      run.batches,
        'produced_qty', run.produced_qty,
        'unit',         run.produced_unit,
        'made_at',      run.made_at,
        'use_by',       run.use_by,
        'made_by_name', run.made_by_name,
        'posted',       run.posted
      );
    end $body$;
  $fn$;

  -- Grants — anon may call these four and nothing else in this migration.
  execute 'revoke all on function public.kiosk_recipes(text) from public';
  execute 'revoke all on function public.kiosk_recipe(text, uuid) from public';
  execute 'revoke all on function public.kiosk_prep_list(text) from public';
  execute 'revoke all on function public.kiosk_prep_done(text, uuid, numeric, numeric, text, text) from public';

  execute 'grant execute on function public.kiosk_recipes(text) to anon, authenticated';
  execute 'grant execute on function public.kiosk_recipe(text, uuid) to anon, authenticated';
  execute 'grant execute on function public.kiosk_prep_list(text) to anon, authenticated';
  execute 'grant execute on function public.kiosk_prep_done(text, uuid, numeric, numeric, text, text) to anon, authenticated';
end $outer$;


-- ── 9. Grants for the signed-in surface ──────────────────────────────────────
grant execute on function public.post_production_run(uuid, uuid, numeric, numeric, text, text)
  to authenticated;
grant execute on function public.void_production_run(uuid, text) to authenticated;
grant execute on function public.prep_list(uuid)                 to authenticated;
