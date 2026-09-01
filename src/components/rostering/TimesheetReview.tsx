import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, addDays } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Pencil,
  AlertTriangle,
  Loader2,
  MonitorSmartphone,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useTimesheets, type TimesheetRow } from "@/hooks/useTimesheets";
import { usePublicHolidays, useAwardConfig, usePayrollConfig } from "@/hooks/useAward";
import {
  aggregateWeek,
  juniorPercent,
  computeGross,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
} from "@/lib/award";
import type { EmployeeWeekAward, AwardConfig } from "@/lib/award";

interface EmpMeta {
  name: string;
  colour: string | null;
  dob: string | null;
  employment: string | null;
  pay_type: string | null;
  award_level: string | null;
  base_pay_rate: number | null;
  salary_annual: number | null;
}
import type { TimeEntry } from "@/types";
import { mondayOf, toISODate, weekDates, DAY_LABELS } from "@/lib/roster";
import { cn } from "@/lib/utils";

const STATUS: Record<string, [string, string]> = {
  pending: ["Open", "bg-blue-500/15 text-blue-600"],
  auto_approved: ["Auto", "bg-success/15 text-success"],
  flagged: ["Flagged", "bg-warning/15 text-warning"],
  approved: ["Approved", "bg-success/15 text-success"],
  rejected: ["Rejected", "bg-destructive/15 text-destructive"],
};

function hm(iso?: string | null) {
  return iso ? format(parseISO(iso), "HH:mm") : "";
}
function hmToIso(workDate: string, time: string, afterIso?: string) {
  if (!time) return null;
  let d = new Date(`${workDate}T${time}:00`);
  // Overnight: an end time earlier than the start rolls to the next day.
  if (afterIso && d.getTime() <= new Date(afterIso).getTime()) {
    d = new Date(d.getTime() + 24 * 3600 * 1000);
  }
  return d.toISOString();
}

export default function TimesheetReview() {
  const { selectedRestaurantIds } = useSelectedRestaurant();
  const [weekStart, setWeekStart] = useState(() => toISODate(mondayOf(new Date())));
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [view, setView] = useState<"entries" | "award">("entries");

  const wkDays = weekDates(weekStart);
  const wkFrom = wkDays[0];
  const wkTo = wkDays[6];

  const { data: stores = [] } = useQuery({
    queryKey: ["ts-stores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, state")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string; state: string | null }[];
    },
  });

  const { data: holidays = [] } = usePublicHolidays(wkFrom, wkTo);
  const cfg = useAwardConfig();
  const payroll = usePayrollConfig();

  const storeIds = selectedRestaurantIds.length
    ? selectedRestaurantIds
    : stores.map((s) => s.id);
  const storeName = useMemo(
    () => Object.fromEntries(stores.map((s) => [s.id, s.name])),
    [stores]
  );
  const multiStore = storeIds.length > 1;

  const { entries, isLoading, update, review } = useTimesheets(storeIds, weekStart);

  // Award classification (MA000003) for the "Award" view.
  const stateByStore = useMemo(
    () => Object.fromEntries(stores.map((s) => [s.id, s.state ?? ""])),
    [stores]
  );
  const holidaysByState = useMemo(() => {
    const m = new Map<string, Set<string>>();
    holidays.forEach((h) => {
      if (!m.has(h.state)) m.set(h.state, new Set());
      m.get(h.state)!.add(h.date);
    });
    return m;
  }, [holidays]);
  const EMPTY = useMemo(() => new Set<string>(), []);
  const award = useMemo(
    () =>
      aggregateWeek(
        entries as TimeEntry[],
        (e) => holidaysByState.get(stateByStore[e.restaurant_id] ?? "") ?? EMPTY,
        cfg
      ),
    [entries, holidaysByState, stateByStore, EMPTY, cfg]
  );
  const empMeta = useMemo(() => {
    const m = new Map<string, EmpMeta>();
    entries.forEach((e) => {
      if (!m.has(e.employee_id)) {
        m.set(e.employee_id, {
          name: e.employee?.full_name ?? "Unknown",
          colour: e.employee?.display_colour ?? null,
          dob: e.employee?.date_of_birth ?? null,
          employment: e.employee?.employment_type ?? null,
          pay_type: e.employee?.pay_type ?? null,
          award_level: e.employee?.award_level ?? null,
          base_pay_rate: e.employee?.base_pay_rate ?? null,
          salary_annual: e.employee?.salary_annual ?? null,
        });
      }
    });
    return m;
  }, [entries]);

  const needsAttention = (e: TimesheetRow) =>
    e.approval_status === "flagged" ||
    (e.source === "auto" && e.approval_status === "pending");
  const shown = flaggedOnly
    ? entries.filter(needsAttention)
    : entries;
  const flaggedCount = entries.filter(needsAttention).length;
  const totalMins = entries
    .filter((e) => e.approval_status !== "rejected")
    .reduce((s, e) => s + (e.worked_minutes ?? 0), 0);

  const byDay = useMemo(() => {
    const days = weekDates(weekStart);
    return days.map((d) => ({ date: d, rows: shown.filter((e) => e.work_date === d) }));
  }, [shown, weekStart]);

  const shift = (n: number) =>
    setWeekStart(toISODate(addDays(parseISO(weekStart), n)));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-7)} className="rounded-lg p-2 hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[190px] text-center text-sm font-medium text-foreground">
            {format(parseISO(weekStart), "d MMM")} –{" "}
            {format(addDays(parseISO(weekStart), 6), "d MMM yyyy")}
          </span>
          <button onClick={() => shift(7)} className="rounded-lg p-2 hover:bg-accent">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekStart(toISODate(mondayOf(new Date())))}
            className="ml-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            This week
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            <button
              onClick={() => setView("entries")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium",
                view === "entries" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
            >
              Entries
            </button>
            <button
              onClick={() => setView("award")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium",
                view === "award" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
            >
              Award
            </button>
          </div>
          {view === "entries" && (
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Flagged only
            </label>
          )}
          <Link
            to="/kiosk"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <MonitorSmartphone className="h-4 w-4" /> Launch kiosk
          </Link>
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        <Stat label="Punched hours" value={`${(totalMins / 60).toFixed(1)}h`} />
        <Stat label="Entries" value={String(entries.length)} />
        <Stat
          label="Need review"
          value={String(flaggedCount)}
          tone={flaggedCount ? "warn" : undefined}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          No punches this week. They'll appear here as staff clock in and out.
        </p>
      ) : view === "award" ? (
        <AwardTable
          award={award}
          meta={empMeta}
          weekStart={weekStart}
          cfg={cfg}
          superRate={payroll.super_rate}
        />
      ) : (
        <div className="space-y-4">
          {byDay.map(
            ({ date, rows }, i) =>
              rows.length > 0 && (
                <div key={date}>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">
                    {DAY_LABELS[i]} {format(parseISO(date), "d MMM")}
                  </h3>
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                    {rows.map((e) => (
                      <EntryRow
                        key={e.id}
                        entry={e}
                        storeLabel={multiStore ? storeName[e.restaurant_id] : undefined}
                        onSave={update}
                        onReview={review}
                      />
                    ))}
                  </div>
                </div>
              )
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-2",
        tone === "warn" ? "border-warning/40 bg-warning/50" : "border-border bg-card"
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold", tone === "warn" ? "text-warning" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  storeLabel,
  onSave,
  onReview,
}: {
  entry: TimesheetRow;
  storeLabel?: string;
  onSave: (p: { id: string; patch: Partial<TimeEntry> }) => Promise<unknown>;
  onReview: (p: { id: string; approve: boolean }) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    clock_in: hm(entry.clock_in),
    break_start: hm(entry.break_start),
    break_end: hm(entry.break_end),
    clock_out: hm(entry.clock_out),
  });

  // A roster-generated row is scheduled time, not worked time — say so plainly
  // rather than showing it as an ordinary open punch.
  const isNoClockIn = entry.source === "auto" && entry.approval_status === "pending";
  const [label, cls] = isNoClockIn
    ? ["No clock-in", "bg-warning/15 text-warning"]
    : STATUS[entry.approval_status] ?? ["", ""];
  const worked = entry.worked_minutes != null ? (entry.worked_minutes / 60).toFixed(2) + "h" : "—";

  const save = async () => {
    setBusy(true);
    try {
      const clock_in = hmToIso(entry.work_date, f.clock_in) ?? entry.clock_in;
      const patch: Partial<TimeEntry> = {
        clock_in,
        break_start: hmToIso(entry.work_date, f.break_start, clock_in),
        break_end: hmToIso(entry.work_date, f.break_end, clock_in),
        clock_out: hmToIso(entry.work_date, f.clock_out, clock_in),
      };
      await onSave({ id: entry.id, patch });
      toast.success("Punch updated");
      setEditing(false);
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const doReview = async (approve: boolean) => {
    setBusy(true);
    try {
      await onReview({ id: entry.id, approve });
      toast.success(approve ? "Approved" : "Rejected");
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.employee?.display_colour ?? "#94a3b8" }}
            />
            <span className="truncate text-sm font-medium text-foreground">
              {entry.employee?.full_name ?? "Unknown"}
            </span>
            {storeLabel && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {storeLabel}
              </span>
            )}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{label}</span>
          </div>
          {!editing && (
            <div className="mt-1 pl-4 text-xs text-muted-foreground">
              {hm(entry.clock_in) || "—"}
              {entry.break_start && ` · break ${hm(entry.break_start)}–${hm(entry.break_end) || "…"}`}
              {" – "}
              {hm(entry.clock_out) || "open"} · <span className="font-medium text-foreground">{worked}</span>
              {entry.source === "app" && " · phone"}
            </div>
          )}
          {entry.flag_reason && !editing && (
            <div className="mt-1 flex items-center gap-1 pl-4 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> {entry.flag_reason}
            </div>
          )}
        </div>

        {!editing ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              title="Edit times"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {entry.clock_out && entry.approval_status !== "approved" && (
              <button
                onClick={() => doReview(true)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
            )}
            {entry.clock_out && entry.approval_status !== "rejected" && (
              <button
                onClick={() => doReview(false)}
                disabled={busy}
                className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Reject"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
              Cancel
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-3 pl-4 sm:grid-cols-4">
          <TimeField label="Clock in" value={f.clock_in} onChange={(v) => setF({ ...f, clock_in: v })} />
          <TimeField label="Break start" value={f.break_start} onChange={(v) => setF({ ...f, break_start: v })} />
          <TimeField label="Break end" value={f.break_end} onChange={(v) => setF({ ...f, break_end: v })} />
          <TimeField label="Clock out" value={f.clock_out} onChange={(v) => setF({ ...f, clock_out: v })} />
        </div>
      )}
    </div>
  );
}

function AwardTable({
  award,
  meta,
  weekStart,
  cfg,
  superRate,
}: {
  award: Map<string, EmployeeWeekAward>;
  meta: Map<string, EmpMeta>;
  weekStart: string;
  cfg: AwardConfig;
  superRate: number;
}) {
  const rows = Array.from(award.values()).sort((a, b) =>
    (meta.get(a.employeeId)?.name ?? "").localeCompare(meta.get(b.employeeId)?.name ?? "")
  );
  const hrs = (min: number) => (min > 0 ? (min / 60).toFixed(2) : "·");
  const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
        No completed punches to classify yet.
      </p>
    );
  }

  const computed = rows.map((r) => {
    const m = meta.get(r.employeeId);
    const gross = computeGross(
      r,
      {
        award_level: m?.award_level ?? null,
        date_of_birth: m?.dob ?? null,
        base_pay_rate: m?.base_pay_rate ?? null,
        employment_type: m?.employment ?? null,
        pay_type: m?.pay_type ?? null,
        salary_annual: m?.salary_annual ?? null,
      },
      superRate,
      weekStart,
      cfg
    );
    return { r, m, gross };
  });

  const totalGross = computed.reduce((s, c) => s + (c.gross.ok ? c.gross.gross : 0), 0);
  const totalSuper = computed.reduce((s, c) => s + (c.gross.ok ? c.gross.superAmount : 0), 0);
  const totalHours = computed.reduce((s, c) => s + c.r.totalMin, 0);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">Team member</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Base $/hr</th>
              {CATEGORY_ORDER.map((c) => (
                <th key={c} className="px-3 py-2 text-right font-medium">
                  {CATEGORY_LABELS[c]}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">OT</th>
              <th className="px-3 py-2 text-right font-medium">Total h</th>
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 text-right font-medium">Super</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {computed.map(({ r, m, gross }) => {
              const jp = juniorPercent(m?.dob, weekStart, cfg);
              return (
                <tr key={r.employeeId} className="hover:bg-muted/10">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: m?.colour ?? "#94a3b8" }}
                      />
                      <span className="font-medium text-foreground">{m?.name ?? "Unknown"}</span>
                      {gross.warnings.length > 0 && (
                        <span title={gross.warnings.join(" · ")}>
                          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">
                    {gross.salaried ? "salary" : m?.employment ? m.employment.replace("_", "-") : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {gross.salaried ? (
                      "—"
                    ) : gross.base != null ? (
                      <>
                        {money(gross.base)}
                        {jp != null && jp < 100 && (
                          <span className="ml-1 text-[11px] text-muted-foreground">{jp}%</span>
                        )}
                      </>
                    ) : (
                      <span className="text-warning">set rate</span>
                    )}
                  </td>
                  {CATEGORY_ORDER.map((c) => (
                    <td key={c} className="px-3 py-2 text-right tabular-nums text-foreground">
                      {hrs(r.categories[c])}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {hrs(r.otMin)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-foreground">
                    {hrs(r.totalMin)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                    {gross.ok ? money(gross.gross) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {gross.ok ? money(gross.superAmount) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/20 font-semibold">
              <td className="px-3 py-2" colSpan={3 + CATEGORY_ORDER.length + 1}>
                Week total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{(totalHours / 60).toFixed(2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totalGross)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totalSuper)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Gross computed under {cfg.code}: base × penalty % per category (casual rates include the 25%
        loading), super at {superRate}% of ordinary-time earnings. Overtime ({cfg.ot_daily_hours}h/day,{" "}
        {cfg.ot_weekly_hours}h/week) is paid at OT rates, drawn from the lowest-penalty hours first.
        Estimate only — validate a week against Deputy before using it to pay.
      </p>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
