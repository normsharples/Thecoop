import { useMemo, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, X, CornerDownRight } from "lucide-react";
import { toast } from "sonner";
import { usePositions } from "@/hooks/usePositions";
import { useRestaurants } from "@/hooks/useRestaurants";
import { effectiveColour } from "@/lib/positions";
import type { Position } from "@/types";

const SWATCHES = [
  "#6366f1", "#ec4899", "#f97316", "#22c55e",
  "#0ea5e9", "#eab308", "#8b5cf6", "#ef4444",
  "#14b8a6", "#64748b",
];

export default function PositionsSettings({ restaurantId }: { restaurantId?: string } = {}) {
  const { allPositions, isLoading, upsert, isSaving, remove } = usePositions();
  const { data: restaurants = [] } = useRestaurants();
  // "" = All locations (global, restaurant_id null). Locked when embedded for a venue.
  const [scope, setScope] = useState<string>(restaurantId ?? "");
  const locked = Boolean(restaurantId);
  const [editing, setEditing] = useState<Partial<Position> | null>(null);

  // Show exactly the chosen scope: global rows, or one venue's own rows.
  const positions = useMemo(
    () =>
      allPositions.filter((p) => (scope ? p.restaurant_id === scope : p.restaurant_id == null)),
    [allPositions, scope]
  );

  const byId = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const areas = useMemo(() => positions.filter((p) => !p.parent_id), [positions]);
  const subsOf = (areaId: string) =>
    positions.filter((p) => p.parent_id === areaId);

  const handleSave = async () => {
    if (!editing?.name?.trim()) return toast.error("Name is required");
    try {
      await upsert({
        id: editing.id,
        name: editing.name.trim(),
        colour: editing.colour ?? null, // null = inherit (sub-area) / default
        sort_order: editing.sort_order ?? positions.length,
        active: editing.active ?? true,
        parent_id: editing.parent_id ?? null,
        // new rows take the current scope; existing rows keep their own venue.
        restaurant_id: editing.id ? editing.restaurant_id ?? null : scope || null,
      });
      toast.success("Saved");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const handleDelete = async (p: Position) => {
    const isArea = !p.parent_id;
    const msg = isArea
      ? "Delete this area and all its sub-areas? Shifts using them become unassigned."
      : "Delete this sub-area? Shifts using it become unassigned.";
    if (!window.confirm(msg)) return;
    try {
      await remove(p.id);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const isSub = Boolean(editing?.parent_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Areas & sub-areas</h2>
          <p className="text-sm text-muted-foreground">
            Group the roster by area (e.g. Front of House, Kitchen) and optional sub-areas
            within them (e.g. Fryers).
          </p>
        </div>
        <button
          onClick={() => setEditing({ name: "", colour: SWATCHES[0], active: true, parent_id: null })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add area
        </button>
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-foreground">Location</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All locations (every venue)</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {scope
              ? "Areas added here show only at this venue."
              : "“All locations” areas show at every venue."}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : areas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">
          No areas yet. Add your first one.
        </div>
      ) : (
        <div className="space-y-3">
          {areas.map((area) => (
            <div key={area.id} className="rounded-xl border border-border bg-card">
              {/* Area row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: effectiveColour(area.id, byId) }}
                />
                <span className="flex-1 text-sm font-semibold text-foreground">{area.name}</span>
                {!area.active && (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Inactive
                  </span>
                )}
                <button
                  onClick={() =>
                    setEditing({ name: "", colour: null, active: true, parent_id: area.id })
                  }
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Sub-area
                </button>
                <button onClick={() => setEditing(area)} className={iconBtn}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(area)} className={dangerBtn}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Sub-areas */}
              {subsOf(area.id).length > 0 && (
                <div className="border-t border-border px-4 py-2 space-y-1">
                  {subsOf(area.id).map((sub) => (
                    <div key={sub.id} className="flex items-center gap-3 py-1.5">
                      <CornerDownRight className="h-4 w-4 text-muted-foreground/40" />
                      <span
                        className="h-3.5 w-3.5 rounded-full"
                        style={{ backgroundColor: effectiveColour(sub.id, byId) }}
                      />
                      <span className="flex-1 text-sm text-foreground">{sub.name}</span>
                      {!sub.active && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          Inactive
                        </span>
                      )}
                      <button onClick={() => setEditing(sub)} className={iconBtn}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(sub)} className={dangerBtn}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                {editing.id ? "Edit" : isSub ? "Add sub-area" : "Add area"}
              </h3>
              <button onClick={() => setEditing(null)} className="rounded-md p-1 hover:bg-accent">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Name</label>
                <input
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder={isSub ? "Fryers" : "Front of House"}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {isSub && (
                    <button
                      onClick={() => setEditing({ ...editing, colour: null })}
                      className="inline-flex h-7 items-center rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground"
                      style={{
                        boxShadow: editing.colour == null ? "0 0 0 2px var(--ring)" : undefined,
                      }}
                    >
                      Inherit
                    </button>
                  )}
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setEditing({ ...editing, colour: c })}
                      className="h-7 w-7 rounded-full"
                      style={{
                        backgroundColor: c,
                        boxShadow: editing.colour === c ? `0 0 0 2px ${c}` : undefined,
                      }}
                    />
                  ))}
                </div>
                {isSub && (
                  <p className="text-xs text-muted-foreground">
                    “Inherit” uses the area's colour.
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={editing.active ?? true}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  className="rounded border-input"
                />
                Active (available when building rosters)
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtn =
  "rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground";
const dangerBtn =
  "rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive";
