import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useEmployees } from "@/hooks/useEmployees";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import { EXIT_REASONS, useOffboardingActions } from "@/hooks/useOffboarding";
import type { ExitReason } from "@/types";

const selectCls =
  "h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Starting an exit does four irreversible-ish things at once, so the dialog says
 * all four before you press the button: the shifts that open up, when access
 * ends, that a checklist appears, and whether they'll be asked for feedback.
 */
export function StartExitDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const { data: employees = [] } = useEmployees();
  const { data: venues = [] } = useRestaurants();
  const { isSuperadmin, assignedRestaurants } = usePermissions();
  const { start } = useOffboardingActions();

  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState<ExitReason>("resigned");
  const [lastShift, setLastShift] = useState(format(new Date(), "yyyy-MM-dd"));
  const [rehire, setRehire] = useState(true);
  const [notes, setNotes] = useState("");
  const [survey, setSurvey] = useState(true);

  // Only people this manager actually looks after, so the list is short enough
  // to scan and there is no chance of exiting someone else's team member.
  const candidates = useMemo(
    () =>
      employees.filter(
        (e) =>
          !e.access_revoked_at &&
          (isSuperadmin ||
            (e.home_restaurant_id && assignedRestaurants.includes(e.home_restaurant_id)))
      ),
    [employees, isSuperadmin, assignedRestaurants]
  );

  const chosen = candidates.find((e) => e.id === employeeId);
  const venueName = venues.find((v) => v.id === chosen?.home_restaurant_id)?.name;

  const handleStart = async () => {
    if (!employeeId) return toast.error("Pick who is leaving");
    if (!lastShift) return toast.error("Set their last shift date");
    try {
      const res = await start.mutateAsync({
        employeeId,
        reason,
        lastShiftDate: lastShift,
        eligibleForRehire: rehire,
        privateNotes: notes,
        exitSurvey: survey,
      });
      toast.success(
        res.shiftsUnassigned
          ? `Exit started · ${res.shiftsUnassigned} shift${
              res.shiftsUnassigned === 1 ? "" : "s"
            } now open for you to fill`
          : "Exit started"
      );
      onStarted(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the exit");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start an exit</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="exit-who">Who is leaving</Label>
            <select
              id="exit-who"
              className={selectCls}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Pick a team member</option>
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
            {chosen && venueName && (
              <p className="text-xs text-muted-foreground">Home venue: {venueName}</p>
            )}
            {candidates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nobody to show. Exits work off someone's home venue, so set one under Settings →
                Team first.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exit-reason">Reason</Label>
            <select
              id="exit-reason"
              className={selectCls}
              value={reason}
              onChange={(e) => setReason(e.target.value as ExitReason)}
            >
              {EXIT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exit-last">Last shift</Label>
            <Input
              id="exit-last"
              type="date"
              value={lastShift}
              onChange={(e) => setLastShift(e.target.value)}
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={rehire}
              onCheckedChange={(c) => setRehire(c === true)}
            />
            <span className="text-foreground">
              Would hire them again
              <span className="block text-[13px] text-muted-foreground">
                Only people marked this way can be re-invited from Alumni.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={survey}
              onCheckedChange={(c) => setSurvey(c === true)}
            />
            <span className="text-foreground">
              Ask them three exit questions
              <span className="block text-[13px] text-muted-foreground">
                Shown next time they open ORBIT, before their access ends. Not anonymous.
              </span>
            </span>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="exit-notes">Private notes (optional)</Label>
            <Textarea
              id="exit-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the brand owner should know."
            />
            <p className="text-xs text-muted-foreground">
              Only the brand owner and a superadmin can read these — not other venue managers,
              and not you once you've saved them.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-soft p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="space-y-1 text-[13px] text-warning">
              <p className="font-medium">What happens when you save</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>Every shift after {format(new Date(lastShift), "d MMM")} opens up for you to fill</li>
                <li>Their ORBIT access ends at the end of that day</li>
                <li>The exit checklist appears for you to work through</li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleStart} disabled={start.isPending}>
            {start.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Start exit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
