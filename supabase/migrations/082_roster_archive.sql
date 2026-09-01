-- ============================================================================
-- 082. ROSTER ARCHIVE  (historical rosters imported from Deputy)
-- ----------------------------------------------------------------------------
-- Reference-only store for rosters worked before The Coop. Deliberately NOT the
-- shifts table: imported history must never feed live rostering, labour
-- projections, or the pending-timesheet generator.
--
-- Source is Deputy's Data Exporter (Roster export, CSV). The whole original row
-- is kept in `raw` so a mis-mapped column can be re-derived without re-importing.
-- ============================================================================

create table if not exists public.roster_archive (
  id                uuid        primary key default uuid_generate_v4(),
  restaurant_id     uuid        not null references public.restaurants(id) on delete cascade,
  source            text        not null default 'deputy',
  external_id       text,                       -- Deputy Roster Id, when present
  work_date         date        not null,
  start_time        timestamptz not null,
  end_time          timestamptz not null,
  mealbreak_minutes integer     not null default 0,
  total_hours       numeric(6,2),
  cost              numeric(10,2),
  area_name         text,                       -- Deputy OperationalUnit
  employee_name     text        not null,       -- exactly as Deputy had it
  employee_id       uuid        references public.profiles(id) on delete set null,
  comment           text,
  published         boolean,
  is_open_shift     boolean     not null default false,
  raw               jsonb,
  imported_at       timestamptz not null default now(),
  imported_by       uuid        references public.profiles(id) on delete set null
);

-- Re-importing the same export must not duplicate. Rows without an external id
-- fall back to the natural key of the shift.
create unique index if not exists uniq_roster_archive_external
  on public.roster_archive (restaurant_id, source, external_id)
  where external_id is not null;

create unique index if not exists uniq_roster_archive_natural
  on public.roster_archive (restaurant_id, work_date, employee_name, start_time, end_time)
  where external_id is null;

create index if not exists idx_roster_archive_date     on public.roster_archive(restaurant_id, work_date);
create index if not exists idx_roster_archive_employee on public.roster_archive(employee_id);
create index if not exists idx_roster_archive_name     on public.roster_archive(lower(employee_name));

alter table public.roster_archive enable row level security;

-- Managers of the store only. Archive data is payroll-adjacent, so team members
-- get no blanket read here.
create policy "roster_archive_select" on public.roster_archive
  for select using (public.has_roster_manage(restaurant_id));
create policy "roster_archive_insert" on public.roster_archive
  for insert with check (public.has_roster_manage(restaurant_id));
create policy "roster_archive_update" on public.roster_archive
  for update using (public.has_roster_manage(restaurant_id));
create policy "roster_archive_delete" on public.roster_archive
  for delete using (public.has_roster_manage(restaurant_id));

-- ── Name -> profile matching ────────────────────────────────────────────────
-- Deputy display names are inconsistent ("megan smith" vs "Norman Sharples"),
-- so match case- and whitespace-insensitively, and leave employee_id null when
-- there is no exact single match rather than guessing.
create or replace function public.link_roster_archive_employees(
  p_restaurant_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked integer;
begin
  with norm as (
    select ra.id,
           lower(regexp_replace(ra.employee_name, '\s+', ' ', 'g')) as n
    from public.roster_archive ra
    where ra.employee_id is null
      and (p_restaurant_id is null or ra.restaurant_id = p_restaurant_id)
  ),
  matched as (
    select n.id,
           (select p.id
              from public.profiles p
             where lower(regexp_replace(p.full_name, '\s+', ' ', 'g')) = n.n
             -- only when the name is unambiguous
             having count(*) = 1
             limit 1) as profile_id
    from norm n
  ),
  updated as (
    update public.roster_archive ra
       set employee_id = m.profile_id
      from matched m
     where ra.id = m.id
       and m.profile_id is not null
    returning 1
  )
  select count(*) into v_linked from updated;

  return v_linked;
end;
$$;

grant execute on function public.link_roster_archive_employees(uuid) to authenticated;

-- ============================================================================
-- END OF MIGRATION 082
-- ============================================================================
