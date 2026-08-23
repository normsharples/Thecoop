-- ============================================================================
-- 043. POSITION SUB-AREAS
-- Adds an optional parent to positions so they form a two-level hierarchy:
--   Area (parent_id null)  →  Sub-area (parent_id = the area's id)
-- e.g. "Front of House" (area) → "Fryers" (sub-area).
--
-- A shift's position_id may point at either an area or a sub-area. Deleting an
-- area cascades to its sub-areas; shifts that referenced them fall back to
-- unassigned (shifts.position_id is ON DELETE SET NULL).
-- The UI enforces only two levels (a sub-area cannot itself have children).
-- ============================================================================

alter table public.positions
  add column if not exists parent_id uuid references public.positions(id) on delete cascade;

create index if not exists idx_positions_parent on public.positions(parent_id);
