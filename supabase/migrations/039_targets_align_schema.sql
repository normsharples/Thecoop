-- ============================================================================
-- 039. ALIGN targets TABLE WITH APP CODE
-- The live targets table predates the app's targets code: it is missing the
-- `value` and `day_of_week` columns (hence PGRST204 "Could not find the
-- 'day_of_week' column"). This adds them, backfills from the legacy
-- `target_value` column if present, relaxes constraints the app doesn't use,
-- and creates the unique key the app's upsert (onConflict) relies on.
-- Idempotent — safe to run once; re-running is a no-op.
-- ============================================================================

-- 1. Columns the app reads/writes.
alter table public.targets add column if not exists value       numeric;
alter table public.targets add column if not exists day_of_week smallint;

-- 2. Legacy `target_value` (from the original schema): backfill into `value`
--    and drop its NOT NULL so inserts that omit it succeed.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'targets'
      and column_name = 'target_value'
  ) then
    update public.targets set value = target_value where value is null;
    execute 'alter table public.targets alter column target_value drop not null';
  end if;
end $$;

-- 3. The app writes period = 'current'; drop any CHECK that would reject it.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.targets'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%period%'
  loop
    execute format('alter table public.targets drop constraint %I', c.conname);
  end loop;
end $$;

-- 4. Unique key for the upsert. NULLS NOT DISTINCT (PG15+) so a null
--    day_of_week (store-wide metrics like spmh) still conflict-matches.
create unique index if not exists targets_upsert_key
  on public.targets (restaurant_id, metric, period, day_of_week) nulls not distinct;

-- 5. Force PostgREST to reload its schema cache immediately.
notify pgrst, 'reload schema';
