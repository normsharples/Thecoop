-- 097_store_sheet_public_tokens.sql
-- Public share links for the Daily Store Sheet so shift supervisors can fill
-- out the form without an ORBIT account.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add submitted_by_name to daily_store_sheets ───────────────────────────
-- For public submissions where the person entering data has no auth user.

alter table public.daily_store_sheets
  add column if not exists submitted_by_name text;

comment on column public.daily_store_sheets.submitted_by_name is
  'Free-text name of the person who submitted via the public form (no auth user).';

-- ── 2. venue_public_tokens — one per venue, optional ─────────────────────────

create table if not exists public.venue_public_tokens (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token         uuid not null unique default gen_random_uuid(),
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint venue_public_tokens_restaurant_unique unique (restaurant_id)
);

comment on table public.venue_public_tokens is
  'Per-venue shareable token that lets unauthenticated users submit a Daily Store Sheet.';

-- ── 3. RLS on venue_public_tokens ────────────────────────────────────────────

alter table public.venue_public_tokens enable row level security;

-- Only superadmin / area_manager can read or manage tokens
create policy "venue_public_tokens_select"
  on public.venue_public_tokens for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'area_manager')
    )
  );

create policy "venue_public_tokens_insert"
  on public.venue_public_tokens for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'area_manager')
    )
  );

create policy "venue_public_tokens_update"
  on public.venue_public_tokens for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'area_manager')
    )
  );

create policy "venue_public_tokens_delete"
  on public.venue_public_tokens for delete
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('superadmin', 'area_manager')
    )
  );

-- ── 4. RPC: get_venue_by_token ───────────────────────────────────────────────
-- Called by the anon key to look up venue name + id from a public token.

create or replace function public.get_venue_by_token(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_restaurant_name text;
begin
  select vpt.restaurant_id, r.name
    into v_restaurant_id, v_restaurant_name
    from public.venue_public_tokens vpt
    join public.restaurants r on r.id = vpt.restaurant_id
   where vpt.token = p_token
     and vpt.enabled = true;

  if v_restaurant_id is null then
    return json_build_object('ok', false, 'error', 'Invalid or disabled link');
  end if;

  return json_build_object(
    'ok',   true,
    'venue_id',   v_restaurant_id,
    'venue_name', v_restaurant_name
  );
end;
$$;

-- Allow anon to call it
grant execute on function public.get_venue_by_token(uuid) to anon;

-- ── 5. RPC: submit_store_sheet ───────────────────────────────────────────────
-- Called by the anon key to insert a daily_store_sheets row via public form.
-- Also upserts a cash_ups row when denomination / deposit data is provided.

-- Drop the old 4-arg signature so we can replace it with the 8-arg version
drop function if exists public.submit_store_sheet(uuid, date, text, text);

create or replace function public.submit_store_sheet(
  p_token                uuid,
  p_date                 date,
  p_submitted_by         text,
  p_shift_notes          text,
  p_denomination_counts  jsonb    default '{}'::jsonb,
  p_pos_expected_deposit numeric  default 0,
  p_amount_deposited     numeric  default 0,
  p_cash_outs            jsonb    default '[]'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_till_count    numeric := 0;
  v_key           text;
  v_count         numeric;
begin
  -- Validate token
  select vpt.restaurant_id
    into v_restaurant_id
    from public.venue_public_tokens vpt
   where vpt.token = p_token
     and vpt.enabled = true;

  if v_restaurant_id is null then
    return json_build_object('ok', false, 'error', 'Invalid or disabled link');
  end if;

  -- Upsert the daily store sheet
  insert into public.daily_store_sheets (
    restaurant_id,
    sheet_date,
    shift_notes,
    submitted_by_name,
    recorded_by
  ) values (
    v_restaurant_id,
    p_date,
    nullif(trim(p_shift_notes), ''),
    nullif(trim(p_submitted_by), ''),
    null
  )
  on conflict (restaurant_id, sheet_date) do update set
    shift_notes       = excluded.shift_notes,
    submitted_by_name = excluded.submitted_by_name,
    updated_at        = now();

  -- Compute till_count from denomination_counts (keys are cents, values are qty)
  for v_key, v_count in select * from jsonb_each_text(p_denomination_counts) loop
    v_till_count := v_till_count + (v_key::numeric * v_count::numeric) / 100;
  end loop;

  -- Upsert cash_ups row
  insert into public.cash_ups (
    restaurant_id,
    cash_up_date,
    till_count,
    float_amount,
    denomination_counts,
    amount_deposited,
    pos_expected_deposit,
    cash_outs,
    recorded_by
  ) values (
    v_restaurant_id,
    p_date,
    v_till_count,
    200,
    p_denomination_counts,
    p_amount_deposited,
    p_pos_expected_deposit,
    p_cash_outs,
    null
  )
  on conflict (restaurant_id, cash_up_date) do update set
    till_count           = excluded.till_count,
    denomination_counts  = excluded.denomination_counts,
    amount_deposited     = excluded.amount_deposited,
    pos_expected_deposit = excluded.pos_expected_deposit,
    cash_outs            = excluded.cash_outs,
    updated_at           = now();

  return json_build_object('ok', true);
end;
$$;

-- Allow anon to call it
grant execute on function public.submit_store_sheet(uuid, date, text, text, jsonb, numeric, numeric, jsonb) to anon;
