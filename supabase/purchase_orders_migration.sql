-- ============================================================================
-- Purchase Orders + Supplier Items
-- Safe to re-run. Run this in your Supabase SQL editor.
-- ============================================================================

-- ── Suppliers ─────────────────────────────────────────────────────────────────

create table if not exists public.suppliers (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  category     text,
  contact_name text,
  phone        text,
  email        text,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.suppliers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'suppliers' and policyname = 'suppliers_select') then
    create policy "suppliers_select" on public.suppliers for select using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'suppliers' and policyname = 'suppliers_insert') then
    create policy "suppliers_insert" on public.suppliers for insert with check (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'suppliers' and policyname = 'suppliers_update') then
    create policy "suppliers_update" on public.suppliers for update using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'suppliers' and policyname = 'suppliers_delete') then
    create policy "suppliers_delete" on public.suppliers for delete using (auth.uid() is not null);
  end if;
end $$;

-- ── Purchase Orders ───────────────────────────────────────────────────────────

create table if not exists public.purchase_orders (
  id                uuid primary key default uuid_generate_v4(),
  restaurant_id     uuid not null references public.restaurants on delete cascade,
  po_number         text not null,
  supplier_name     text not null,
  supplier_email    text,
  order_date        date not null,
  expected_delivery date,
  status            text not null default 'draft'
                    check (status in ('draft','sent','received','invoiced','cancelled')),
  items             jsonb not null default '[]',
  total_amount      numeric(10,2) not null default 0,
  notes             text,
  invoice_id        uuid references public.invoices(id) on delete set null,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_purchase_orders_restaurant on public.purchase_orders(restaurant_id);
create index if not exists idx_purchase_orders_status     on public.purchase_orders(status);

alter table public.purchase_orders enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'purchase_orders' and policyname = 'purchase_orders_select') then
    create policy "purchase_orders_select" on public.purchase_orders
      for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'purchase_orders' and policyname = 'purchase_orders_insert') then
    create policy "purchase_orders_insert" on public.purchase_orders
      for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'purchase_orders' and policyname = 'purchase_orders_update') then
    create policy "purchase_orders_update" on public.purchase_orders
      for update using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'purchase_orders' and policyname = 'purchase_orders_delete') then
    create policy "purchase_orders_delete" on public.purchase_orders
      for delete using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;

-- ── invoices.po_id back-link ──────────────────────────────────────────────────

alter table public.invoices
  add column if not exists po_id uuid;

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'invoices_po_id_fkey'
  ) then
    alter table public.invoices
      add constraint invoices_po_id_fkey
      foreign key (po_id) references public.purchase_orders(id) on delete set null;
  end if;
end $$;

-- ── Supplier Items ────────────────────────────────────────────────────────────

create table if not exists public.supplier_items (
  id            uuid primary key default uuid_generate_v4(),
  supplier_id   uuid not null references public.suppliers(id) on delete cascade,
  description   text not null,
  unit          text not null default 'kg',
  typical_price numeric(10,2) not null default 0,
  display_order int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_supplier_items_supplier on public.supplier_items(supplier_id);

alter table public.supplier_items enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'supplier_items' and policyname = 'supplier_items_select') then
    create policy "supplier_items_select" on public.supplier_items for select using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'supplier_items' and policyname = 'supplier_items_insert') then
    create policy "supplier_items_insert" on public.supplier_items for insert with check (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'supplier_items' and policyname = 'supplier_items_update') then
    create policy "supplier_items_update" on public.supplier_items for update using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'supplier_items' and policyname = 'supplier_items_delete') then
    create policy "supplier_items_delete" on public.supplier_items for delete using (auth.uid() is not null);
  end if;
end $$;
