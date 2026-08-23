import { ArrowLeftRight, Trash2, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { useSwaps, type SwapRow, type SwapShift } from "@/hooks/useSwaps";
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

export default function SwapsPanel({ employeeId }: { employeeId: string }) {
  const { myShifts, mySwaps, openSwaps, offeredShiftIds, offer, claim, cancel } =
    useSwaps(employeeId);

  const wrap = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const err = e as { message?: string; details?: string; hint?: string } | null;
      const msg =
        err?.message || err?.details || err?.hint || (typeof e === "string" ? e : "");
      toast.error(msg || "Something went wrong");
    }
  };

  const offerable = myShifts.filter((s) => !offeredShiftIds.has(s.id));

  return (
    <div className="space-y-6">
      {/* Open shifts to pick up */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Shifts up for swap</h2>
        {openSwaps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card py-6 text-center text-sm text-muted-foreground">
            Nothing available to pick up right now.
          </p>
        ) : (
          <div className="space-y-2">
            {openSwaps.map((sw: SwapRow) => (
              <div key={sw.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{shiftLine(sw.shift)}</div>
                  <div className="text-xs text-muted-foreground">
                    A teammate's shift{sw.note ? ` · ${sw.note}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => wrap(() => claim(sw.id), "Requested — pending manager approval")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Check className="h-3.5 w-3.5" /> Pick up
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Offer one of my shifts */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Offer a shift for swap</h2>
        {offerable.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card py-6 text-center text-sm text-muted-foreground">
            No upcoming shifts to offer.
          </p>
        ) : (
          <div className="space-y-2">
            {offerable.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="truncate text-sm text-foreground">{shiftLine(s)}</div>
                <button
                  onClick={() => wrap(() => offer({ shiftId: s.id }), "Offered for swap")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" /> Offer
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* My swap requests */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Your swap requests</h2>
        {mySwaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No swap requests yet.</p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {mySwaps.map((sw) => {
              const mine = sw.offered_by === employeeId;
              return (
                <div key={sw.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{shiftLine(sw.shift)}</div>
                    <div className="text-xs text-muted-foreground">
                      {mine ? "You offered this" : "You picked this up"}
                      {sw.status === "claimed" ? " · awaiting approval" : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLES[sw.status])}>
                      {sw.status}
                    </span>
                    {mine && (sw.status === "offered" || sw.status === "claimed") && (
                      <button
                        onClick={() => wrap(() => cancel(sw.id), "Swap cancelled")}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Cancel"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
