import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Clock,
  DollarSign,
  Gauge,
  AlertTriangle,
  CalendarDays,
  Loader2,
  Check,
} from "lucide-react";
import {
  format,
  startOfWeek,
  addWeeks,
  subWeeks,
  addDays,
  parseISO,
} from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useTargets } from "@/hooks/useTargets";
import { useDailyProjections } from "@/hooks/useDailyProjections";
import { useRosterNotes } from "@/hooks/useRosterNotes";
import { useRosterRefresh } from "@/hooks/useRosterRefresh";
import { cn, formatCurrency } from "@/lib/utils";
import type { LabourDaily, CalendarEvent } from "@/types";

// ── Variance colouring: rostered vs required ──────────────────────────────────
// Green = at/under required, Amber = up to 10% over, Red = more than 10% over.
function varianceColor(rostered: number, required: number): string {
  if (required <= 0) return "#94a3b8"; // no target set → neutral
  if (rostered <= required) return "#22c55e";
  if (rostered <= required * 1.1) return "#eab308";
  return "#ef4444";
}

interface DayRow {
  date: string;
  label: string;
  projected: number;
  required: number;
  rostered: number | null;
  events: CalendarEvent[];
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-success"
      : tone === "amber"
      ? "text-warning"
      : tone === "red"
      ? "text-destructive"
      : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", toneClass)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Notes panel (debounced autosave) ──────────────────────────────────────────
function NotesPanel({
  restaurantId,
  weekStart,
}: {
  restaurantId: string;
  weekStart: string;
}) {
  const { note, save } = useRosterNotes(restaurantId, weekStart);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(note?.note ?? "");
  }, [note?.id, note?.note]);

  const debouncedSave = useCallback(
    (val: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        setStatus("saving");
        try {
          await save(val);
          setStatus("saved");
          setTimeout(() => setStatus("idle"), 1500);
        } catch {
          setStatus("idle");
          toast.error("Failed to save note");
        }
      }, 700);
    },
    [save]
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground">Roster notes</h3>
        {status === "saving" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving
          </span>
        )}
        {status === "saved" && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          debouncedSave(e.target.value);
        }}
        placeholder="Anything the roster checker should know this week — e.g. big catering order Saturday, staff on leave, public holiday…"
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RosterDashboard() {
  const { data: restaurants = [] } = useRestaurants();
  const { selectedRestaurantIds, selectedRestaurantId } = useSelectedRestaurant();

  // One store at a time. If exactly one is selected use it; otherwise ask.
  const restaurantId =
    selectedRestaurantId ??
    (selectedRestaurantIds.length === 1 ? selectedRestaurantIds[0] : null);
  const restaurant = restaurants.find((r) => r.id === restaurantId) ?? null;

  // Default to the upcoming week (next Monday–Sunday).
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 })
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const from = format(days[0], "yyyy-MM-dd");
  const to = format(days[6], "yyyy-MM-dd");
  const weekStartStr = from;

  const { getSpmhTarget, getMinRosterHours } = useTargets(restaurantId);
  const spmhTarget = getSpmhTarget() ?? 0;
  const minHours = getMinRosterHours() ?? 0;

  const { getProjection } = useDailyProjections(
    restaurantId ? [restaurantId] : [],
    from,
    to
  );

  const { latest, isInFlight, requestRefresh, isRequesting } = useRosterRefresh(
    restaurantId,
    weekStartStr
  );

  // Rostered hours + cost from labour_daily (populated by the Deputy scrape).
  const { data: labourData } = useQuery({
    queryKey: ["roster-labour", from, to, restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("labour_daily")
        .select("date, scheduled_hours, total_cost, total_hours")
        .eq("restaurant_id", restaurantId)
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;
      return data as Pick<
        LabourDaily,
        "date" | "scheduled_hours" | "total_cost" | "total_hours"
      >[];
    },
    enabled: !!restaurantId,
  });

  // Calendar events overlapping the week (this store or all-stores).
  const { data: eventsData } = useQuery({
    queryKey: ["roster-events", from, to, restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("calendar_events")
        .select("*")
        .lte("start_date", to)
        .or(`end_date.gte.${from},end_date.is.null`);
      if (error) throw error;
      return (data as CalendarEvent[]).filter(
        (e) => e.restaurant_id === restaurantId || e.restaurant_id === null
      );
    },
    enabled: !!restaurantId,
  });

  const rosteredByDate = useMemo(() => {
    const m = new Map<string, { hours: number | null; cost: number }>();
    for (const r of labourData ?? []) {
      m.set(r.date, {
        hours: r.scheduled_hours == null ? null : Number(r.scheduled_hours),
        cost: Number(r.total_cost ?? 0),
      });
    }
    return m;
  }, [labourData]);

  const rows: DayRow[] = useMemo(() => {
    return days.map((d) => {
      const dateStr = format(d, "yyyy-MM-dd");
      const projected = getProjection(restaurantId ?? "", dateStr) ?? 0;
      const base = spmhTarget > 0 && projected > 0 ? projected / spmhTarget : 0;
      const required = Math.max(base, minHours);
      const rostered = rosteredByDate.get(dateStr)?.hours ?? null;
      const events = (eventsData ?? []).filter((e) => {
        const start = e.start_date.slice(0, 10);
        const end = (e.end_date ?? e.start_date).slice(0, 10);
        return dateStr >= start && dateStr <= end;
      });
      return {
        date: dateStr,
        label: format(d, "EEE"),
        projected,
        required: Math.round(required * 10) / 10,
        rostered,
        events,
      };
    });
  }, [days, getProjection, restaurantId, spmhTarget, minHours, rosteredByDate, eventsData]);

  const totals = useMemo(() => {
    let projected = 0;
    let required = 0;
    let rostered = 0;
    let cost = 0;
    let hasRostered = false;
    for (const r of rows) {
      projected += r.projected;
      required += r.required;
      if (r.rostered != null) {
        rostered += r.rostered;
        hasRostered = true;
      }
      cost += rosteredByDate.get(r.date)?.cost ?? 0;
    }
    const rosteredSpmh = hasRostered && rostered > 0 ? projected / rostered : null;
    return { projected, required, rostered, cost, hasRostered, rosteredSpmh };
  }, [rows, rosteredByDate]);

  // ── Guard states ────────────────────────────────────────────────────────────
  if (!restaurantId) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center text-center">
        <CalendarRange className="h-10 w-10 text-muted-foreground mb-3" />
        <h3 className="text-base font-semibold text-foreground mb-1">Pick one store</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          The roster dashboard works one store at a time. Select a single venue
          from the store picker at the top to continue.
        </p>
      </div>
    );
  }

  const chartData = rows.map((r) => ({
    label: r.label,
    Required: r.required,
    Rostered: r.rostered ?? 0,
    hasEvent: r.events.length > 0,
    _color: varianceColor(r.rostered ?? 0, r.required),
  }));

  const refreshLabel = isInFlight || isRequesting ? "Refreshing…" : "Refresh roster";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground leading-tight">
              Roster — {restaurant?.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {format(days[0], "EEE d MMM")} – {format(days[6], "EEE d MMM yyyy")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <button
              onClick={() => setWeekStart((w) => subWeeks(w, 1))}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() =>
                setWeekStart(startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 }))
              }
              className="px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Next week
            </button>
            <button
              onClick={() => setWeekStart((w) => addWeeks(w, 1))}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={async () => {
              try {
                await requestRefresh();
                toast.success("Roster refresh requested — the scraper will pick it up shortly.");
              } catch {
                toast.error("Could not request a refresh.");
              }
            }}
            disabled={isInFlight || isRequesting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", (isInFlight || isRequesting) && "animate-spin")} />
            {refreshLabel}
          </button>
        </div>
      </div>

      {latest?.status === "error" && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Last refresh failed{latest.error_message ? `: ${latest.error_message}` : "."}
        </div>
      )}

      {/* Missing-config nudges */}
      {spmhTarget <= 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning dark:text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No SPMH target set for this store — required hours fall back to the
          minimum floor only. Set it in Settings → Targets.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          icon={Clock}
          label="Rostered hours"
          value={totals.hasRostered ? `${totals.rostered.toFixed(1)}h` : "—"}
          sub={`Required ${totals.required.toFixed(1)}h · ${
            totals.hasRostered
              ? (totals.rostered <= totals.required ? "under budget" : "over budget")
              : "no roster synced yet"
          }`}
          tone={
            !totals.hasRostered
              ? "default"
              : totals.rostered <= totals.required
              ? "green"
              : totals.rostered <= totals.required * 1.1
              ? "amber"
              : "red"
          }
        />
        <KpiCard
          icon={Gauge}
          label="Rostered SPMH"
          value={totals.rosteredSpmh != null ? formatCurrency(totals.rosteredSpmh) : "—"}
          sub={
            spmhTarget > 0
              ? `Target ${formatCurrency(spmhTarget)} · projected sales ÷ rostered h`
              : "Set an SPMH target to compare"
          }
          tone={
            totals.rosteredSpmh == null || spmhTarget <= 0
              ? "default"
              : totals.rosteredSpmh >= spmhTarget
              ? "green"
              : totals.rosteredSpmh >= spmhTarget * 0.95
              ? "amber"
              : "red"
          }
        />
        <KpiCard
          icon={DollarSign}
          label="Rostered labour cost"
          value={totals.hasRostered ? formatCurrency(totals.cost) : "—"}
          sub={
            totals.projected > 0 && totals.cost > 0
              ? `${((totals.cost / totals.projected) * 100).toFixed(1)}% of projected sales`
              : "Wage cost of the current roster"
          }
        />
      </div>

      {/* Rostered vs Required chart */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Rostered vs Required hours
        </h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={<EventTick data={chartData} />}
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                height={40}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                unit="h"
                width={44}
              />
              <Tooltip
                formatter={(v) => `${Number(v).toFixed(1)}h`}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Required" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Rostered" radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d._color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#94a3b8" }} />
            Required
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#22c55e" }} />
            Rostered at/under
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#ef4444" }} />
            Over required
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> Event on day
          </span>
        </div>
      </div>

      {/* Day detail table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-left">Day</th>
                <th className="px-4 py-3 text-right">Proj. sales</th>
                <th className="px-4 py-3 text-right">Required h</th>
                <th className="px-4 py-3 text-right">Rostered h</th>
                <th className="px-4 py-3 text-right">Variance</th>
                <th className="px-4 py-3 text-left">Events</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const variance = r.rostered != null ? r.rostered - r.required : null;
                const color = varianceColor(r.rostered ?? 0, r.required);
                return (
                  <tr key={r.date}>
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {format(parseISO(r.date), "EEE d MMM")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {r.projected > 0 ? formatCurrency(r.projected) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {r.required.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {r.rostered != null ? r.rostered.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {variance == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span style={{ color }}>
                          {variance > 0 ? "+" : ""}
                          {variance.toFixed(1)}h
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.events.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.events.map((e) => (
                            <span
                              key={e.id}
                              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                            >
                              <CalendarDays className="h-3 w-3" />
                              {e.title}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      <NotesPanel restaurantId={restaurantId} weekStart={weekStartStr} />
    </div>
  );
}

// Custom X-axis tick that appends a calendar dot for days that have an event.
function EventTick({
  x,
  y,
  payload,
  data,
}: {
  x?: number;
  y?: number;
  payload?: { value: string; index: number };
  data: { label: string; hasEvent: boolean }[];
}) {
  if (x == null || y == null || !payload) return null;
  const row = data[payload.index];
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={12}>
        {payload.value}
      </text>
      {row?.hasEvent && <circle cx={0} cy={26} r={3} fill="hsl(var(--primary))" />}
    </g>
  );
}
