-- ============================================================================
-- 036 — Ordering schedule + recurring tasks + completions
--   Powers the "Today's Tasks" page: a per-store weekly ordering schedule,
--   user-defined recurring tasks, and per-day completion tracking.
--
--   day_of_week convention: 0 = Monday … 6 = Sunday (matches targets.day_of_week).
--   Safe to re-run.
-- ============================================================================

-- ── 1. Ordering schedule — which suppliers to order from, per store per day ──
create table if not exists public.ordering_schedule (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  day_of_week   int  not null check (day_of_week between 0 and 6),
  supplier_name text not null,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, day_of_week, supplier_name)
);

create index if not exists idx_ordering_schedule_restaurant
  on public.ordering_schedule(restaurant_id);

alter table public.ordering_schedule enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ordering_schedule' and policyname='ordering_schedule_select') then
    create policy "ordering_schedule_select" on public.ordering_schedule for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='ordering_schedule' and policyname='ordering_schedule_insert') then
    create policy "ordering_schedule_insert" on public.ordering_schedule for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='ordering_schedule' and policyname='ordering_schedule_delete') then
    create policy "ordering_schedule_delete" on public.ordering_schedule for delete using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;

-- ── 2. Recurring tasks — user-defined to-dos, per store (or all) per day ─────
--   restaurant_id null  → applies to every venue.
--   day_of_week   null  → applies every day.
create table if not exists public.recurring_tasks (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid references public.restaurants on delete cascade,
  day_of_week   int check (day_of_week between 0 and 6),
  title         text not null,
  sort_order    int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_recurring_tasks_restaurant
  on public.recurring_tasks(restaurant_id);

alter table public.recurring_tasks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='recurring_tasks' and policyname='recurring_tasks_select') then
    create policy "recurring_tasks_select" on public.recurring_tasks for select
      using (restaurant_id is null or public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='recurring_tasks' and policyname='recurring_tasks_insert') then
    create policy "recurring_tasks_insert" on public.recurring_tasks for insert
      with check (case when restaurant_id is null then public.is_superadmin() else public.has_restaurant_access(restaurant_id) end);
  end if;
  if not exists (select 1 from pg_policies where tablename='recurring_tasks' and policyname='recurring_tasks_update') then
    create policy "recurring_tasks_update" on public.recurring_tasks for update
      using (case when restaurant_id is null then public.is_superadmin() else public.has_restaurant_access(restaurant_id) end);
  end if;
  if not exists (select 1 from pg_policies where tablename='recurring_tasks' and policyname='recurring_tasks_delete') then
    create policy "recurring_tasks_delete" on public.recurring_tasks for delete
      using (case when restaurant_id is null then public.is_superadmin() else public.has_restaurant_access(restaurant_id) end);
  end if;
end $$;

-- ── 3. Task completions — one row per (store, task, date) that's been ticked ─
create table if not exists public.task_completions (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  task_key      text not null,          -- e.g. 'order:Bidfood', 'recurring:<uuid>', 'builtin:labour'
  task_date     date not null,
  completed_by  uuid references public.profiles on delete set null,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, task_key, task_date)
);

create index if not exists idx_task_completions_lookup
  on public.task_completions(restaurant_id, task_date);

alter table public.task_completions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='task_completions' and policyname='task_completions_select') then
    create policy "task_completions_select" on public.task_completions for select using (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='task_completions' and policyname='task_completions_insert') then
    create policy "task_completions_insert" on public.task_completions for insert with check (public.has_restaurant_access(restaurant_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='task_completions' and policyname='task_completions_delete') then
    create policy "task_completions_delete" on public.task_completions for delete using (public.has_restaurant_access(restaurant_id));
  end if;
end $$;

-- ── 4. Seed one example recurring task for every venue: Monday invoices ───────
insert into public.recurring_tasks (restaurant_id, day_of_week, title, sort_order)
select null, 0, 'Enter previous week''s invoices', 0
where not exists (
  select 1 from public.recurring_tasks
  where title = 'Enter previous week''s invoices' and day_of_week = 0
);
