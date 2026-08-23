import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEmployees } from "@/hooks/useEmployees";
import { usePositions } from "@/hooks/usePositions";
import { useShiftTemplate, type TemplateLineInput } from "@/hooks/useShiftTemplate";
import { formatTime, shiftHours } from "@/lib/roster";
import { effectiveColour } from "@/lib/positions";
import type { Position, ShiftTemplateLine } from "@/types";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export default function TemplateEditor({
  restaurantId,
  onClose,
}: {
  restaurantId: string;
  onClose: () => void;
}) {
  const { lines, isLoading, saveLine, isSavingLine, removeLine } =
    useShiftTemplate(restaurantId);
  const { data: employees = [] } = useEmployees();
  const { activePositions } = usePositions(restaurantId);
  const posById = useMemo(
    () => new Map(activePositions.map((p) => [p.id, p])),
    [activePositions]
  );
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const [editing, setEditing] = useState<Partial<TemplateLineInput> | null>(null);

  const openAdd = (dow: number) =>
    setEditing({
      day_of_week: dow,
      employee_id: null,
      start_time: "09:00",
      end_time: "17:00",
      unpaid_break_minutes: 0,
      position_id: null,
      note: null,
    });

  const openEdit = (l: ShiftTemplateLine) =>
    setEditing({
      id: l.id,
      day_of_week: l.day_of_week,
      employee_id: l.employee_id,
      start_time: l.start_time.slice(0, 5),
      end_time: l.end_time.slice(0, 5),
      unpaid_break_minutes: l.unpaid_break_minutes,
      position_id: l.position_id,
      note: l.note,
    });

  const handleDelete = async (id: string) => {
    try {
      await removeLine(id);
      toast.success("Removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-8">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card p-6">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Roster template</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          A reusable weekly pattern. Build it by day, then use “Generate template into
          this week” from the roster's Options menu to drop it onto any week.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-3">
            {DAY_NAMES.map((name, dow) => {
              const dayLines = lines
                .filter((l) => l.day_of_week === dow)
                .sort((a, b) => (a.start_time < b.start_time ? -1 : 1));
              return (
                <div key={dow} className="rounded-lg border border-border">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-sm font-semibold text-foreground">{name}</span>
                    <button
                      onClick={() => openAdd(dow)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                  </div>
                  {dayLines.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No shifts.</div>
                  ) : (
                    <div className="divide-y divide-border">
                      {dayLines.map((l) => {
                        const pos = l.position_id ? posById.get(l.position_id) : null;
                        const emp = l.employee_id ? empById.get(l.employee_id) : null;
                        return (
                          <div key={l.id} className="flex items-center gap-2 px-3 py-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: effectiveColour(l.position_id, posById) }}
                            />
                            <button
                              onClick={() => openEdit(l)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="text-sm font-medium text-foreground">
                                {formatTime(l.start_time)}–{formatTime(l.end_time)}
                                {l.unpaid_break_minutes > 0 && (
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    · {l.unpaid_break_minutes}m
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {emp ? emp.full_name : "Open"}
                                {pos ? ` · ${pos.name}` : ""}
                              </div>
                            </button>
                            <button
                              onClick={() => handleDelete(l.id)}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Done
          </button>
        </div>
      </div>

      {editing && (
        <LineEditor
          draft={editing}
          employees={employees}
          positions={activePositions}
          saving={isSavingLine}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            try {
              await saveLine(input);
              setEditing(null);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to save");
            }
          }}
        />
      )}
    </div>
  );
}

// ── Add / edit one template line ──────────────────────────────────────────────
function LineEditor({
  draft,
  employees,
  positions,
  saving,
  onClose,
  onSave,
}: {
  draft: Partial<TemplateLineInput>;
  employees: { id: string; full_name: string }[];
  positions: Position[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: TemplateLineInput) => void;
}) {
  const [dow, setDow] = useState(draft.day_of_week ?? 0);
  const [employeeId, setEmployeeId] = useState(draft.employee_id ?? "");
  const [start, setStart] = useState((draft.start_time ?? "09:00").slice(0, 5));
  const [end, setEnd] = useState((draft.end_time ?? "17:00").slice(0, 5));
  const [breakMins, setBreakMins] = useState(draft.unpaid_break_minutes ?? 0);
  const [breakTouched, setBreakTouched] = useState(Boolean(draft.id));
  const [positionId, setPositionId] = useState<string | null>(draft.position_id ?? null);
  const [note, setNote] = useState(draft.note ?? "");

  // Auto-insert a 30-min break on new lines once they reach 5+ hours.
  useEffect(() => {
    if (breakTouched || !start || !end) return;
    setBreakMins(shiftHours(start, end, 0) >= 5 ? 30 : 0);
  }, [start, end, breakTouched]);

  const areas = positions.filter((p) => !p.parent_id);

  const submit = () => {
    if (!start || !end) return toast.error("Set start and end times");
    onSave({
      id: draft.id,
      day_of_week: dow,
      employee_id: employeeId || null,
      start_time: start,
      end_time: end,
      unpaid_break_minutes: Number(breakMins) || 0,
      position_id: positionId,
      note: note.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">
            {draft.id ? "Edit shift" : "Add shift"}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Day">
            <select value={dow} onChange={(e) => setDow(Number(e.target.value))} className={sel}>
              {DAY_NAMES.map((n, i) => (
                <option key={i} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Team member">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={sel}>
              <option value="">Open (no one assigned)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Start">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={sel} />
            </Field>
            <Field label="End">
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={sel} />
            </Field>
            <Field label="Break (min)">
              <input
                type="number"
                min={0}
                step={5}
                value={breakMins}
                onChange={(e) => {
                  setBreakMins(Number(e.target.value));
                  setBreakTouched(true);
                }}
                className={sel}
              />
            </Field>
          </div>

          <Field label="Area / sub-area">
            <select
              value={positionId ?? ""}
              onChange={(e) => setPositionId(e.target.value || null)}
              className={sel}
            >
              <option value="">Unassigned</option>
              {areas.map((area) => {
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
          </Field>

          <Field label="Note">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. open up"
              className={sel}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const sel =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
