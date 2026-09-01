-- ============================================================================
-- 075. RECIPE BOOK — the daily prep plan
--   Supersedes the par-driven prep list from 074.
--
--   074 showed only recipes with a par level and worked out the quantity for
--   you. In practice the opener decides what today needs — par is a useful
--   starting number, not the decision. So:
--
--     * EVERY prep recipe available at the venue appears on the board
--     * a manager sets a target quantity per recipe for the day
--     * the team sees only what was set, and works through it
--     * progress comes from the batches they log, so ticking off is automatic
--
--   prep_list() from 074 is left in place but is no longer used by the app.
--   Everything now reads prep_board().
--
--   Depends on 073 + 074. Guarded on to_regclass throughout. Safe to re-run.
-- ============================================================================


-- ── 1. The plan ──────────────────────────────────────────────────────────────
create table if not exists public.prep_plan_items (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  recipe_id     uuid not null references public.recipes     on delete cascade,
  business_date date not null default (now() at time zone 'utc')::date,

  target_qty    numeric not null check (target_qty >= 0),
  unit          text,
  note          text,                    -- "for the function at 6"
  sort_order    integer not null default 0,

  -- Set when someone calls it done, whether or not the batches add up — a
  -- half batch can still be enough, and the team shouldn't have to lie to the
  -- log to clear the line.
  completed_at  timestamptz,
  completed_by  uuid references public.profiles on delete set null,

  created_by    uuid references public.profiles on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (restaurant_id, recipe_id, business_date)
);

create index if not exists idx_prep_plan_venue_date
  on public.prep_plan_items(restaurant_id, business_date desc);

comment on table public.prep_plan_items is
  'What this venue decided to prep today. One row per venue/recipe/day; absent = not on today''s list.';

alter table public.prep_plan_items enable row level security;

do $$ begin
  -- Everyone at the venue reads the plan — that is the whole point of it.
  if not exists (select 1 from pg_policies where tablename='prep_plan_items' and policyname='prep_plan_select') then
    create policy "prep_plan_select" on public.prep_plan_items
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
  -- Writes go through the RPCs below so the rules stay in one place.
end $$;


-- ── 2. The board ─────────────────────────────────────────────────────────────
-- One row per prep recipe available at the venue, whether or not it is on
-- today's list. Carries no cost, so it is safe for staff and for the tablet.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'prep_board_row'
                   and typnamespace = 'public'::regnamespace) then
    create type public.prep_board_row as (
      recipe_id        uuid,
      name             text,
      category         text,
      yield_qty        numeric,
      yield_unit       text,
      is_stocked       boolean,
      hero_image_path  text,
      prep_time_mins   integer,
      shelf_life_hours numeric,

      planned          boolean,      -- on today's list?
      target_qty       numeric,
      plan_note        text,
      plan_item_id     uuid,
      completed_at     timestamptz,

      par_qty          numeric,      -- a starting number, not the decision
      on_hand          numeric,
      on_hand_source   text,         -- 'stock' | 'checked' | 'unknown'
      suggested_qty    numeric,      -- par − on hand, when both are known
      made_today       numeric,
      remaining        numeric,      -- target − made today, floored at zero
      last_made_at     timestamptz
    );
  end if;
end $$;

-- No access check of its own — every caller checks first, because the tablet
-- authenticates by device token rather than by auth.uid(). Revoked below.
create or replace function public.prep_board_rows(
  p_restaurant_id uuid,
  p_date          date default null
) returns setof public.prep_board_row
language plpgsql security definer
set search_path = public
as $$
declare
  v_levels text;
  v_day    date := coalesce(p_date, (now() at time zone 'utc')::date);
begin
  -- The ledger may not be live yet; fall back to prep checks alone.
  v_levels := case
    when to_regclass('public.inventory_levels') is not null
    then 'left join public.inventory_levels il
            on il.restaurant_id = $1 and il.food_cost_item_id = r.output_food_cost_item_id'
    else 'left join (select null::uuid as food_cost_item_id, null::numeric as qty_on_hand) il on false'
  end;

  return query execute format($q$
    with runs as (
      select pr.recipe_id,
             sum(pr.produced_qty) filter (where pr.business_date = $2) as made_today,
             max(pr.made_at) as last_made_at
        from public.production_runs pr
       where pr.restaurant_id = $1 and pr.voided_at is null
       group by pr.recipe_id
    )
    select r.id, r.name, r.category, r.yield_qty, r.yield_unit, r.is_stocked,
           r.hero_image_path, r.prep_time_mins, r.shelf_life_hours,

           (pp.id is not null),
           pp.target_qty,
           pp.note,
           pp.id,
           pp.completed_at,

           v.par_qty,
           oh.qty,
           oh.src,
           case when v.par_qty is null or oh.qty is null then null
                else greatest(0, v.par_qty - oh.qty) end,
           coalesce(runs.made_today, 0),
           case when pp.id is null then null
                else greatest(0, pp.target_qty - coalesce(runs.made_today, 0)) end,
           runs.last_made_at
      from public.recipes r
      left join public.recipe_venue_settings v
        on v.recipe_id = r.id and v.restaurant_id = $1
      left join public.prep_plan_items pp
        on pp.recipe_id = r.id and pp.restaurant_id = $1 and pp.business_date = $2
      %s
      left join public.prep_checks pc
        on pc.restaurant_id = $1 and pc.recipe_id = r.id and pc.business_date = $2
      left join runs on runs.recipe_id = r.id
      cross join lateral (
        select case when r.is_stocked and il.qty_on_hand is not null then il.qty_on_hand
                    when pc.on_hand_qty is not null then pc.on_hand_qty end as qty,
               case when r.is_stocked and il.qty_on_hand is not null then 'stock'
                    when pc.on_hand_qty is not null then 'checked'
                    else 'unknown' end as src
      ) oh
     where r.active
       and r.type = 'prep'
       and coalesce(v.available, true)
     order by (pp.id is null),                       -- planned first
              coalesce(pp.sort_order, 0),
              r.name
  $q$, v_levels)
  using p_restaurant_id, v_day;
end $$;

revoke all on function public.prep_board_rows(uuid, date) from public;

create or replace function public.prep_board(
  p_restaurant_id uuid,
  p_date          date default null
) returns setof public.prep_board_row
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_restaurant_access(p_restaurant_id) then
    raise exception 'prep_board: no access to that venue' using errcode = '42501';
  end if;
  return query select * from public.prep_board_rows(p_restaurant_id, p_date);
end $$;

comment on function public.prep_board(uuid, date) is
  'Every prep recipe at the venue, with today''s planned target, par suggestion, on-hand and progress. No cost — safe for staff and for the tablet.';


-- ── 3. Setting the plan ──────────────────────────────────────────────────────
-- Manager tier sets what today needs. A target of zero (or null) takes the
-- recipe off the list rather than leaving a line nobody will action.
create or replace function public.set_prep_plan_item(
  p_restaurant_id uuid,
  p_recipe_id     uuid,
  p_target_qty    numeric,
  p_note          text default null,
  p_date          date default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_day  date := coalesce(p_date, (now() at time zone 'utc')::date);
  v_unit text;
  v_id   uuid;
begin
  if not public.has_non_staff_access(p_restaurant_id) then
    raise exception 'set_prep_plan_item: only a manager sets the prep plan'
      using errcode = '42501';
  end if;

  if p_target_qty is null or p_target_qty <= 0 then
    delete from public.prep_plan_items
     where restaurant_id = p_restaurant_id
       and recipe_id     = p_recipe_id
       and business_date = v_day;
    return null;
  end if;

  select yield_unit into v_unit from public.recipes where id = p_recipe_id;

  insert into public.prep_plan_items
    (restaurant_id, recipe_id, business_date, target_qty, unit, note, created_by)
  values
    (p_restaurant_id, p_recipe_id, v_day, p_target_qty, v_unit, p_note, auth.uid())
  on conflict (restaurant_id, recipe_id, business_date) do update
    set target_qty = excluded.target_qty,
        note       = excluded.note,
        unit       = excluded.unit,
        updated_at = now()
  returning id into v_id;

  return v_id;
end $$;

-- Ticking a line off is the team's job, so this one only needs venue access.
create or replace function public.complete_prep_plan_item(
  p_restaurant_id uuid,
  p_recipe_id     uuid,
  p_done          boolean default true,
  p_date          date default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_date, (now() at time zone 'utc')::date);
begin
  if not public.has_restaurant_access(p_restaurant_id) then
    raise exception 'complete_prep_plan_item: no access to that venue' using errcode = '42501';
  end if;

  update public.prep_plan_items
     set completed_at = case when p_done then now() end,
         completed_by = case when p_done then auth.uid() end,
         updated_at   = now()
   where restaurant_id = p_restaurant_id
     and recipe_id     = p_recipe_id
     and business_date = v_day;
end $$;

-- Most days look like yesterday. Copying beats retyping the same eight lines.
create or replace function public.copy_prep_plan(
  p_restaurant_id uuid,
  p_from          date default null,
  p_to            date default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_to   date := coalesce(p_to, (now() at time zone 'utc')::date);
  v_from date := coalesce(p_from, v_to - 1);
  v_n    integer;
begin
  if not public.has_non_staff_access(p_restaurant_id) then
    raise exception 'copy_prep_plan: only a manager sets the prep plan' using errcode = '42501';
  end if;

  insert into public.prep_plan_items
    (restaurant_id, recipe_id, business_date, target_qty, unit, note, sort_order, created_by)
  select p_restaurant_id, src.recipe_id, v_to, src.target_qty, src.unit, src.note,
         src.sort_order, auth.uid()
    from public.prep_plan_items src
   where src.restaurant_id = p_restaurant_id
     and src.business_date = v_from
  on conflict (restaurant_id, recipe_id, business_date) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Clear the whole day, for when the plan was set against the wrong date.
create or replace function public.clear_prep_plan(
  p_restaurant_id uuid,
  p_date          date default null
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_date, (now() at time zone 'utc')::date);
  v_n   integer;
begin
  if not public.has_non_staff_access(p_restaurant_id) then
    raise exception 'clear_prep_plan: only a manager sets the prep plan' using errcode = '42501';
  end if;
  delete from public.prep_plan_items
   where restaurant_id = p_restaurant_id and business_date = v_day;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function public.prep_board(uuid, date)                                to authenticated;
grant execute on function public.set_prep_plan_item(uuid, uuid, numeric, text, date)   to authenticated;
grant execute on function public.complete_prep_plan_item(uuid, uuid, boolean, date)    to authenticated;
grant execute on function public.copy_prep_plan(uuid, date, date)                      to authenticated;
grant execute on function public.clear_prep_plan(uuid, date)                           to authenticated;


-- ── 4. The tablet reads the plan ─────────────────────────────────────────────
do $outer$
begin
  if to_regclass('public.kiosk_devices') is null then
    raise notice 'prep_plan: kiosk_devices not present (migration 071) — skipping the tablet RPCs.';
    return;
  end if;

  -- Replaces 074's kiosk_prep_list: same name, now the board.
  execute $fn$
    create or replace function public.kiosk_prep_list(p_token text)
    returns jsonb language plpgsql security definer set search_path = public as $body$
    declare d public.kiosk_devices;
    begin
      d := public.kiosk_resolve(p_token);
      return coalesce((
        select jsonb_agg(to_jsonb(p)) from public.prep_board_rows(d.restaurant_id) p
      ), '[]'::jsonb);
    end $body$;
  $fn$;

  -- The team ticks a line off from the tablet.
  execute $fn$
    create or replace function public.kiosk_prep_complete(
      p_token     text,
      p_recipe_id uuid,
      p_done      boolean default true
    ) returns jsonb language plpgsql security definer set search_path = public as $body$
    declare
      d     public.kiosk_devices;
      v_day date;
    begin
      d := public.kiosk_resolve(p_token);
      v_day := (now() at time zone 'utc')::date;
      update public.prep_plan_items
         set completed_at = case when p_done then now() end,
             completed_by = null,
             updated_at   = now()
       where restaurant_id = d.restaurant_id
         and recipe_id     = p_recipe_id
         and business_date = v_day;
      return jsonb_build_object('recipe_id', p_recipe_id, 'done', p_done);
    end $body$;
  $fn$;

  execute 'revoke all on function public.kiosk_prep_complete(text, uuid, boolean) from public';
  execute 'grant execute on function public.kiosk_prep_complete(text, uuid, boolean) to anon, authenticated';
end $outer$;
