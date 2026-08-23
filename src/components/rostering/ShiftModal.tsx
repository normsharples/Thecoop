import { useEffect, useState } from "react";
import { X, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import type { Profile, Position } from "@/types";
import type { ShiftInput } from "@/hooks/useShifts";
import { shiftHours } from "@/lib/roster";

export interface ShiftDraft {
  id?: string;
  employee_id: string;
  date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  break_start?: string | null;
  position_id: string | null;
  note: string | null;
}

export function ShiftModal({
  restaurantId,
  weekDays,
  employees,
  positions,
  draft,
  conflictFor,
  onClose,
  onSave,
  onDelete,
  isSaving,
}: {
  restaurantId: string;
  weekDays: string[];
  employees: Profile[];
  positions: Position[];
  draft: ShiftDraft;
  conflictFor?: (
    employeeId: string | null,
    dateISO: string,
    shiftStart?: string,
    shiftEnd?: string
  ) => "leave" | "unavailable" | null;
  onClose: () => void;
  onSave: (input: ShiftInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  isSaving: boolean;
}) {
  const [employeeId, setEmployeeId] = useState(draft.employee_id);
  const [date, setDate] = useState(draft.date);
  const [startTime, setStartTime] = useState(draft.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(draft.end_time.slice(0, 5));
  const [breakMins, setBreakMins] = useState(draft.unpaid_break_minutes);
  const [breakTouched, setBreakTouched] = useState(false);
  const [breakStartTime, setBreakStartTime] = useState(
    draft.break_start ? draft.break_start.slice(0, 5) : ""
  );

  // On a NEW shift, auto-insert a 30-min break once it reaches 5+ hours
  // (until the user edits the break themselves).
  const isNew = !draft.id;
  useEffect(() => {
    if (!isNew || breakTouched || !startTime || !endTime) return;
    const gross = shiftHours(startTime, endTime, 0);
    setBreakMins(gross >= 5 ? 30 : 0);
  }, [startTime, endTime, isNew, breakTouched]);
  const [positionId, setPositionId] = useState<string | null>(draft.position_id);
  const [note, setNote] = useState(draft.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEdit = Boolean(draft.id);
  const hours =
    startTime && endTime ? shiftHours(startTime, endTime, breakMins) : 0;
  const conflict = conflictFor?.(employeeId || null, date, startTime, endTime) ?? null;

  const handleSave = async () => {
    if (!date) return toast.error("Pick a day");
    if (!startTime || !endTime) return toast.error("Set start and end times");
    try {
      await onSave({
        id: draft.id,
        restaurant_id: restaurantId,
        employee_id: employeeId || null,
        date,
        start_time: startTime,
        end_time: endTime,
        unpaid_break_minutes: Number(breakMins) || 0,
        break_start: Number(breakMins) > 0 && breakStartTime ? breakStartTime : null,
        position_id: positionId,
        note: note.trim() || null,
      });
      toast.success(isEdit ? "Shift updated" : "Shift added");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save shift");
    }
  };

  const handleDelete = async () => {
    if (!draft.id || !onDelete) return;
    try {
      await onDelete(draft.id);
      toast.success("Shift deleted");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete shift");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">
            {isEdit ? "Edit shift" : "Add shift"}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Team member">
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={selectCls}
            >
              <option value="">Unassigned (open shift)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Day">
            <select
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={selectCls}
            >
              {weekDays.map((d) => (
                <option key={d} value={d}>
                  {format(parseISO(d), "EEEE d MMM")}
                </option>
              ))}
            </select>
          </Field>

          {conflict && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {conflict === "leave"
                ? "This person is on approved leave that day."
                : "This person isn't available at that time."}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Start">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="End">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputCls}
              />
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
                className={inputCls}
              />
            </Field>
          </div>

          <p className="text-xs text-muted-foreground -mt-2">
            {hours > 0 ? `${hours.toFixed(2)} paid hours` : "—"}
          </p>

          {Number(breakMins) > 0 && (
            <Field label="Break start (optional)">
              <input
                type="time"
                value={breakStartTime}
                onChange={(e) => setBreakStartTime(e.target.value)}
                className={inputCls}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to auto-centre. You can also drag the break on the day view.
              </p>
            </Field>
          )}

          <Field label="Area / sub-area">
            <select
              value={positionId ?? ""}
              onChange={(e) => setPositionId(e.target.value || null)}
              className={selectCls}
            >
              <option value="">Unassigned</option>
              {positions
                .filter((p) => !p.parent_id)
                .map((area) => {
                  const subs = positions.filter((s) => s.parent_id === area.id);
                  if (subs.length === 0) {
                    return (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    );
                  }
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

          <Field label="Note (team member sees this)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. open up, training Jess"
              className={inputCls}
            />
          </Field>

          <div className="flex items-center justify-between gap-2 pt-2">
            <div>
              {isEdit && onDelete && (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDelete}
                      className="inline-flex items-center gap-1 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                )
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEdit ? "Save" : "Add shift"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const selectCls = inputCls;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
