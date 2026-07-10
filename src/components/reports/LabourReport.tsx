import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  PlusCircle,
  Loader2,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import {
  format,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  subWeeks,
  subMonths,
  parseISO,
} from "date-fns";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import type { LabourDaily, Restaurant } from "@/types";

// ─── helpers ──────────────────────────────────────────────────────────────────

type Preset = "today" | "yesterday" | "last7" | "thisWeek" | "lastWeek" | "thisMonth" | "last30";
interface DateRange { from: string; to: string }

function getPresetRange(preset: Preset): DateRange {
  const today = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  switch (preset) {
    case "today":      return { from: fmt(today), to: fmt(today) };
    case "yesterday":  return { from: fmt(subDays(today, 1)), to: fmt(subDays(today, 1)) };
    case "last7":      return { from: fmt(subDays(today, 6)), to: fmt(today) };
    // Week/month "to date" — bounded at today, not the end of the calendar period,
    // so the comparison periods below line up day-for-day instead of partial vs full.
    case "thisWeek":   return { from: fmt(startOfWeek(today, { weekStartsOn: 1 })), to: fmt(today) };
    case "lastWeek": {
      const lw = subWeeks(today, 1);
      return { from: fmt(startOfWeek(lw, { weekStartsOn: 1 })), to: fmt(endOfWeek(lw, { weekStartsOn: 1 })) };
    }
    case "thisMonth":  return { from: fmt(startOfMonth(today)), to: fmt(today) };
    case "last30":     return { from: fmt(subDays(today, 29)), to: fmt(today) };
  }
}

// For "this week"/"this month" (in-progress periods), shift by a calendar week/month
// so the comparison covers the same elapsed days (e.g. 1st–7th vs 1st–7th last month),
// not a full previous period. Other presets are already complete periods of fixed
// length, so shifting by that same day-count remains a valid apples-to-apples comparison.
function getPrevRange(range: DateRange, preset: Preset): DateRange {
  const from = parseISO(range.from);
  const to   = parseISO(range.to);
  if (preset === "thisWeek")  return { from: format(subWeeks(from, 1), "yyyy-MM-dd"),  to: format(subWeeks(to, 1), "yyyy-MM-dd") };
  if (preset === "thisMonth") return { from: format(subMonths(from, 1), "yyyy-MM-dd"), to: format(subMonths(to, 1), "yyyy-MM-dd") };
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  return {
    from: format(subDays(from, days), "yyyy-MM-dd"),
    to:   format(subDays(to,   days), "yyyy-MM-dd"),
  };
}

function labourPctStatus(pct: number): "success" | "warning" | "destructive" {
  if (pct >= 35) return "destructive";
  if (pct >= 30) return "warning";
  return "success";
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        source === "deputy"   && "bg-green-500/10 text-green-500",
        source === "manual"   && "bg-muted/60 text-muted-foreground",
        source === "override" && "bg-amber-500/10 text-amber-500"
      )}
    >
      {source}
    </span>
  );
}

function KpiCard({
  label, value, prev, icon, formatFn, rag,
}: {
  label: string; value: number | null; prev: number | null;
  icon: React.ReactNode; formatFn: (v: number) => string;
  rag?: boolean;
}) {
  const change = value !== null && prev !== null && prev > 0
    ? ((value - prev) / prev) * 100 : null;
  const isPositive = change !== null && change >= 0;
  const ragStatus = rag && value !== null ? labourPctStatus(value) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</div>
      </div>
      <p className={cn(
        "mt-3 text-3xl font-bold",
        ragStatus === "destructive" && "text-red-500",
        ragStatus === "warning"     && "text-amber-500",
        ragStatus === "success"     && "text-green-500",
      )}>
        {value !== null ? formatFn(value) : "—"}
      </p>
      {rag && value !== null ? (
        <div className="mt-1.5">
          <span className={cn(
            "text-xs font-medium",
            ragStatus === "destructive" && "text-red-500",
            ragStatus === "warning"     && "text-amber-500",
            ragStatus === "success"     && "text-green-500",
          )}>
            {ragStatus === "destructive" ? "Over target" : ragStatus === "warning" ? "Near target" : "On target"}
          </span>
          <span className="text-xs text-muted-foreground"> (target &lt;30%)</span>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5">
          {change !== null ? (
            <>
              {change > 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : change < 0 ? (
                <TrendingDown className="h-4 w-4 text-red-500" />
              ) : (
                <Minus className="h-4 w-4 text-muted-foreground" />
              )}
              <span className={cn("text-sm font-medium", isPositive ? "text-green-500" : "text-red-500")}>
                {change > 0 ? "+" : ""}{change.toFixed(1)}%
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
          <span className="text-xs text-muted-foreground">vs prev period</span>
        </div>
      )}
    </div>
  );
}

function exportCSV(data: LabourDaily[], restaurants: Restaurant[]) {
  const headers = [
    "Date", "Restaurant", "Actual Hours", "Scheduled Hours",
    "Overtime Hours", "Labour Cost", "Labour %", "Source"
  ];
  const rows = data.map((r) => [
    r.date,
    restaurants.find((x) => x.id === r.restaurant_id)?.name ?? "",
    r.total_hours,
    r.scheduled_hours ?? "",
    r.overtime_hours ?? "",
    r.total_cost,
    r.labour_percent,
    r.source,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(String).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `labour-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "thisMonth", label: "This month" },
  { key: "last30", label: "Last 30 days" },
];

const ROLE_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ec4899"];

export default function LabourReport() {
  const navigate = useNavigate();
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const [preset, setPreset] = useState<Preset>("last7");
  const [customRange, setCustomRange] = useState<DateRange | null>(null);

  const dateRange = customRange ?? getPresetRange(preset);
  const prevRange = getPrevRange(dateRange, preset);

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants?.map((r) => r.id) ?? [];

  const { data: labourData, isLoading } = useQuery({
    queryKey: ["labour-report", dateRange, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("labour_daily")
        .select("*")
        .gte("date", dateRange.from)
        .lte("date", dateRange.to)
        .in("restaurant_id", restaurantIds)
        .order("date");
      if (error) throw error;
      return data as LabourDaily[];
    },
    enabled: !!restaurantIds.length,
  });

  const { data: prevData } = useQuery({
    queryKey: ["labour-report-prev", prevRange, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("labour_daily")
        .select("total_hours, total_cost, labour_percent, overtime_hours")
        .gte("date", prevRange.from)
        .lte("date", prevRange.to)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data as Partial<LabourDaily>[];
    },
    enabled: !!restaurantIds.length,
  });

  const kpis = useMemo(() => {
    const cur = labourData ?? [];
    const prv = prevData ?? [];
    const totalHours   = cur.reduce((s, r) => s + Number(r.total_hours), 0);
    const totalCost    = cur.reduce((s, r) => s + Number(r.total_cost), 0);
    const avgLabourPct = cur.length > 0
      ? cur.reduce((s, r) => s + Number(r.labour_percent), 0) / cur.length : 0;
    const totalOT      = cur.reduce((s, r) => s + Number(r.overtime_hours ?? 0), 0);
    const prevHours    = prv.reduce((s, r) => s + Number(r.total_hours ?? 0), 0);
    const prevCost     = prv.reduce((s, r) => s + Number(r.total_cost ?? 0), 0);
    const prevAvgPct   = prv.length > 0
      ? prv.reduce((s, r) => s + Number(r.labour_percent ?? 0), 0) / prv.length : 0;
    const prevOT       = prv.reduce((s, r) => s + Number(r.overtime_hours ?? 0), 0);
    return { totalHours, totalCost, avgLabourPct, totalOT, prevHours, prevCost, prevAvgPct, prevOT };
  }, [labourData, prevData]);

  const labourPctTrend = useMemo(() => {
    const dateMap = new Map<string, number[]>();
    for (const row of labourData ?? []) {
      if (!dateMap.has(row.date)) dateMap.set(row.date, []);
      dateMap.get(row.date)!.push(Number(row.labour_percent));
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({
        date: format(parseISO(date), "d MMM"),
        pct: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
      }));
  }, [labourData]);

  const rosterActualData = useMemo(() => {
    const dateMap = new Map<string, { scheduled: number; actual: number }>();
    for (const row of labourData ?? []) {
      const e = dateMap.get(row.date) ?? { scheduled: 0, actual: 0 };
      dateMap.set(row.date, {
        scheduled: e.scheduled + Number(row.scheduled_hours ?? 0),
        actual:    e.actual    + Number(row.total_hours),
      });
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date: format(parseISO(date), "d MMM"), ...vals }));
  }, [labourData]);

  const allRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const row of labourData ?? []) {
      for (const r of row.hours_by_role ?? []) roles.add(r.role);
    }
    return Array.from(roles);
  }, [labourData]);

  const roleData = useMemo(() => {
    const dateMap = new Map<string, Record<string, number>>();
    for (const row of labourData ?? []) {
      if (!dateMap.has(row.date)) dateMap.set(row.date, {});
      const entry = dateMap.get(row.date)!;
      for (const r of row.hours_by_role ?? []) {
        entry[r.role] = (entry[r.role] ?? 0) + r.hours;
      }
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date: format(parseISO(date), "d MMM"), ...vals }));
  }, [labourData]);

  if (!isLoading && !labourData?.length) {
    return (
      <div className="space-y-4">
        <FiltersBar
          preset={preset} setPreset={(p) => { setPreset(p); setCustomRange(null); }}
          customRange={customRange} setCustomRange={setCustomRange}
          onManualEntry={() => navigate("/reports/labour/manual-entry")}
          onExport={() => {}} hasData={false}
        />
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-base font-semibold text-foreground mb-2">No labour data</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            No labour records for the selected period. Use Manual Entry or connect Deputy.
          </p>
          <button
            onClick={() => navigate("/reports/labour/manual-entry")}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <PlusCircle className="h-4 w-4" /> Manual Entry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FiltersBar
        preset={preset} setPreset={(p) => { setPreset(p); setCustomRange(null); }}
        customRange={customRange} setCustomRange={setCustomRange}
        onManualEntry={() => navigate("/reports/labour/manual-entry")}
        onExport={() => labourData && restaurants && exportCSV(labourData, restaurants)}
        hasData={!!labourData?.length}
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1,2,3,4].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Total Hours"   value={kpis.totalHours}   prev={kpis.prevHours}
            icon={<Clock className="h-5 w-5" />} formatFn={(v) => `${v.toFixed(1)}h`} />
          <KpiCard label="Labour Cost"   value={kpis.totalCost}    prev={kpis.prevCost}
            icon={<Users className="h-5 w-5" />} formatFn={(v) => formatCurrency(v)} />
          <KpiCard label="Labour Cost %" value={kpis.avgLabourPct} prev={kpis.prevAvgPct}
            icon={<TrendingUp className="h-5 w-5" />} formatFn={(v) => formatPercent(v)} rag />
          <KpiCard label="Overtime Hrs"  value={kpis.totalOT}      prev={kpis.prevOT}
            icon={<Clock className="h-5 w-5" />} formatFn={(v) => `${v.toFixed(1)}h`} />
        </div>
      )}

      {labourPctTrend.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4">Labour % Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={labourPctTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis
                tickFormatter={(v) => `${v.toFixed(0)}%`}
                tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))"
                domain={[0, 50]}
              />
              <Tooltip
                formatter={(v) => [`${Number(v).toFixed(1)}%`, "Labour %"]}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
              />
              <Line type="monotone" dataKey="pct" stroke="#f97316" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Labour %" />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-green-500" /> Under 30% — on target</span>
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-amber-500" /> 30–35% — near target</span>
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-red-500" /> Over 35% — over target</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {rosterActualData.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold mb-4">Roster vs Actual Hours</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={rosterActualData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  formatter={(v) => [`${Number(v).toFixed(1)}h`, ""]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                />
                <Legend />
                <Bar dataKey="scheduled" name="Scheduled" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual"    name="Actual"    fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {roleData.length > 0 && allRoles.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold mb-4">Hours by Role</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={roleData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  formatter={(v) => [`${Number(v).toFixed(1)}h`, ""]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                />
                <Legend />
                {allRoles.map((role, i) => (
                  <Bar key={role} dataKey={role} stackId="roles" fill={ROLE_COLORS[i % ROLE_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {labourData && labourData.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm font-semibold">Data</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Date","Restaurant","Actual Hrs","Scheduled","Overtime","Cost","Labour %","Source"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {labourData.map((row) => {
                  const restaurant = restaurants?.find((r) => r.id === row.restaurant_id);
                  const pctStatus  = labourPctStatus(Number(row.labour_percent));
                  return (
                    <tr key={row.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 text-sm">{format(parseISO(row.date), "d MMM yyyy")}</td>
                      <td className="px-4 py-3 text-sm font-medium">{restaurant?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">{Number(row.total_hours).toFixed(1)}h</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {row.scheduled_hours != null ? `${Number(row.scheduled_hours).toFixed(1)}h` : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {row.overtime_hours != null && Number(row.overtime_hours) > 0
                          ? `${Number(row.overtime_hours).toFixed(1)}h` : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">{formatCurrency(row.total_cost)}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={cn(
                          "font-medium",
                          pctStatus === "destructive" && "text-red-500",
                          pctStatus === "warning"     && "text-amber-500",
                          pctStatus === "success"     && "text-green-500",
                        )}>
                          {formatPercent(Number(row.labour_percent))}
                        </span>
                      </td>
                      <td className="px-4 py-3"><SourceBadge source={row.source} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}

// ─── Filters bar ─────────────────────────────────────────────────────────────

function FiltersBar({
  preset, setPreset, customRange, setCustomRange,
  onManualEntry, onExport, hasData,
}: {
  preset: Preset; setPreset: (p: Preset) => void;
  customRange: DateRange | null; setCustomRange: (r: DateRange | null) => void;
  onManualEntry: () => void; onExport: () => void; hasData: boolean;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activePresetLabel = customRange
    ? `${customRange.from} → ${customRange.to}`
    : PRESETS.find(p => p.key === preset)?.label ?? "Last 7 days";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {/* Mobile: compact toggle */}
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="sm:hidden inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          {activePresetLabel}
          <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", filtersOpen && "rotate-180")} />
        </button>

        {/* Desktop: inline preset row */}
        <div className="hidden sm:flex sm:flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => { setPreset(p.key); setCustomRange(null); }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                preset === p.key && !customRange
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <input type="date" value={customRange?.from ?? ""}
              onChange={(e) => setCustomRange({ from: e.target.value, to: customRange?.to ?? e.target.value })}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={customRange?.to ?? ""}
              onChange={(e) => setCustomRange({ from: customRange?.from ?? e.target.value, to: e.target.value })}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {hasData && (
            <button onClick={onExport} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors">
              <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export CSV</span>
            </button>
          )}
          <button onClick={onManualEntry} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            <PlusCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline">Manual Entry</span>
          </button>
        </div>
      </div>

      {/* Mobile: expanded preset grid */}
      {filtersOpen && (
        <div className="sm:hidden rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => { setPreset(p.key); setCustomRange(null); setFiltersOpen(false); }}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-medium transition-colors text-center",
                  preset === p.key && !customRange
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={customRange?.from ?? ""}
              onChange={(e) => setCustomRange({ from: e.target.value, to: customRange?.to ?? e.target.value })}
              className="h-8 flex-1 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={customRange?.to ?? ""}
              onChange={(e) => setCustomRange({ from: customRange?.from ?? e.target.value, to: e.target.value })}
              className="h-8 flex-1 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  );
}
