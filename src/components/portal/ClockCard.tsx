import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { Clock, Coffee, Play, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMyClock } from "@/hooks/useTimeClock";
import { formatTime } from "@/lib/roster";
import type { Profile, TimeEntry } from "@/types";
import { cn } from "@/lib/utils";

const STATE_LABEL = {
  out: "Not clocked in",
  in: "On the clock",
  on_break: "On break",
  done: "Shift complete",
} as const;

function fmt(ts?: string | null) {
  return ts ? format(parseISO(ts), "h:mm a") : "—";
}

/** Live elapsed since a start ISO, mm or h:mm. */
function elapsed(startISO: string, breaks: number) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(startISO).getTime()) / 60000) - breaks);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function breakMinutes(e?: TimeEntry | null) {
  if (!e?.break_start || !e?.break_end) return 0;
  return Math.round((new Date(e.break_end).getTime() - new Date(e.break_start).getTime()) / 60000);
}

export default function ClockCard({ profile }: { profile: Profile }) {
  const { openEntry, todayShift, todayEntries, state, clockIn, startBreak, endBreak, clockOut, busy } =
    useMyClock(profile);
  const [, setTick] = useState(0);

  // Re-render each minute so the live timer moves.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const err = e as { message?: string } | null;
      toast.error(err?.message || "Couldn't record that — try again");
    }
  };

  const completedToday = todayEntries.filter((e) => e.clock_out);
  const totalToday = completedToday.reduce((s, e) => s + (e.worked_minutes ?? 0), 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Time clock</h2>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            state === "in" && "bg-success/15 text-success",
            state === "on_break" && "bg-warning/15 text-warning",
            (state === "out" || state === "done") && "bg-muted text-muted-foreground"
          )}
        >
          {STATE_LABEL[state]}
        </span>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {todayShift
          ? `Today's shift: ${formatTime(todayShift.start_time)}–${formatTime(todayShift.end_time)}`
          : "No shift rostered today — you can still clock in."}
      </p>

      {openEntry && (
        <div className="mb-4 rounded-xl bg-muted/40 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Clocked in</span>
            <span className="font-medium text-foreground">{fmt(openEntry.clock_in)}</span>
          </div>
          {openEntry.break_start && (
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">Break</span>
              <span className="font-medium text-foreground">
                {fmt(openEntry.break_start)}
                {openEntry.break_end ? `–${fmt(openEntry.break_end)}` : " · ongoing"}
              </span>
            </div>
          )}
          <div className="mt-1 flex justify-between">
            <span className="text-muted-foreground">Worked so far</span>
            <span className="font-semibold text-foreground">
              {elapsed(openEntry.clock_in, breakMinutes(openEntry))}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {state === "out" || state === "done" ? (
          <ClockBtn onClick={() => run(clockIn, "Clocked in")} disabled={busy} variant="primary">
            <Play className="h-4 w-4" /> Clock in
          </ClockBtn>
        ) : null}

        {state === "in" && (
          <>
            <ClockBtn onClick={() => run(startBreak, "Break started")} disabled={busy}>
              <Coffee className="h-4 w-4" /> Start break
            </ClockBtn>
            <ClockBtn onClick={() => run(clockOut, "Clocked out")} disabled={busy} variant="danger">
              <Square className="h-4 w-4" /> Clock out
            </ClockBtn>
          </>
        )}

        {state === "on_break" && (
          <ClockBtn onClick={() => run(endBreak, "Back from break")} disabled={busy} variant="primary">
            <Play className="h-4 w-4" /> End break
          </ClockBtn>
        )}

        {busy && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" />}
      </div>

      {completedToday.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Today: {(totalToday / 60).toFixed(2)}h across {completedToday.length} punch
          {completedToday.length > 1 ? "es" : ""}.
        </p>
      )}
    </div>
  );
}

function ClockBtn({
  children,
  onClick,
  disabled,
  variant = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "danger" | "neutral";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        variant === "neutral" && "border border-border text-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
