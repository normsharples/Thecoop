import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { useMyLeave, useLeaveApprovers } from "@/hooks/useLeave";
import { cn } from "@/lib/utils";
import type { LeaveType, LeaveStatus } from "@/types";

const TYPE_LABELS: Record<LeaveType, string> = {
  annual: "Annual",
  sick: "Sick",
  unpaid: "Unpaid",
  other: "Other",
};

const STATUS_STYLES: Record<LeaveStatus, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  declined: "bg-destructive/15 text-destructive",
};

export default function LeavePanel({ employeeId }: { employeeId: string }) {
  const { requests, isLoading, create, cancel } = useMyLeave(employeeId);
  const { data: approvers = [] } = useLeaveApprovers();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [type, setType] = useState<LeaveType>("annual");
  const [note, setNote] = useState("");
  const [notifyId, setNotifyId] = useState("");
  const [saving, setSaving] = useState(false);

  // One approver? Pick them automatically rather than making it a decision.
  useEffect(() => {
    if (!notifyId && approvers.length === 1) setNotifyId(approvers[0].id);
  }, [approvers, notifyId]);

  const submit = async () => {
    if (!start || !end) return toast.error("Pick start and end dates");
    if (end < start) return toast.error("End date is before start date");
    if (!notifyId) return toast.error("Choose who to send this request to");
    setSaving(true);
    try {
      await create({
        start_date: start,
        end_date: end,
        leave_type: type,
        note: note.trim() || null,
        notify_user_id: notifyId,
      });
      setStart("");
      setEnd("");
      setNote("");
      const sentTo = approvers.find((a) => a.id === notifyId)?.full_name;
      toast.success(sentTo ? `Leave requested — sent to ${sentTo}` : "Leave requested");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to request leave");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold text-foreground">Request leave</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as LeaveType)} className={inputCls}>
              <option value="annual">Annual</option>
              <option value="sick">Sick</option>
              <option value="unpaid">Unpaid</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">
              Send this request to <span className="text-destructive">*</span>
            </label>
            <select
              value={notifyId}
              onChange={(e) => setNotifyId(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose someone…</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              They'll be notified straight away.
            </p>
          </div>
        </div>
        <button
          onClick={submit}
          disabled={saving}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Request
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Your requests</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave requests yet.</p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {format(parseISO(r.start_date), "d MMM")} – {format(parseISO(r.end_date), "d MMM yyyy")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {TYPE_LABELS[r.leave_type]}
                    {r.note ? ` · ${r.note}` : ""}
                    {r.notify_user_id
                      ? ` · sent to ${
                          approvers.find((a) => a.id === r.notify_user_id)?.full_name ?? "your manager"
                        }`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLES[r.status])}>
                    {r.status}
                  </span>
                  {r.status === "pending" && (
                    <button
                      onClick={() => cancel(r.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Cancel request"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
