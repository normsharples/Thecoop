import { useEffect, useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { useAvailability } from "@/hooks/useAvailability";
import { formatTime } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { AvailabilityRule } from "@/types";

const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const inputCls =
  "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// Time options in 15-minute steps (matches the roster's granularity).
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let m = 0; m < 24 * 60; m += 15) {
  const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  TIME_OPTIONS.push({ value: v, label: formatTime(v) });
}

export default function AvailabilityEditor({ employeeId }: { employeeId: string }) {
  const { rules, exceptions, setRule, addException, removeException } = useAvailability(employeeId);

  // Effective date range (shared across the weekly pattern).
  const [effFrom, setEffFrom] = useState("");
  const [effUntil, setEffUntil] = useState("");
  useEffect(() => {
    const r = rules[0];
    setEffFrom(r?.effective_from ?? "");
    setEffUntil(r?.effective_until ?? "");
  }, [rules]);

  const save = async (patch: {
    day_of_week: number;
    is_available: boolean;
    start_time?: string | null;
    end_time?: string | null;
  }) => {
    try {
      await setRule({
        ...patch,
        effective_from: effFrom || null,
        effective_until: effUntil || null,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  // Re-stamp the effective range onto every existing rule.
  const applyRange = async (from: string, until: string) => {
    try {
      for (const r of rules) {
        await setRule({
          day_of_week: r.day_of_week,
          is_available: r.is_available,
          start_time: r.start_time,
          end_time: r.end_time,
          effective_from: from || null,
          effective_until: until || null,
        });
      }
      toast.success("Effective dates updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const addOff = async () => {
    if (!date) return toast.error("Pick a date");
    try {
      await addException({ date, is_available: false, reason: reason.trim() || null });
      setDate("");
      setReason("");
      toast.success("Marked unavailable");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };
  const upcoming = exceptions.filter((e) => !e.is_available);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Weekly availability</h2>
        <p className="text-sm text-muted-foreground">
          Set which days (and hours) you can work. Your manager sees this when building the roster.
        </p>

        {/* Effective range */}
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Effective from</label>
            <input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Until</label>
            <input type="date" value={effUntil} onChange={(e) => setEffUntil(e.target.value)} className={inputCls} />
          </div>
          <button
            onClick={() => applyRange(effFrom, effUntil)}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-accent"
          >
            Apply dates
          </button>
          <p className="text-xs text-muted-foreground">Leave blank for always.</p>
        </div>

        <div className="mt-3 space-y-2">
          {FULL_DAYS.map((label, dow) => (
            <DayRow
              key={dow}
              label={label}
              rule={rules.find((r) => r.day_of_week === dow)}
              onSave={save}
              dow={dow}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground">Specific days off</h2>
        <p className="text-sm text-muted-foreground">Mark one-off dates you can't work.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1 flex-1 min-w-[140px]">
            <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. appointment"
              className={cn(inputCls, "w-full")}
            />
          </div>
          <button
            onClick={addOff}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>

        {upcoming.length > 0 && (
          <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {upcoming.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="text-sm text-foreground">
                  {format(parseISO(e.date), "EEE d MMM yyyy")}
                  {e.reason && <span className="text-muted-foreground"> — {e.reason}</span>}
                </div>
                <button
                  onClick={() => removeException(e.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DayRow({
  label,
  dow,
  rule,
  onSave,
}: {
  label: string;
  dow: number;
  rule?: AvailabilityRule;
  onSave: (p: {
    day_of_week: number;
    is_available: boolean;
    start_time?: string | null;
    end_time?: string | null;
  }) => void;
}) {
  const available = rule ? rule.is_available : true;
  const [from, setFrom] = useState(rule?.start_time?.slice(0, 5) ?? "");
  const [to, setTo] = useState(rule?.end_time?.slice(0, 5) ?? "");

  useEffect(() => {
    setFrom(rule?.start_time?.slice(0, 5) ?? "");
    setTo(rule?.end_time?.slice(0, 5) ?? "");
  }, [rule?.start_time, rule?.end_time]);

  const saveWindow = (nextFrom: string, nextTo: string) =>
    onSave({
      day_of_week: dow,
      is_available: true,
      start_time: nextFrom || null,
      end_time: nextTo || null,
    });

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <button
          onClick={() =>
            onSave({ day_of_week: dow, is_available: !available, start_time: null, end_time: null })
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
            available ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
          )}
        >
          {available ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          {available ? "Available" : "Unavailable"}
        </button>
      </div>
      {available && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Hours:</span>
          <select
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              saveWindow(e.target.value, to);
            }}
            className={cn(inputCls, "h-8")}
          >
            <option value="">All day</option>
            {TIME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span>to</span>
          <select
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              saveWindow(from, e.target.value);
            }}
            className={cn(inputCls, "h-8")}
          >
            <option value="">All day</option>
            {TIME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
