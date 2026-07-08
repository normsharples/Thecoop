-- ============================================================================
-- 010 — Suppliers table (global, shared across all restaurants)
-- ============================================================================

create table public.suppliers (
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

create trigger suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.handle_updated_at();

alter table public.suppliers enable row level security;

-- All authenticated users can view suppliers
create policy "suppliers_select" on public.suppliers
  for select using (auth.uid() is not null);

-- Only superadmins can manage suppliers
create policy "suppliers_insert" on public.suppliers
  for insert with check (public.is_superadmin());

create policy "suppliers_update" on public.suppliers
  for update using (public.is_superadmin());

create policy "suppliers_delete" on public.suppliers
  for delete using (public.is_superadmin());
