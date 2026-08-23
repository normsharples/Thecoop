import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Wand2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePositions } from "@/hooks/usePositions";
import { useStaffingMatrix } from "@/hooks/useStaffingMatrix";
import { useStaffingConfig } from "@/hooks/useStaffingConfig";
import { STAFFING_TEMPLATES, stationsForSales } from "@/lib/staffing";
import { formatCurrency } from "@/lib/utils";
import type { Position, StaffingConfig, StaffingMatrixRow } from "@/types";

const hourLabel = (h: number) => {
  const period = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${period}`;
};

export default function StaffingSettings() {
  const { data: restaurants = [] } = useRestaurants();
  const [venueId, setVenueId] = useState<string>("");
  useEffect(() => {
    if (!venueId && restaurants.length) setVenueId(restaurants[0].id);
  }, [restaurants, venueId]);

  const { activePositions } = usePositions(venueId || null);
  const { rows, isLoading, upsert, remove, replaceAll } = useStaffingMatrix(venueId || null);
  const { config, save: saveConfig } = useStaffingConfig(venueId || null);

  const templateKeys = Object.keys(STAFFING_TEMPLATES);

  const loadTemplate = async (key: string) => {
    if (!venueId) return;
    if (rows.length && !window.confirm(`Replace this venue's matrix with the "${key}" template?`))
      return;
    const tpl = STAFFING_TEMPLATES[key] ?? [];
    // Auto-map each station to a position with the same name (case-insensitive).
    const byName = new Map(activePositions.map((p) => [p.name.toLowerCase(), p.id]));
    try {
      await replaceAll({
        restaurant_id: venueId,
        rows: tpl.map((t) => ({
          station_name: t.station_name,
          threshold_sales: t.threshold_sales,
          position_id: byName.get(t.station_name.toLowerCase()) ?? null,
        })),
      });
      toast.success(`Loaded ${tpl.length}-row template`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load template");
    }
  };

  const patchRow = async (row: StaffingMatrixRow, changes: Partial<StaffingMatrixRow>) => {
    try {
      await upsert({ ...row, ...changes });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const addRow = async () => {
    if (!venueId) return;
    try {
      await upsert({
        restaurant_id: venueId,
        station_name: "New station",
        threshold_sales: 0,
        slot_order: rows.length,
        active: true,
        position_id: null,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Staffing (sales → required staff)</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The grid the roster's “Build from sales” uses. Each row is a staffing
            slot that switches on once an hour's projected sales reach its
            threshold. Add a second row for the same station to require a second
            person at higher volume. Map each station to a roster position so
            training and auto-assign apply.
          </p>
        </div>
        <select
          value={venueId}
          onChange={(e) => setVenueId(e.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {config && (
        <ConfigPanel key={venueId} config={config} onSave={saveConfig} />
      )}

      {/* Matrix editor */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Required staff by hourly sales</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Wand2 className="h-4 w-4 text-muted-foreground" />
              {templateKeys.map((k) => (
                <button
                  key={k}
                  onClick={() => loadTemplate(k)}
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent"
                >
                  Load {k}
                </button>
              ))}
            </div>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Add slot
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No matrix yet. Load a template above or add slots.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Station</th>
                  <th className="px-4 py-2 font-medium">Needed at ≥ ($/hr)</th>
                  <th className="px-4 py-2 font-medium">Roster position</th>
                  <th className="px-4 py-2 font-medium text-center">Active</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <MatrixRow
                    key={row.id}
                    row={row}
                    positions={activePositions}
                    onPatch={patchRow}
                    onDelete={() => remove(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MatrixTester rows={rows} />
    </div>
  );
}

// ── Editable matrix row ───────────────────────────────────────────────────────
function MatrixRow({
  row,
  positions,
  onPatch,
  onDelete,
}: {
  row: StaffingMatrixRow;
  positions: Position[];
  onPatch: (row: StaffingMatrixRow, changes: Partial<StaffingMatrixRow>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(row.station_name);
  const [threshold, setThreshold] = useState(String(row.threshold_sales));
  useEffect(() => setName(row.station_name), [row.station_name]);
  useEffect(() => setThreshold(String(row.threshold_sales)), [row.threshold_sales]);

  return (
    <tr className="hover:bg-muted/10">
      <td className="px-4 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== row.station_name && onPatch(row, { station_name: name.trim() })}
          className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">$</span>
          <input
            type="number"
            min={0}
            step={100}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={() => {
              const v = Number(threshold) || 0;
              if (v !== row.threshold_sales) onPatch(row, { threshold_sales: v });
            }}
            className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </td>
      <td className="px-4 py-2">
        <select
          value={row.position_id ?? ""}
          onChange={(e) => onPatch(row, { position_id: e.target.value || null })}
          className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">— Unmapped —</option>
          {positions
            .filter((p) => !p.parent_id)
            .map((area) => {
              const subs = positions.filter((s) => s.parent_id === area.id);
              if (subs.length === 0)
                return (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                );
              return (
                <optgroup key={area.id} label={area.name}>
                  <option value={area.id}>{area.name} (general)</option>
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {area.name} › {s.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
        </select>
      </td>
      <td className="px-4 py-2 text-center">
        <input
          type="checkbox"
          checked={row.active}
          onChange={(e) => onPatch(row, { active: e.target.checked })}
          className="rounded border-input"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={onDelete}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

// ── Config panel ──────────────────────────────────────────────────────────────
function ConfigPanel({
  config,
  onSave,
}: {
  config: StaffingConfig;
  onSave: (patch: Partial<StaffingConfig> & { restaurant_id: string }) => Promise<void>;
}) {
  const [local, setLocal] = useState<StaffingConfig>(config);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLocal(config), [config]);

  const num = (k: keyof StaffingConfig) => String(local[k] ?? "");
  const setNum = (k: keyof StaffingConfig, v: string) =>
    setLocal((p) => ({ ...p, [k]: v === "" ? 0 : Number(v) }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ ...local, restaurant_id: config.restaurant_id });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Opening hours &amp; shift rules</h3>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Num label="Opens (hour 0–23)" value={num("open_hour")} onChange={(v) => setNum("open_hour", v)} step="1" />
        <Num label="Closes (hour 0–23)" value={num("close_hour")} onChange={(v) => setNum("close_hour", v)} step="1" />
        <Num label="Min shift (hrs)" value={num("min_shift_hours")} onChange={(v) => setNum("min_shift_hours", v)} step="0.5" />
        <Num label="Break over (hrs)" value={num("break_threshold_hours")} onChange={(v) => setNum("break_threshold_hours", v)} step="0.5" />
        <Num label="Break (min)" value={num("break_minutes")} onChange={(v) => setNum("break_minutes", v)} step="5" />
      </div>

      <p className="text-xs text-muted-foreground">
        Shifts run {hourLabel(local.open_hour)}–{hourLabel(local.close_hour)}, at least{" "}
        {local.min_shift_hours}h, with a {local.break_minutes}-min break over{" "}
        {local.break_threshold_hours}h. Projected sales use the day total you enter in
        Projections, shaped by the most recent same-weekday's hourly split.
      </p>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save settings
      </button>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

// ── Live tester ───────────────────────────────────────────────────────────────
function MatrixTester({ rows }: { rows: StaffingMatrixRow[] }) {
  const [sales, setSales] = useState("1200");
  const stations = useMemo(() => stationsForSales(rows, Number(sales) || 0), [rows, sales]);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Test an hour</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">$</span>
          <input
            type="number"
            min={0}
            step={100}
            value={sales}
            onChange={(e) => setSales(e.target.value)}
            className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-sm text-muted-foreground">/ hour needs:</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {stations.length ? (
            stations.map((s, i) => (
              <span
                key={`${s}-${i}`}
                className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {s}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No staff required</span>
          )}
          {stations.length > 0 && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {stations.length} total · {formatCurrency(Number(sales) || 0)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}