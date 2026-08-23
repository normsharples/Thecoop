import { Check, X, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { useLeaveApprovals } from "@/hooks/useLeave";
import { cn } from "@/lib/utils";
import type { LeaveStatus } from "@/types";

const STATUS_STYLES: Record<LeaveStatus, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  declined: "bg-destructive/15 text-destructive",
};

export default function LeaveApprovals() {
  const { requests, isLoading, review } = useLeaveApprovals();

  const act = async (id: string, status: "approved" | "declined") => {
    try {
      await review({ id, status });
      toast.success(status === "approved" ? "Leave approved" : "Leave declined");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          Pending {pending.length > 0 && <span className="text-muted-foreground">({pending.length})</span>}
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">
            No leave requests waiting.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {r.employee?.full_name ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(parseISO(r.start_date), "d MMM")} – {format(parseISO(r.end_date), "d MMM yyyy")} ·{" "}
                    <span className="capitalize">{r.leave_type}</span>
                    {r.note ? ` · ${r.note}` : ""}
                  </div>
                  {r.notify_user?.full_name && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Sent to <span className="text-foreground">{r.notify_user.full_name}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => act(r.id, "approved")}
                    className="inline-flex items-center gap-1 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:bg-success/90"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => act(r.id, "declined")}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    <X className="h-3.5 w-3.5" /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {decided.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Decided</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {decided.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{r.employee?.full_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(parseISO(r.start_date), "d MMM")} – {format(parseISO(r.end_date), "d MMM yyyy")} ·{" "}
                    <span className="capitalize">{r.leave_type}</span>
                  </div>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLES[r.status])}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
