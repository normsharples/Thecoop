-- ============================================================================
-- 009 — Invoices table for food cost tracking
-- ============================================================================

create table public.invoices (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  supplier_name text not null,
  amount        numeric not null check (amount > 0),
  invoice_date  date not null,
  notes         text,
  created_by    uuid references public.profiles on delete set null,
  created_at    timestamptz not null default now()
);

create index idx_invoices_restaurant on public.invoices(restaurant_id);
create index idx_invoices_date       on public.invoices(invoice_date);

alter table public.invoices enable row level security;

create policy "invoices_select" on public.invoices
  for select using (public.has_restaurant_access(restaurant_id));

create policy "invoices_insert" on public.invoices
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "invoices_delete" on public.invoices
  for delete using (public.has_restaurant_access(restaurant_id));
