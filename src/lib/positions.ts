import type { Position } from "@/types";

const DEFAULT_COLOUR = "#6366f1";
const UNASSIGNED_COLOUR = "#94a3b8";

/** A position's colour, inheriting from its parent Area when unset. */
export function effectiveColour(
  positionId: string | null | undefined,
  byId: Map<string, Position>
): string {
  if (!positionId) return UNASSIGNED_COLOUR;
  const pos = byId.get(positionId);
  if (!pos) return UNASSIGNED_COLOUR;
  if (pos.colour) return pos.colour;
  if (pos.parent_id) {
    const parent = byId.get(pos.parent_id);
    if (parent?.colour) return parent.colour;
  }
  return DEFAULT_COLOUR;
}

/** Resolve a shift's position into its Area and (optional) Sub-area. */
export function areaAndSub(
  positionId: string | null | undefined,
  byId: Map<string, Position>
): { area: Position | null; sub: Position | null } {
  if (!positionId) return { area: null, sub: null };
  const pos = byId.get(positionId);
  if (!pos) return { area: null, sub: null };
  if (pos.parent_id) {
    return { area: byId.get(pos.parent_id) ?? null, sub: pos };
  }
  return { area: pos, sub: null };
}

/** Full label for a position, e.g. "Front of House › Fryers". */
export function positionLabel(
  positionId: string | null | undefined,
  byId: Map<string, Position>
): string {
  const { area, sub } = areaAndSub(positionId, byId);
  if (!area) return "Unassigned";
  return sub ? `${area.name} › ${sub.name}` : area.name;
}

/** Areas with their sub-areas, in configured order — the roster grouping shape. */
export type AreaLayout = { area: Position; subs: Position[] }[];

/**
 * The position ids a roster filter should match: the chosen area plus every
 * sub-area under it. Returns null for "everything", so callers can skip
 * filtering entirely.
 */
export function positionScope(
  positionId: string,
  positions: Position[]
): Set<string> | null {
  if (!positionId) return null;
  const ids = new Set<string>([positionId]);
  for (const p of positions) if (p.parent_id === positionId) ids.add(p.id);
  return ids;
}
