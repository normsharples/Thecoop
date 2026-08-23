import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, AlertTriangle, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useTimesheets } from "@/hooks/useTimesheets";
import { usePublicHolidays, useAwardConfig, usePayrollConfig } from "@/hooks/useAward";
import {
  aggregateWeek,
  computeGross,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
} from "@/lib/award";
import { EARNINGS_RATE, splitName, toCsv, downloadText } from "@/lib/payrun";
import type { TimeEntry } from "@/types";
import { mondayOf, toISODate, weekDates } from "@/lib/roster";
import { cn } from "@/lib/utils";

interface Meta {
  name: string;
  employment: string | null;
  pay_type: string | null;
  award_level: string | null;
  base_pay_rate: number | null;
  salary_annual: number | null;
  dob: string | null;
}

const PAYABLE = new Set(["auto_approved", "approved"]);
const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PayRun() {
  const { selectedRestaurantIds } = useSelectedRestaurant();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => toISODate(mondayOf(new Date())));

  const wkDays = weekDates(weekStart);
  const wkFrom = wkDays[0];
  const wkTo = wkDays[6];

  const { data: stores = [] } = useQuery({
    queryKey: ["payrun-stores"],
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

  const storeIds = selectedRestaurantIds.length ? selectedRestaurantIds : stores.map((s) => s.id);
  const scopeLabel = selectedRestaurantIds.length
    ? stores.filter((s) => storeIds.includes(s.id)).map((s) => s.name).join(", ")
    : "All stores";

  const { entries, isLoading } = useTimesheets(storeIds, weekStart);
  const { data: holidays = [] } = usePublicHolidays(wkFrom, wkTo);
  const cfg = useAwardConfig();
  const payroll = usePayrollConfig();

  // Deputy actuals for the same week (reconciliation).
  const { data: labour = [] } = useQuery({
    queryKey: ["payrun-labour", storeIds, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_daily")
        .select("restaurant_id, date, total_hours, total_cost")
        .in("restaurant_id", storeIds)
        .gte("date", wkFrom)
        .lte("date", wkTo);
      if (error) throw error;
      return (data ?? []) as { total_hours: number; total_cost: number }[];
    },
    enabled: storeIds.length > 0,
  });

  const { data: recent = [] } = useQuery({
    queryKey: ["pay-runs-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_runs")
        .select("*")
        .order("exported_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as PayRunRow[];
    },
  });

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

  const meta = useMemo(() => {
    const m = new Map<string, Meta>();
    entries.forEach((e) => {
      if (!m.has(e.employee_id)) {
        m.set(e.employee_id, {
          name: e.employee?.full_name ?? "Unknown",
          employment: e.employee?.employment_type ?? null,
          pay_type: e.employee?.pay_type ?? null,
          award_level: e.employee?.award_level ?? null,
          base_pay_rate: e.employee?.base_pay_rate ?? null,
          salary_annual: e.employee?.salary_annual ?? null,
          dob: e.employee?.date_of_birth ?? null,
        });
      }
    });
    return m;
  }, [entries]);

  const payable = entries.filter((e) => e.clock_out && PAYABLE.has(e.approval_status));
  const notPayable = entries.filter(
    (e) => e.clock_out && !PAYABLE.has(e.approval_status) && e.approval_status !== "rejected"
  ).length;

  const award = useMemo(
    () =>
      aggregateWeek(
        payable as TimeEntry[],
        (e) => holidaysByState.get(stateByStore[e.restaurant_id] ?? "") ?? EMPTY,
        cfg
      ),
    [payable, holidaysByState, stateByStore, EMPTY, cfg]
  );

  const computed = useMemo(() => {
    return Array.from(award.values())
      .map((agg) => {
        const m = meta.get(agg.employeeId);
        const gross = computeGross(
          agg,
          {
            award_level: m?.award_level ?? null,
            date_of_birth: m?.dob ?? null,
            base_pay_rate: m?.base_pay_rate ?? null,
            employment_type: m?.employment ?? null,
            pay_type: m?.pay_type ?? null,
            salary_annual: m?.salary_annual ?? null,
          },
          payroll.super_rate,
          weekStart,
          cfg
        );
        return { agg, m, gross };
      })
      .sort((a, b) => (a.m?.name ?? "").localeCompare(b.m?.name ?? ""));
  }, [award, meta, payroll.super_rate, weekStart, cfg]);

  const coopHours = computed.reduce((s, c) => s + c.agg.totalMin / 60, 0);
  const coopGross = computed.reduce((s, c) => s + (c.gross.ok ? c.gross.gross : 0), 0);
  const coopSuper = computed.reduce((s, c) => s + (c.gross.ok ? c.gross.superAmount : 0), 0);
  const depHours = labour.reduce((s, r) => s + (r.total_hours ?? 0), 0);
  const depCost = labour.reduce((s, r) => s + (r.total_cost ?? 0), 0);
  const anyMissingRate = computed.some((c) => !c.gross.ok);

  const record = useMutation({
    mutationFn: async (fmt: "xero_timesheet" | "gross_summary") => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("pay_runs").insert({
        week_start: weekStart,
        store_scope: scopeLabel,
        format: fmt,
        employee_count: computed.length,
        total_hours: Math.round(coopHours * 100) / 100,
        total_gross: Math.round(coopGross * 100) / 100,
        total_super: Math.round(coopSuper * 100) / 100,
        exported_by: u?.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pay-runs-recent"] }),
  });

  const shift = (n: number) => setWeekStart(toISODate(addDays(parseISO(weekStart), n)));

  const exportXero = async () => {
    const rows: (string | number)[][] = [];
    for (const { m, gross } of computed) {
      if (gross.salaried || !gross.ok || !m) continue; // salaried handled in Xero directly
      const { first, last } = splitName(m.name);
      for (const line of gross.lines) {
        if (line.hours <= 0) continue;
        rows.push([first, last, weekStart, line.hours.toFixed(2), EARNINGS_RATE[line.key]]);
      }
    }
    if (rows.length === 0) {
      toast.error("Nothing payable to export");
      return;
    }
    downloadText(
      `xero-timesheet-${weekStart}.csv`,
      toCsv(["first_name", "last_name", "date", "hours", "type"], rows)
    );
    try {
      await record.mutateAsync("xero_timesheet");
      toast.success("Xero timesheet exported");
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Exported, but couldn't record it");
    }
  };

  const exportGross = async () => {
    const headers = [
      "First name", "Last name", "Employment", "Pay type", "Base $/hr", "Total hours",
      ...CATEGORY_ORDER.map((c) => `${CATEGORY_LABELS[c]} h`),
      "Overtime h", "Gross", "Super",
    ];
    const rows: (string | number)[][] = computed.map(({ agg, m, gross }) => {
      const { first, last } = splitName(m?.name ?? "");
      return [
        first, last,
        m?.employment ?? "", m?.pay_type ?? "hourly",
        gross.base != null ? gross.base.toFixed(2) : "",
        (agg.totalMin / 60).toFixed(2),
        ...CATEGORY_ORDER.map((c) => (agg.categories[c] / 60).toFixed(2)),
        gross.otHours.toFixed(2),
        gross.ok ? gross.gross.toFixed(2) : "",
        gross.ok ? gross.superAmount.toFixed(2) : "",
      ];
    });
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    downloadText(`gross-summary-${weekStart}.csv`, toCsv(headers, rows));
    try {
      await record.mutateAsync("gross_summary");
      toast.success("Gross summary exported");
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Exported, but couldn't record it");
    }
  };

  return (
    <div className="space-y-5">
      {/* Week nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-7)} className="rounded-lg p-2 hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[190px] text-center text-sm font-medium text-foreground">
            {format(parseISO(weekStart), "d MMM")} – {format(addDays(parseISO(weekStart), 6), "d MMM yyyy")}
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
        <span className="text-sm text-muted-foreground">{scopeLabel}</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Reconciliation vs Deputy */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Reconciliation vs Deputy</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Recon label="Coop hours" value={`${coopHours.toFixed(1)}h`} />
              <Recon
                label="Deputy hours"
                value={`${depHours.toFixed(1)}h`}
                delta={depHours ? coopHours - depHours : null}
                unit="h"
              />
              <Recon label="Coop gross" value={money(coopGross)} />
              <Recon
                label="Deputy cost"
                value={depCost ? money(depCost) : "—"}
                delta={depCost ? coopGross - depCost : null}
                unit="$"
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Deputy stays the source of truth until these line up. Deputy cost is wage cost (excl. super);
              Coop gross excludes super too, so they're comparable. Investigate variances before exporting.
            </p>
          </div>

          {/* Warnings */}
          {(notPayable > 0 || anyMissingRate) && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/50 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {notPayable > 0 && (
                  <div>
                    {notPayable} punch{notPayable > 1 ? "es are" : " is"} still pending/flagged and{" "}
                    <strong>excluded</strong> — approve them in Timesheets to include.
                  </div>
                )}
                {anyMissingRate && <div>Some staff have no derivable rate (set award level or override).</div>}
              </div>
            </div>
          )}

          {/* Totals + export */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap gap-5 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Employees</div>
                <div className="text-lg font-semibold text-foreground">{computed.length}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Gross</div>
                <div className="text-lg font-semibold text-foreground">{money(coopGross)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Super @ {payroll.super_rate}%</div>
                <div className="text-lg font-semibold text-foreground">{money(coopSuper)}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={exportXero}
                disabled={computed.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> Xero timesheet CSV
              </button>
              <button
                onClick={exportGross}
                disabled={computed.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" /> Gross summary CSV
              </button>
            </div>
          </div>

          {/* Per-employee gross */}
          {computed.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
              No approved punches for this week yet. Approve timesheets first.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Team member</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Hours</th>
                    <th className="px-3 py-2 text-right font-medium">Gross</th>
                    <th className="px-3 py-2 text-right font-medium">Super</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {computed.map(({ agg, m, gross }) => (
                    <tr key={agg.employeeId} className="hover:bg-muted/10">
                      <td className="px-3 py-2 font-medium text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {m?.name ?? "Unknown"}
                          {!gross.ok && <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                        </span>
                      </td>
                      <td className="px-3 py-2 capitalize text-muted-foreground">
                        {gross.salaried ? "salary" : m?.employment ? m.employment.replace("_", "-") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{(agg.totalMin / 60).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {gross.ok ? money(gross.gross) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {gross.ok ? money(gross.superAmount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent exports */}
          {recent.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Recent exports</h3>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Check className="h-3.5 w-3.5 text-success" />
                      {format(parseISO(r.week_start), "d MMM")} · {r.store_scope} ·{" "}
                      {r.format === "xero_timesheet" ? "Xero timesheet" : "Gross summary"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {money(r.total_gross)} · {format(parseISO(r.exported_at), "d MMM h:mm a")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface PayRunRow {
  id: string;
  week_start: string;
  store_scope: string;
  format: string;
  total_gross: number;
  exported_at: string;
}

function Recon({
  label,
  value,
  delta,
  unit,
}: {
  label: string;
  value: string;
  delta?: number | null;
  unit?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
      {delta != null && (
        <div
          className={cn(
            "text-xs tabular-nums",
            Math.abs(delta) < (unit === "$" ? 1 : 0.1) ? "text-success" : "text-warning"
          )}
        >
          {delta >= 0 ? "+" : ""}
          {unit === "$" ? money(delta) : `${delta.toFixed(1)}${unit ?? ""}`} vs Coop
        </div>
      )}
    </div>
  );
}
