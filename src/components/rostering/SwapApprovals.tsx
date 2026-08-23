import { Check, X, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { useSwapApprovals, type SwapRow, type SwapShift } from "@/hooks/useSwaps";
import { formatTime } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { ShiftSwapStatus } from "@/types";

const STATUS_STYLES: Record<ShiftSwapStatus, string> = {
  offered: "bg-blue-500/15 text-blue-600",
  claimed: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  declined: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function shiftLine(s?: SwapShift | null) {
  if (!s) return "—";
  return `${format(parseISO(s.date), "EEE d MMM")} · ${formatTime(s.start_time)}–${formatTime(
    s.end_time
  )}${s.restaurant?.name ? ` · ${s.restaurant.name}` : ""}${
    s.position?.name ? ` · ${s.position.name}` : ""
  }`;
}

export default function SwapApprovals() {
  const { swaps, isLoading, review } = useSwapApprovals();

  const act = async (swap: SwapRow, approve: boolean) => {
    try {
      await review({ swap, approve });
      toast.success(approve ? "Swap approved — shift reassigned" : "Swap declined");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const pending = swaps.filter((s) => s.status === "claimed");
  const offered = swaps.filter((s) => s.status === "offered");
  const decided = swaps.filter((s) => ["approved", "declined", "cancelled"].includes(s.status));

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
          Awaiting approval {pending.length > 0 && <span className="text-muted-foreground">({pending.length})</span>}
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">
            No swaps waiting on you.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {pending.map((sw) => (
              <div key={sw.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{shiftLine(sw.shift)}</div>
                  <div className="text-xs text-muted-foreground">
                    {sw.offered?.full_name ?? "—"} → {sw.claimed?.full_name ?? "—"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => act(sw, true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-success px-3 py-1.5 text-xs font-medium text-white hover:bg-success/90"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => act(sw, false)}
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

      {offered.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Offered (waiting for a taker)</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {offered.map((sw) => (
              <div key={sw.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{shiftLine(sw.shift)}</div>
                  <div className="text-xs text-muted-foreground">Offered by {sw.offered?.full_name ?? "—"}</div>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLES[sw.status])}>
                  {sw.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Recent</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {decided.slice(0, 20).map((sw) => (
              <div key={sw.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{shiftLine(sw.shift)}</div>
                  <div className="text-xs text-muted-foreground">
                    {sw.offered?.full_name ?? "—"}
                    {sw.claimed?.full_name ? ` → ${sw.claimed.full_name}` : ""}
                  </div>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLES[sw.status])}>
                  {sw.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
