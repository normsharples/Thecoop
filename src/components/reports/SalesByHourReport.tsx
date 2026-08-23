import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Clock, Calendar, ChevronLeft, ChevronRight,
  TrendingUp, Receipt, Trophy,
} from "lucide-react";
import { format, parseISO, subDays, addDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useRestaurantScope } from "@/hooks/useRestaurantScope";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TxRow {
  restaurant_id: string;
  hour: number;
  amount: number | null;
  net_amount: number | null;
  transaction_ref: string;
  sold_at: string;
}

type Metric = "sales" | "orders";

// Per-venue accent colours (cycled), matching the app's orange/blue palette.
const VENUE_COLORS = ["#f97316", "#3b82f6", "#10b981", "#a855f7", "#ef4444", "#eab308"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 0–23 → "12am", "9am", "12pm", "5pm". */
function hourLabel(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${period}`;
}

function ScopedTooltip({
  active, payload, label, venueNames, metric,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  venueNames: string[];
  metric: Metric;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground">{label}</p>
      {venueNames.length > 1 &&
        payload.map((p) => (
          <p key={p.name} className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.name}:{" "}
            <span className="font-semibold text-foreground">
              {metric === "sales" ? formatCurrency(p.value) : p.value}
            </span>
          </p>
        ))}
      <p className="mt-0.5 text-muted-foreground">
        {metric === "sales" ? "Sales" : "Orders"} total:{" "}
        <span className="font-semibold text-foreground">
          {metric === "sales" ? formatCurrency(total) : total}
        </span>
      </p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function SalesByHourReport() {
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [metric, setMetric] = useState<Metric>("sales");

  const scope = useRestaurantScope();
  const { data: restaurants = [] } = useRestaurants();
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of restaurants) m[r.id] = r.name;
    return m;
  }, [restaurants]);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["sales-by-hour", selectedDate, scope.key],
    queryFn: async () => {
      if (!scope.ids.length) return [] as TxRow[];
      const { data, error } = await supabase
        .from("sales_transactions")
        .select("restaurant_id, hour, amount, net_amount, transaction_ref, sold_at")
        .eq("business_date", selectedDate)
        .in("restaurant_id", scope.ids)
        .order("sold_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TxRow[];
    },
    enabled: scope.ids.length > 0,
    staleTime: 1000 * 60, // 1 min — the feed syncs hourly
  });

  // Venues that actually have sales today, in a stable order.
  const venueIds = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows ?? []) seen.add(r.restaurant_id);
    return scope.ids.filter((id) => seen.has(id));
  }, [rows, scope.ids]);
  const venueNames = venueIds.map((id) => nameOf[id] ?? "Venue");
  const primaryKey = venueNames[0] ?? "_gross"; // single-venue bar dataKey

  // Contiguous hour range across the day's data (fallback to a trading window).
  const { chartData, totals } = useMemo(() => {
    const list = rows ?? [];
    let minH = 24, maxH = -1;
    for (const r of list) { if (r.hour < minH) minH = r.hour; if (r.hour > maxH) maxH = r.hour; }
    if (maxH < 0) { minH = 9; maxH = 21; }

    // hour → venueId → { gross, net, orders }
    const grid: Record<number, Record<string, { gross: number; net: number; orders: number }>> = {};
    for (let h = minH; h <= maxH; h++) grid[h] = {};
    let dayGross = 0, dayOrders = 0, dayNet = 0;
    for (const r of list) {
      const cell = (grid[r.hour][r.restaurant_id] ||= { gross: 0, net: 0, orders: 0 });
      cell.gross += r.amount ?? 0;
      cell.net += r.net_amount ?? 0;
      cell.orders += 1;
      dayGross += r.amount ?? 0;
      dayNet += r.net_amount ?? 0;
      dayOrders += 1;
    }

    const data = [];
    for (let h = minH; h <= maxH; h++) {
      const row: Record<string, number | string> = { hour: h, label: hourLabel(h) };
      let hourGross = 0, hourOrders = 0, hourNet = 0;
      for (const id of venueIds) {
        const c = grid[h][id] ?? { gross: 0, net: 0, orders: 0 };
        const name = nameOf[id] ?? id;
        row[name] = metric === "sales" ? c.gross : c.orders;
        hourGross += c.gross; hourOrders += c.orders; hourNet += c.net;
      }
      row._gross = hourGross; row._orders = hourOrders; row._net = hourNet;
      data.push(row);
    }

    return {
      chartData: data,
      totals: {
        gross: dayGross, net: dayNet, orders: dayOrders,
        avg: dayOrders ? dayGross / dayOrders : 0,
      },
    };
  }, [rows, venueIds, nameOf, metric]);

  // Busiest hour by gross sales.
  const busiest = useMemo(() => {
    let best: { hour: number; gross: number; orders: number } | null = null;
    for (const d of chartData) {
      const gross = Number(d._gross) || 0;
      if (!best || gross > best.gross) best = { hour: Number(d.hour), gross, orders: Number(d._orders) || 0 };
    }
    return best && best.gross > 0 ? best : null;
  }, [chartData]);

  const lastUpdated = useMemo(() => {
    const list = rows ?? [];
    if (!list.length) return null;
    const max = list.reduce((m, r) => (r.sold_at > m ? r.sold_at : m), list[0].sold_at);
    return max;
  }, [rows]);

  const hasData = (rows?.length ?? 0) > 0;
  const isToday = selectedDate === format(new Date(), "yyyy-MM-dd");

  function shiftDate(days: number) {
    setSelectedDate((prev) =>
      format(days > 0 ? addDays(parseISO(prev), days) : subDays(parseISO(prev), Math.abs(days)), "yyyy-MM-dd")
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => shiftDate(-1)}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={selectedDate}
            max={format(new Date(), "yyyy-MM-dd")}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-sm font-medium text-foreground outline-none"
          />
        </div>

        <button
          onClick={() => shiftDate(1)}
          disabled={isToday}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <span className="text-sm text-muted-foreground">
          {format(parseISO(selectedDate), "EEEE, d MMMM yyyy")}
        </span>

        {/* Metric toggle */}
        <div className="ml-auto flex rounded-lg border border-border bg-card p-1">
          {(["sales", "orders"] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                metric === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!isLoading && !hasData && (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center text-center">
          <Clock className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-base font-semibold mb-2">No sales yet for this day</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            The Sales Feed sync runs hourly during trading hours and fills this in as sales
            come through. Nothing has been recorded for {format(parseISO(selectedDate), "d MMM")} yet.
          </p>
        </div>
      )}

      {!isLoading && hasData && (
        <>
          {/* ── KPI cards ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Total Sales"
              value={formatCurrency(totals.gross)} accent="text-warning" bg="bg-warning/10" />
            <KpiCard icon={<Receipt className="h-4 w-4" />} label="Orders"
              value={String(totals.orders)} accent="text-blue-500" bg="bg-blue-500/10" />
            <KpiCard icon={<Receipt className="h-4 w-4" />} label="Avg Sale"
              value={formatCurrency(totals.avg)} accent="text-success" bg="bg-success/10" />
            <KpiCard icon={<Trophy className="h-4 w-4" />} label="Busiest Hour"
              value={busiest ? hourLabel(busiest.hour) : "—"}
              sub={busiest ? formatCurrency(busiest.gross) : undefined}
              accent="text-purple-500" bg="bg-purple-500/10" />
          </div>

          {/* ── Hourly chart ─────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {metric === "sales" ? "Sales" : "Orders"} by hour
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {venueNames.length > 1 ? `${venueNames.length} venues` : venueNames[0]}
                  {lastUpdated && ` · as of ${format(parseISO(lastUpdated), "h:mmaaa")}`}
                </p>
              </div>
              {venueNames.length > 1 && (
                <div className="flex flex-wrap gap-3">
                  {venueNames.map((n, i) => (
                    <span key={n} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ background: VENUE_COLORS[i % VENUE_COLORS.length] }} />
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={(v: number) => (metric === "sales" ? (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`) : String(v))}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    content={(props) => <ScopedTooltip {...(props as any)} venueNames={venueNames} metric={metric} />}
                    cursor={{ fill: "hsl(var(--accent))" }} />
                  {venueNames.length <= 1 ? (
                    <Bar dataKey={primaryKey} radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill="#f97316"
                          fillOpacity={(Number(entry[primaryKey]) || 0) === 0 ? 0.35 : 1} />
                      ))}
                    </Bar>
                  ) : (
                    venueNames.map((n, i) => (
                      <Bar key={n} dataKey={n}
                        fill={VENUE_COLORS[i % VENUE_COLORS.length]}
                        radius={[4, 4, 0, 0]} maxBarSize={40} />
                    ))
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Hour breakdown table ─────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Hour</th>
                    <th className="px-4 py-3 font-medium text-right">Orders</th>
                    <th className="px-4 py-3 font-medium text-right">Sales</th>
                    <th className="px-4 py-3 font-medium text-right">Avg Sale</th>
                    <th className="px-4 py-3 font-medium text-right">% of day</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((d) => {
                    const gross = Number(d._gross) || 0;
                    const orders = Number(d._orders) || 0;
                    const share = totals.gross > 0 ? (gross / totals.gross) * 100 : 0;
                    return (
                      <tr key={String(d.hour)} className="border-b border-border/50 last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {hourLabel(Number(d.hour))}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{orders || "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground">
                          {gross > 0 ? formatCurrency(gross) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {orders > 0 ? formatCurrency(gross / orders) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-warning" style={{ width: `${share}%` }} />
                            </div>
                            <span className="tabular-nums text-muted-foreground w-10 text-right">
                              {share.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-4 py-3 text-foreground">Total</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{totals.orders}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatCurrency(totals.gross)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatCurrency(totals.avg)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Small KPI card ──────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, accent, bg,
}: {
  icon: ReactNode; label: string; value: string; sub?: string; accent: string; bg: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className={cn("rounded-lg p-1.5", bg, accent)}>{icon}</div>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", accent)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}
