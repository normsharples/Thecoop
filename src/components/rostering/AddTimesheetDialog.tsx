import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useEmployees } from "@/hooks/useEmployees";

interface Store {
  id: string;
  name: string;
}

/** Build a venue-local wall time into an ISO timestamp on the given date. */
function isoOn(workDate: string, time: string, afterIso?: string | null) {
  if (!time) return null;
  let d = new Date(`${workDate}T${time}:00`);
  // An end/break time at or before the start rolls over midnight.
  if (afterIso && d.getTime() <= new Date(afterIso).getTime()) {
    d = new Date(d.getTime() + 24 * 3600 * 1000);
  }
  return d.toISOString();
}

export default function AddTimesheetDialog({
  open,
  onOpenChange,
  stores,
  defaultStoreId,
  defaultDate,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stores: Store[];
  defaultStoreId?: string;
  defaultDate: string;
  onCreate: (p: {
    restaurant_id: string;
    employee_id: string;
    work_date: string;
    clock_in: string;
    clock_out: string;
    break_start?: string | null;
    break_end?: string | null;
  }) => Promise<unknown>;
}) {
  const { data: employees = [] } = useEmployees();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    restaurant_id: defaultStoreId ?? stores[0]?.id ?? "",
    employee_id: "",
    work_date: defaultDate,
    clock_in: "09:00",
    clock_out: "17:00",
    break_start: "",
    break_end: "",
  });

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    if (!f.restaurant_id || !f.employee_id) {
      toast.error("Pick a store and a team member");
      return;
    }
    const clock_in = isoOn(f.work_date, f.clock_in);
    const clock_out = isoOn(f.work_date, f.clock_out, clock_in);
    if (!clock_in || !clock_out) {
      toast.error("Start and finish times are required");
      return;
    }
    if (Boolean(f.break_start) !== Boolean(f.break_end)) {
      toast.error("Enter both break start and break end, or neither");
      return;
    }

    setBusy(true);
    try {
      await onCreate({
        restaurant_id: f.restaurant_id,
        employee_id: f.employee_id,
        work_date: f.work_date,
        clock_in,
        clock_out,
        break_start: isoOn(f.work_date, f.break_start, clock_in),
        break_end: isoOn(f.work_date, f.break_end, clock_in),
      });
      toast.success("Timesheet added");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Couldn't add timesheet");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add timesheet</DialogTitle>
          <DialogDescription>
            A manual entry, graded against the roster like any other punch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {stores.length > 1 && (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Store</label>
              <select className={field} value={f.restaurant_id} onChange={set("restaurant_id")}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Team member</label>
            <select className={field} value={f.employee_id} onChange={set("employee_id")}>
              <option value="">Select…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Date</label>
            <input type="date" className={field} value={f.work_date} onChange={set("work_date")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Start</label>
              <input type="time" className={field} value={f.clock_in} onChange={set("clock_in")} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Finish</label>
              <input type="time" className={field} value={f.clock_out} onChange={set("clock_out")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Break start</label>
              <input
                type="time"
                className={field}
                value={f.break_start}
                onChange={set("break_start")}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Break end</label>
              <input type="time" className={field} value={f.break_end} onChange={set("break_end")} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add timesheet
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
