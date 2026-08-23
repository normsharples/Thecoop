-- ============================================================================
-- 051. FIX RLS RECURSION BETWEEN shifts AND shift_swaps
-- Migration 050 made shifts.SELECT reference shift_swaps, while
-- shift_swaps.INSERT already references shifts — a mutual RLS reference that
-- Postgres rejects ("infinite recursion detected in policy"). Move both
-- cross-table checks into SECURITY DEFINER helpers (which bypass RLS) so the
-- policies no longer reference each other's tables directly.
-- ============================================================================

-- Does the current user own this shift? (bypasses shifts RLS)
create or replace function public.shift_belongs_to_me(sid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.shifts s
    where s.id = sid and s.employee_id = auth.uid()
  );
$$;

-- Is there an open swap for this shift, or one the current user claimed?
create or replace function public.shift_has_open_swap(sid uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.shift_swaps sw
    where sw.shift_id = sid
      and (sw.status = 'offered' or sw.claimed_by = auth.uid())
  );
$$;

-- Rebuild shifts SELECT without a direct shift_swaps reference.
drop policy if exists "shifts_select" on public.shifts;
create policy "shifts_select" on public.shifts
  for select using (
    public.has_roster_view(restaurant_id)
    or (
      employee_id = auth.uid()
      and exists (
        select 1 from public.roster_weeks w
        where w.restaurant_id = shifts.restaurant_id
          and w.week_start = (date_trunc('week', shifts.date)::date)
          and w.status = 'published'
      )
    )
    or public.shift_has_open_swap(shifts.id)
  );

-- Rebuild shift_swaps INSERT without a direct shifts reference.
drop policy if exists "shift_swaps_insert" on public.shift_swaps;
create policy "shift_swaps_insert" on public.shift_swaps
  for insert with check (
    offered_by = auth.uid() and public.shift_belongs_to_me(shift_id)
  );
