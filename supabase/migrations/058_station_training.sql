-- ============================================================================
-- 058. STATION TRAINING  (who is trained on which station, and how well)
-- ----------------------------------------------------------------------------
-- Records, per rosterable team member, the stations (public.positions — both
-- Areas and Sub-areas) they are trained on and their proficiency level:
--   basic  <  intermediate  <  advanced
--
-- Powers two things:
--   • the Training matrix in Settings → Team → Training
--   • the roster "Auto-build" button, which only assigns a person to a shift
--     whose position they are trained on, preferring advanced over
--     intermediate over basic.
--
-- A missing row = "not trained on that station" (the person is never
-- auto-assigned to it). Deleting a station or a person cascades this row away.
-- ============================================================================

create table if not exists public.station_training (
  id          uuid        primary key default uuid_generate_v4(),
  employee_id uuid        not null references public.profiles(id)  on delete cascade,
  position_id uuid        not null references public.positions(id) on delete cascade,
  level       text        not null check (level in ('basic', 'intermediate', 'advanced')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (employee_id, position_id)
);

create index if not exists idx_station_training_employee on public.station_training(employee_id);
create index if not exists idx_station_training_position on public.station_training(position_id);

alter table public.station_training enable row level security;

-- Read: a team member may see their own training; any roster viewer
-- (managers + shift supervisors) may see everyone's (needed for the matrix
-- and for auto-build).
create policy "station_training_select" on public.station_training
  for select using (employee_id = auth.uid() or public.is_roster_viewer());

-- Write: roster managers only (superadmin / area_manager / manager).
create policy "station_training_insert" on public.station_training
  for insert with check (public.is_roster_manager());
create policy "station_training_update" on public.station_training
  for update using (public.is_roster_manager());
create policy "station_training_delete" on public.station_training
  for delete using (public.is_roster_manager());

create trigger station_training_updated_at
  before update on public.station_training
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- END OF MIGRATION 058
-- ============================================================================
