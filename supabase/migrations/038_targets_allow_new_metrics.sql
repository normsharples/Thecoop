-- ============================================================================
-- 038. ALLOW NEW TARGET METRICS
-- The targets.metric column had a CHECK constraint enumerating the known metric
-- keys, so inserting a new metric (spmh, min_roster_hours for the Roster
-- dashboard) failed with "failed to save target". Metric keys are managed in
-- app code (TARGET_METRICS in useTargets.ts), so drop any CHECK constraint on
-- targets that references `metric` and let it stay free-text.
-- Safe to run even if no such constraint exists (the loop simply does nothing).
-- ============================================================================

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.targets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%metric%'
  loop
    execute format('alter table public.targets drop constraint %I', c.conname);
  end loop;
end $$;
