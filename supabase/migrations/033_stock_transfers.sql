-- ============================================================================
-- 033 — Stock transfers between venues (Phase B)
--   Flow: SEND → in_transit → CONFIRM (receiving venue).
--     * On send:    source posts a `transfer_out` at the source's current avg
--                   cost; that cost is captured on the line ("carried cost").
--     * On confirm: destination posts a `transfer_in` of the full sent qty at
--                   the carried cost (so the receiver's avg cost + COGS absorb
--                   it), then writes off any shortfall (sent − received) as an
--                   `in_transit_loss`. Net destination change = qty received.
--     * On cancel (before receipt): the source transfer_out is reversed.
--   Permissions: sender needs access to the FROM venue; receiver/cancel to the
--   relevant venue. Over-send is blocked (can't send more than on hand).
--   Depends on 030. Safe to re-run.
-- ============================================================================

create table if not exists public.stock_transfers (
  id                 uuid primary key default uuid_generate_v4(),
  from_restaurant_id uuid not null references public.restaurants on delete cascade,
  to_restaurant_id   uuid not null references public.restaurants on delete cascade,
  status             text not null default 'in_transit'
                       check (status in ('in_transit','received','cancelled')),
  notes              text,
  sent_by            uuid references public.profiles on delete set null,
  sent_at            timestamptz not null default now(),
  received_by        uuid references public.profiles on delete set null,
  received_at        timestamptz,
  created_at         timestamptz not null default now(),
  check (from_restaurant_id <> to_restaurant_id)
);

create index if not exists idx_transfers_from on public.stock_transfers(from_restaurant_id);
create index if not exists idx_transfers_to   on public.stock_transfers(to_restaurant_id);
create index if not exists idx_transfers_status on public.stock_transfers(status);

create table if not exists public.stock_transfer_lines (
  id                uuid primary key default uuid_generate_v4(),
  transfer_id       uuid not null references public.stock_transfers on delete cascade,
  food_cost_item_id uuid not null references public.food_cost_items on delete restrict,
  qty_sent          numeric not null check (qty_sent > 0),
  qty_received      numeric,                         -- null until confirmed
  unit_cost         numeric not null default 0,      -- carried cost (source avg at send)
  created_at        timestamptz not null default now()
);

create index if not exists idx_transfer_lines_transfer on public.stock_transfer_lines(transfer_id);

alter table public.stock_transfers      enable row level security;
alter table public.stock_transfer_lines enable row level security;

do $$ begin
  -- A user can see a transfer if they can access either end.
  if not exists (select 1 from pg_policies where tablename='stock_transfers' and policyname='transfers_select') then
    create policy "transfers_select" on public.stock_transfers for select using (
      public.has_restaurant_access(from_restaurant_id) or public.has_restaurant_access(to_restaurant_id));
  end if;
  -- Writes go through SECURITY DEFINER RPCs, but keep sane direct policies too.
  if not exists (select 1 from pg_policies where tablename='stock_transfers' and policyname='transfers_insert') then
    create policy "transfers_insert" on public.stock_transfers for insert with check (
      public.has_restaurant_access(from_restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='stock_transfers' and policyname='transfers_update') then
    create policy "transfers_update" on public.stock_transfers for update using (
      public.has_restaurant_access(from_restaurant_id) or public.has_restaurant_access(to_restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='stock_transfers' and policyname='transfers_delete') then
    create policy "transfers_delete" on public.stock_transfers for delete using (public.is_superadmin());
  end if;

  if not exists (select 1 from pg_policies where tablename='stock_transfer_lines' and policyname='transfer_lines_select') then
    create policy "transfer_lines_select" on public.stock_transfer_lines for select using (
      exists (select 1 from public.stock_transfers t where t.id = stock_transfer_lines.transfer_id
              and (public.has_restaurant_access(t.from_restaurant_id) or public.has_restaurant_access(t.to_restaurant_id))));
  end if;
  if not exists (select 1 from pg_policies where tablename='stock_transfer_lines' and policyname='transfer_lines_insert') then
    create policy "transfer_lines_insert" on public.stock_transfer_lines for insert with check (
      exists (select 1 from public.stock_transfers t where t.id = stock_transfer_lines.transfer_id
              and public.has_restaurant_access(t.from_restaurant_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename='stock_transfer_lines' and policyname='transfer_lines_update') then
    create policy "transfer_lines_update" on public.stock_transfer_lines for update using (
      exists (select 1 from public.stock_transfers t where t.id = stock_transfer_lines.transfer_id
              and (public.has_restaurant_access(t.from_restaurant_id) or public.has_restaurant_access(t.to_restaurant_id))));
  end if;
end $$;


-- ── SEND: create a transfer, remove stock from the source ────────────────────
-- p_lines: jsonb array of { "food_cost_item_id": uuid, "qty_sent": numeric }
create or replace function public.create_stock_transfer(
  p_from_restaurant_id uuid,
  p_to_restaurant_id   uuid,
  p_lines              jsonb,
  p_notes              text default null
) returns uuid as $$
declare
  v_transfer_id uuid;
  v_line        jsonb;
  v_item        uuid;
  v_qty         numeric;
  v_onhand      numeric;
  v_avg         numeric;
begin
  if not public.has_restaurant_access(p_from_restaurant_id) then
    raise exception 'no access to source restaurant %', p_from_restaurant_id;
  end if;
  if p_from_restaurant_id = p_to_restaurant_id then
    raise exception 'source and destination must differ';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'transfer must have at least one line';
  end if;

  insert into public.stock_transfers (from_restaurant_id, to_restaurant_id, status, notes, sent_by)
  values (p_from_restaurant_id, p_to_restaurant_id, 'in_transit', p_notes, auth.uid())
  returning id into v_transfer_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item := (v_line->>'food_cost_item_id')::uuid;
    v_qty  := (v_line->>'qty_sent')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'each line needs a positive qty_sent';
    end if;

    select coalesce(qty_on_hand,0), coalesce(avg_cost,0) into v_onhand, v_avg
      from public.inventory_levels
     where restaurant_id = p_from_restaurant_id and food_cost_item_id = v_item;
    v_onhand := coalesce(v_onhand,0);
    v_avg    := coalesce(v_avg,0);

    -- Block over-send: you cannot transfer more than is on hand at the source.
    if v_qty > v_onhand then
      raise exception 'cannot send % of item % — only % on hand at source',
        v_qty, v_item, v_onhand;
    end if;

    insert into public.stock_transfer_lines (transfer_id, food_cost_item_id, qty_sent, unit_cost)
    values (v_transfer_id, v_item, v_qty, v_avg);

    -- Stock leaves the source now (in-transit), valued at source avg.
    insert into public.inventory_movements
      (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
       source_type, source_id, notes, created_by)
    values
      (p_from_restaurant_id, v_item, 'transfer_out', -v_qty, v_avg,
       'stock_transfer', v_transfer_id, 'transfer out', auth.uid());
  end loop;

  return v_transfer_id;
end;
$$ language plpgsql security definer;


-- ── CONFIRM: receiving venue accepts (optionally adjusting qty) ──────────────
-- p_received: jsonb array of { "line_id": uuid, "qty_received": numeric }.
--   If null, every line is received in full.
create or replace function public.receive_stock_transfer(
  p_transfer_id uuid,
  p_received    jsonb default null
) returns void as $$
declare
  v_to      uuid;
  v_status  text;
  r         record;
  v_recv    numeric;
  v_short   numeric;
begin
  select to_restaurant_id, status into v_to, v_status
    from public.stock_transfers where id = p_transfer_id;
  if v_to is null then raise exception 'transfer % not found', p_transfer_id; end if;
  if not public.has_restaurant_access(v_to) then
    raise exception 'no access to destination restaurant %', v_to;
  end if;
  if v_status <> 'in_transit' then
    raise exception 'transfer % is % (only in_transit can be received)', p_transfer_id, v_status;
  end if;

  for r in
    select id, food_cost_item_id, qty_sent, unit_cost
      from public.stock_transfer_lines where transfer_id = p_transfer_id
  loop
    -- received qty for this line: from p_received, else full
    v_recv := null;
    if p_received is not null then
      select (elem->>'qty_received')::numeric into v_recv
        from jsonb_array_elements(p_received) elem
       where (elem->>'line_id')::uuid = r.id
       limit 1;
    end if;
    v_recv := coalesce(v_recv, r.qty_sent);
    if v_recv < 0 then v_recv := 0; end if;
    if v_recv > r.qty_sent then v_recv := r.qty_sent; end if;
    v_short := r.qty_sent - v_recv;

    update public.stock_transfer_lines set qty_received = v_recv where id = r.id;

    -- Full sent qty arrives into the destination at the carried cost …
    insert into public.inventory_movements
      (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
       source_type, source_id, notes, created_by)
    values
      (v_to, r.food_cost_item_id, 'transfer_in', r.qty_sent, r.unit_cost,
       'stock_transfer', p_transfer_id, 'transfer in', auth.uid());

    -- … then write off anything that didn't actually arrive as a loss.
    if v_short > 0 then
      insert into public.inventory_movements
        (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
         source_type, source_id, notes, created_by)
      values
        (v_to, r.food_cost_item_id, 'in_transit_loss', -v_short, r.unit_cost,
         'stock_transfer', p_transfer_id, 'in-transit loss', auth.uid());
    end if;
  end loop;

  update public.stock_transfers
     set status = 'received', received_by = auth.uid(), received_at = now()
   where id = p_transfer_id;
end;
$$ language plpgsql security definer;


-- ── CANCEL: sender aborts before receipt; stock returns to the source ────────
create or replace function public.cancel_stock_transfer(p_transfer_id uuid)
returns void as $$
declare
  v_from   uuid;
  v_status text;
  r        record;
begin
  select from_restaurant_id, status into v_from, v_status
    from public.stock_transfers where id = p_transfer_id;
  if v_from is null then raise exception 'transfer % not found', p_transfer_id; end if;
  if not public.has_restaurant_access(v_from) then
    raise exception 'no access to source restaurant %', v_from;
  end if;
  if v_status <> 'in_transit' then
    raise exception 'transfer % is % (only in_transit can be cancelled)', p_transfer_id, v_status;
  end if;

  -- Return each sent quantity to the source (quantity fix; avg unchanged).
  for r in
    select food_cost_item_id, qty_sent from public.stock_transfer_lines where transfer_id = p_transfer_id
  loop
    insert into public.inventory_movements
      (restaurant_id, food_cost_item_id, movement_type, qty_delta, unit_cost,
       source_type, source_id, notes, created_by)
    values
      (v_from, r.food_cost_item_id, 'count_adjustment', r.qty_sent, null,
       'stock_transfer_cancel', p_transfer_id, 'transfer cancelled — returned', auth.uid());
  end loop;

  update public.stock_transfers set status = 'cancelled' where id = p_transfer_id;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- END 033
-- ============================================================================
