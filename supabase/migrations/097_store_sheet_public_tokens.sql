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

create or replace function public.submit_store_sheet(
  p_token         uuid,
  p_date          date,
  p_submitted_by  text,
  p_shift_notes   text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
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

  -- Upsert the sheet (so re-submitting the same day updates rather than errors)
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

  return json_build_object('ok', true);
end;
$$;

-- Allow anon to call it
grant execute on function public.submit_store_sheet(uuid, date, text, text) to anon;
