-- ============================================================================
-- Expenses — one-off and recurring overhead expenses for the P&L
-- Safe to re-run. Run this in your Supabase SQL editor.
-- ============================================================================

-- ── One-off expenses ──────────────────────────────────────────────────────────

create table if not exists public.expenses (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  category      text,
  description   text not null,
  amount        numeric not null check (amount > 0),
  expense_date  date not null,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_expenses_restaurant on public.expenses(restaurant_id);
create index if not exists idx_expenses_date       on public.expenses(expense_date);

alter table public.expenses enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'expenses' and policyname = 'expenses_select') then
    create policy "expenses_select" on public.expenses for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'expenses' and policyname = 'expenses_insert') then
    create policy "expenses_insert" on public.expenses for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'expenses' and policyname = 'expenses_delete') then
    create policy "expenses_delete" on public.expenses for delete using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;

-- ── Recurring expenses (templates: rent, utilities, insurance, subscriptions) ─

create table if not exists public.recurring_expenses (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  name          text not null,
  category      text,
  amount        numeric not null check (amount > 0),
  frequency     text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','yearly')),
  start_date    date not null,
  end_date      date,
  active        boolean not null default true,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_recurring_expenses_restaurant on public.recurring_expenses(restaurant_id);

alter table public.recurring_expenses enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'recurring_expenses' and policyname = 'recurring_expenses_select') then
    create policy "recurring_expenses_select" on public.recurring_expenses for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'recurring_expenses' and policyname = 'recurring_expenses_insert') then
    create policy "recurring_expenses_insert" on public.recurring_expenses for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'recurring_expenses' and policyname = 'recurring_expenses_update') then
    create policy "recurring_expenses_update" on public.recurring_expenses for update using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'recurring_expenses' and policyname = 'recurring_expenses_delete') then
    create policy "recurring_expenses_delete" on public.recurring_expenses for delete using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;
