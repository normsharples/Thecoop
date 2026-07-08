import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  subDays,
  subWeeks,
  subMonths,
  eachWeekOfInterval,
  isWithinInterval,
} from "date-fns";
import { TrendingUp, TrendingDown, Minus, ShoppingCart, BarChart3, Receipt, Store, Package, ArrowRight, AlertCircle, ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_OPTS        = { weekStartsOn: 1 as const };
const FOOD_COST_TARGET = 30;

type Preset = "thisWeek" | "lastWeek" | "thisMonth" | "last30" | "last3m";
interface DateRange { from: string; to: string }

const PRESETS: { label: string; value: Preset }[] = [
  { label: "This Week",     value: "thisWeek"  },
  { label: "Last Week",     value: "lastWeek"  },
  { label: "This Month",    value: "thisMonth" },
  { label: "Last 30 Days",  value: "last30"    },
  { label: "Last 3 Months", value: "last3m"    },
];

function fmt(d: Date) { return format(d, "yyyy-MM-dd"); }

function getRange(preset: Preset): DateRange {
  const today = new Date();
  switch (preset) {
    // Week/month "to date" — bounded at today, not the end of the calendar period,
    // so the comparison periods below line up day-for-day instead of partial vs full.
    case "thisWeek":  return { from: fmt(startOfWeek(today, WEEK_OPTS)), to: fmt(today) };
    case "lastWeek": {
      const lw = subWeeks(today, 1);
      return { from: fmt(startOfWeek(lw, WEEK_OPTS)), to: fmt(endOfWeek(lw, WEEK_OPTS)) };
    }
    case "thisMonth": return { from: fmt(startOfMonth(today)), to: fmt(today) };
    case "last30":    return { from: fmt(subDays(today, 29)), to: fmt(today) };
    case "last3m":    return { from: fmt(subMonths(today, 3)), to: fmt(today) };
  }
}

// For "this week"/"this month" (in-progress periods), shift by a calendar week/month
// so the comparison covers the same elapsed days (e.g. 1st–7th vs 1st–7th last month),
// not a full previous period. Other presets are already complete periods of fixed
// length, so shifting by that same day-count remains a valid apples-to-apples comparison.
function getPrev(range: DateRange, preset: Preset): DateRange {
  const from = parseISO(range.from);
  const to   = parseISO(range.to);
  if (preset === "thisWeek")  return { from: fmt(subWeeks(from, 1)),  to: fmt(subWeeks(to, 1)) };
  if (preset === "thisMonth") return { from: fmt(subMonths(from, 1)), to: fmt(subMonths(to, 1)) };
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  return { from: fmt(subDays(from, days)), to: fmt(subDays(from, 1)) };
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

function pctColour(pct: number) {
  if (pct <= 28) return "#22c55e";
  if (pct <= 33) return "#f59e0b";
  return "#ef4444";
}
function pctText(pct: number) {
  if (pct <= 28) return "text-green-500";
  if (pct <= 33) return "text-amber-500";
  return "text-red-500";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, delta, highlight }: {
  label: string; value: string; sub?: string;
  delta?: number | null; highlight?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", highlight ?? "text-foreground")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {delta != null && (
        <div className="flex items-center gap-1 text-xs">
          {delta === 0
            ? <><Minus className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">No change</span></>
            : delta > 0
            ? <><TrendingUp className="h-3 w-3 text-red-500" /><span className="text-red-500">+{formatPercent(delta)} vs prev</span></>
            : <><TrendingDown className="h-3 w-3 text-green-500" /><span className="text-green-500">{formatPercent(delta)} vs prev</span></>
          }
        </div>
      )}
    </div>
  );
}

function PctTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.dataKey === "pct" ? formatPercent(p.value) : formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FoodCostReport() {
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reconcOpen, setReconcOpen] = useState(true);
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const isAllRestaurants = !selectedRestaurantId;
  const allRestaurantIds = restaurants.map((r) => r.id);
  const range = getRange(preset);
  const prev  = getPrev(range, preset);

  // ── Helper: build a filtered query ────────────────────────────────────────
  function scopeInvoices(from: string, to: string) {
    let q = supabase
      .from("invoices")
      .select("restaurant_id, supplier_name, amount, invoice_date")
      .gte("invoice_date", from)
      .lte("invoice_date", to);
    if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
    return q;
  }

  function scopeSales(from: string, to: string) {
    let q = supabase
      .from("sales_daily")
      .select("restaurant_id, date, net_sales, total_sales")
      .gte("date", from)
      .lte("date", to);
    if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
    return q;
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ["invoices-report", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeInvoices(range.from, range.to); if (error) throw error; return data ?? []; },
  });

  const { data: prevInvoices = [] } = useQuery({
    queryKey: ["invoices-report", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeInvoices(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  const { data: salesRows = [] } = useQuery({
    queryKey: ["sales-report", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeSales(range.from, range.to); if (error) throw error; return data ?? []; },
  });

  const { data: prevSalesRows = [] } = useQuery({
    queryKey: ["sales-report", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeSales(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  // ── Stock count queries ───────────────────────────────────────────────────
  // Returns one count per restaurant — the most recent approved count before/within the period.
  type CountRow = { id: string; restaurant_id: string; count_date: string; stock_count_lines: { total_value: number }[] };

  function latestPerRestaurant(rows: CountRow[]): CountRow[] {
    const seen = new Set<string>();
    const result: CountRow[] = [];
    for (const row of rows) {
      if (!seen.has(row.restaurant_id)) {
        seen.add(row.restaurant_id);
        result.push(row);
      }
    }
    return result;
  }

  const scopedIds = isAllRestaurants ? allRestaurantIds : selectedRestaurantId ? [selectedRestaurantId] : [];

  // Opening: most recent approved count BEFORE the period, per restaurant
  const { data: openingCounts = [] } = useQuery<CountRow[]>({
    queryKey: ["stock-count-opening", scopedIds.join(","), range.from],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_counts")
        .select("id, restaurant_id, count_date, stock_count_lines(total_value)")
        .in("restaurant_id", scopedIds)
        .eq("status", "approved")
        .lt("count_date", range.from)
        .order("count_date", { ascending: false });
      if (error) throw error;
      return latestPerRestaurant((data ?? []) as CountRow[]);
    },
    enabled: scopedIds.length > 0,
  });

  // Closing: most recent approved count within the period, per restaurant
  const { data: closingCounts = [] } = useQuery<CountRow[]>({
    queryKey: ["stock-count-closing", scopedIds.join(","), range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_counts")
        .select("id, restaurant_id, count_date, stock_count_lines(total_value)")
        .in("restaurant_id", scopedIds)
        .eq("status", "approved")
        .gte("count_date", range.from)
        .lte("count_date", range.to)
        .order("count_date", { ascending: false });
      if (error) throw error;
      return latestPerRestaurant((data ?? []) as CountRow[]);
    },
    enabled: scopedIds.length > 0,
  });

  // Convenience refs for single-restaurant view
  const openingCount = !isAllRestaurants ? (openingCounts[0] ?? null) : null;
  const closingCount = !isAllRestaurants ? (closingCounts[0] ?? null) : null;

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalCost  = useMemo(() => invoices.reduce((s: number, i: any) => s + i.amount, 0), [invoices]);
  const totalSales = useMemo(() => salesRows.reduce((s: number, r: any) => s + (r.net_sales ?? r.total_sales ?? 0), 0), [salesRows]);
  const foodCostPct = totalSales > 0 ? (totalCost / totalSales) * 100 : null;

  const prevCost  = useMemo(() => prevInvoices.reduce((s: number, i: any) => s + i.amount, 0), [prevInvoices]);
  const prevSales = useMemo(() => prevSalesRows.reduce((s: number, r: any) => s + (r.net_sales ?? r.total_sales ?? 0), 0), [prevSalesRows]);
  const prevPct   = prevSales > 0 ? (prevCost / prevSales) * 100 : null;
  const pctDelta  = foodCostPct != null && prevPct != null ? foodCostPct - prevPct : null;

  // ── Net Food Cost (stock-adjusted) ───────────────────────────────────────
  function sumCountValue(counts: CountRow[]): number {
    return counts.reduce((s, c) => s + c.stock_count_lines.reduce((ls, l) => ls + l.total_value, 0), 0);
  }

  const openingValue = useMemo(
    () => openingCounts.length > 0 ? sumCountValue(openingCounts) : null,
    [openingCounts]
  );
  const closingValue = useMemo(
    () => closingCounts.length > 0 ? sumCountValue(closingCounts) : null,
    [closingCounts]
  );
  const hasStockData = openingValue !== null && closingValue !== null;
  // Net Food Cost = Opening Stock + Purchases − Closing Stock
  const netFoodCost     = hasStockData ? openingValue! + totalCost - closingValue! : null;
  const netFoodCostPct  = netFoodCost !== null && totalSales > 0 ? (netFoodCost / totalSales) * 100 : null;
  // Projected closing = what stock should be if no shrinkage beyond invoiced purchases
  const projectedClosing = openingValue !== null ? openingValue + totalCost : null;
  // Variance: positive = stock is LOWER than projected (shrinkage/waste/theft)
  //           negative = stock is HIGHER than projected (over-counting or under-invoicing)
  const stockVariance = projectedClosing !== null && closingValue !== null
    ? projectedClosing - closingValue
    : null;

  // ── Weekly breakdown ──────────────────────────────────────────────────────
  const weeklyData = useMemo(() => {
    const from  = parseISO(range.from);
    const to    = parseISO(range.to);
    const weeks = eachWeekOfInterval({ start: from, end: to }, WEEK_OPTS);
    return weeks.map((wStart) => {
      const wEnd   = endOfWeek(wStart, WEEK_OPTS);
      const cost   = invoices.filter((i: any) => isWithinInterval(parseISO(i.invoice_date), { start: wStart, end: wEnd }))
                             .reduce((s: number, i: any) => s + i.amount, 0);
      const sales  = salesRows.filter((r: any) => isWithinInterval(parseISO(r.date), { start: wStart, end: wEnd }))
                              .reduce((s: number, r: any) => s + (r.net_sales ?? r.total_sales ?? 0), 0);
      return { week: format(wStart, "d MMM"), cost, sales, pct: sales > 0 ? (cost / sales) * 100 : null };
    });
  }, [invoices, salesRows, range]);

  // ── By Restaurant ─────────────────────────────────────────────────────────
  const restaurantData = useMemo(() => {
    if (!isAllRestaurants) return [];
    return restaurants.map((r) => {
      const cost  = invoices.filter((i: any) => i.restaurant_id === r.id).reduce((s: number, i: any) => s + i.amount, 0);
      const sales = salesRows.filter((row: any) => row.restaurant_id === r.id).reduce((s: number, row: any) => s + (row.net_sales ?? row.total_sales ?? 0), 0);
      return { name: r.name, cost, sales, pct: sales > 0 ? (cost / sales) * 100 : null };
    }).sort((a, b) => b.cost - a.cost);
  }, [isAllRestaurants, restaurants, invoices, salesRows]);

  // ── By Supplier ───────────────────────────────────────────────────────────
  const supplierData = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((i: any) => map.set(i.supplier_name, (map.get(i.supplier_name) ?? 0) + i.amount));
    return [...map.entries()]
      .map(([supplier, cost]) => ({ supplier, cost, pct: totalCost > 0 ? (cost / totalCost) * 100 : 0 }))
      .sort((a, b) => b.cost - a.cost);
  }, [invoices, totalCost]);

  const hasData = invoices.length > 0;

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {/* Mobile: compact toggle */}
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="sm:hidden inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            {PRESETS.find(p => p.value === preset)?.label ?? "This Month"}
            <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", filtersOpen && "rotate-180")} />
          </button>

          {/* Desktop: inline preset row */}
          <div className="hidden sm:flex sm:flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  preset === p.value
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile: expanded preset grid */}
        {filtersOpen && (
          <div className="sm:hidden rounded-xl border border-border bg-card p-3">
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => { setPreset(p.value); setFiltersOpen(false); }}
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs font-medium transition-colors text-center",
                    preset === p.value
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Context label */}
      {isAllRestaurants && (
        <p className="text-xs text-muted-foreground">
          Showing combined data across all restaurants.
        </p>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Gross Food Cost"
          value={formatCurrency(totalCost)}
          sub={`Purchases · ${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
        />
        <KpiCard
          label="Net Sales"
          value={totalSales > 0 ? formatCurrency(totalSales) : "—"}
          sub={totalSales === 0 ? "No sales data" : undefined}
        />
        <KpiCard
          label="Gross FC %"
          value={foodCostPct != null ? formatPercent(foodCostPct) : "—"}
          sub={`Invoices ÷ Sales · Target: ${FOOD_COST_TARGET}%`}
          delta={pctDelta}
          highlight={foodCostPct != null ? pctText(foodCostPct) : undefined}
        />
        <KpiCard
          label="vs Target"
          value={foodCostPct != null ? (foodCostPct - FOOD_COST_TARGET > 0 ? "+" : "") + formatPercent(foodCostPct - FOOD_COST_TARGET) : "—"}
          sub={foodCostPct != null ? (foodCostPct <= FOOD_COST_TARGET ? "On target" : "Over target") : undefined}
          highlight={foodCostPct != null ? (foodCostPct <= FOOD_COST_TARGET ? "text-green-500" : "text-red-500") : undefined}
        />
      </div>

      {/* Net Food Cost KPIs — shown when stock data available */}
      {hasStockData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Net Food Cost"
            value={formatCurrency(netFoodCost!)}
            sub="Opening + Purchases − Closing"
          />
          <KpiCard
            label="Net FC %"
            value={netFoodCostPct != null ? formatPercent(netFoodCostPct) : "—"}
            sub={`Target: ${FOOD_COST_TARGET}%`}
            highlight={netFoodCostPct != null ? pctText(netFoodCostPct) : undefined}
          />
          <KpiCard
            label="Stock Variance"
            value={stockVariance != null ? formatCurrency(Math.abs(stockVariance)) : "—"}
            sub={stockVariance != null
              ? stockVariance > 0 ? "↑ Projected higher than actual" : stockVariance < 0 ? "↓ More stock than expected" : "Matches projection"
              : undefined}
            highlight={stockVariance != null
              ? stockVariance > 500 ? "text-red-500" : stockVariance > 0 ? "text-amber-500" : "text-green-500"
              : undefined}
          />
          <KpiCard
            label="Closing Stock"
            value={formatCurrency(closingValue!)}
            sub={closingCount ? format(parseISO(closingCount.count_date), "d MMM yyyy") : undefined}
          />
        </div>
      )}

      {/* Stock Reconciliation panel */}
      {scopedIds.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setReconcOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Stock Reconciliation</h3>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                — Opening + Purchases − Closing = Net Food Cost
              </span>
            </div>
            {reconcOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {reconcOpen && (
            <div className="p-5 space-y-5">
              {/* Missing count warnings */}
              {openingCounts.length === 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    No approved stock count found <strong>before {format(parseISO(range.from), "d MMM yyyy")}</strong>.
                    Complete and approve a count before this period to calculate Net Food Cost.
                  </p>
                </div>
              )}
              {openingCounts.length > 0 && closingCounts.length === 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    No approved stock count found <strong>within this period</strong>.
                    Complete and approve a closing count to calculate Net Food Cost.
                  </p>
                </div>
              )}
              {isAllRestaurants && openingCounts.length > 0 && openingCounts.length < scopedIds.length && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Opening counts found for <strong>{openingCounts.length} of {scopedIds.length} restaurants</strong>.
                    Totals only include restaurants with an approved count before this period.
                  </p>
                </div>
              )}
              {isAllRestaurants && closingCounts.length > 0 && closingCounts.length < scopedIds.length && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Closing counts found for <strong>{closingCounts.length} of {scopedIds.length} restaurants</strong>.
                    Totals only include restaurants with an approved count within this period.
                  </p>
                </div>
              )}

              {/* Waterfall calculation */}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-center">
                {/* Opening Stock */}
                <div className={cn(
                  "rounded-lg border p-3 text-center",
                  openingValue !== null ? "border-border bg-muted/30" : "border-dashed border-muted-foreground/30 bg-muted/10"
                )}>
                  <p className="text-xs text-muted-foreground mb-1">Opening Stock</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">
                    {openingValue !== null ? formatCurrency(openingValue) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {openingCounts.length === 0
                      ? "No count found"
                      : isAllRestaurants
                      ? `${openingCounts.length} restaurant${openingCounts.length !== 1 ? "s" : ""}`
                      : format(parseISO(openingCounts[0].count_date), "d MMM yyyy")}
                  </p>
                </div>

                <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto shrink-0" />

                {/* Purchases */}
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">+ Purchases</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">
                    {formatCurrency(totalCost)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
                  </p>
                </div>

                <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto shrink-0" />

                {/* Closing Stock */}
                <div className={cn(
                  "rounded-lg border p-3 text-center",
                  closingValue !== null ? "border-border bg-muted/30" : "border-dashed border-muted-foreground/30 bg-muted/10"
                )}>
                  <p className="text-xs text-muted-foreground mb-1">− Closing Stock</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">
                    {closingValue !== null ? formatCurrency(closingValue) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {closingCounts.length === 0
                      ? "No count found"
                      : isAllRestaurants
                      ? `${closingCounts.length} restaurant${closingCounts.length !== 1 ? "s" : ""}`
                      : format(parseISO(closingCounts[0].count_date), "d MMM yyyy")}
                  </p>
                </div>

                <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto shrink-0" />

                {/* Net Food Cost */}
                <div className={cn(
                  "rounded-lg border p-3 text-center",
                  hasStockData
                    ? "border-primary/40 bg-primary/5"
                    : "border-dashed border-muted-foreground/30 bg-muted/10"
                )}>
                  <p className="text-xs text-muted-foreground mb-1">= Net Food Cost</p>
                  <p className={cn(
                    "text-lg font-bold tabular-nums",
                    netFoodCostPct != null ? pctText(netFoodCostPct) : "text-foreground"
                  )}>
                    {netFoodCost !== null ? formatCurrency(netFoodCost) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {netFoodCostPct != null ? `${formatPercent(netFoodCostPct)} of sales` : "—"}
                  </p>
                </div>
              </div>

              {/* Projected vs Actual */}
              {hasStockData && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      Projected vs Actual Closing Stock
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm text-foreground">Projected Closing Stock</p>
                        <p className="text-xs text-muted-foreground">Opening {formatCurrency(openingValue!)} + Purchases {formatCurrency(totalCost)}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(projectedClosing!)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm text-foreground">Actual Closing Stock</p>
                        <p className="text-xs text-muted-foreground">
                          {isAllRestaurants
                            ? `${closingCounts.length} restaurant count${closingCounts.length !== 1 ? "s" : ""}`
                            : `Count on ${format(parseISO(closingCounts[0].count_date), "d MMM yyyy")}`}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(closingValue!)}
                      </p>
                    </div>
                    <div className={cn(
                      "flex items-center justify-between px-4 py-2.5",
                      stockVariance! > 500 ? "bg-red-500/5" : stockVariance! > 0 ? "bg-amber-500/5" : "bg-green-500/5"
                    )}>
                      <div>
                        <p className={cn(
                          "text-sm font-semibold",
                          stockVariance! > 500 ? "text-red-600" : stockVariance! > 0 ? "text-amber-600" : "text-green-600"
                        )}>
                          {stockVariance! > 0 ? "Unaccounted Usage / Shrinkage" : stockVariance! < 0 ? "Stock Surplus" : "Matches Projection"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {stockVariance! > 0
                            ? "Stock is lower than projected — possible waste, theft, or unrecorded usage"
                            : stockVariance! < 0
                            ? "Stock is higher than projected — may have unrecorded purchases or over-counting"
                            : "Actual stock matches what was expected based on purchases"}
                        </p>
                      </div>
                      <p className={cn(
                        "text-sm font-bold tabular-nums",
                        stockVariance! > 500 ? "text-red-600" : stockVariance! > 0 ? "text-amber-600" : "text-green-600"
                      )}>
                        {stockVariance! > 0 ? "−" : stockVariance! < 0 ? "+" : ""}
                        {formatCurrency(Math.abs(stockVariance!))}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Per-restaurant breakdown (all-restaurants view) */}
              {isAllRestaurants && hasStockData && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      By Restaurant
                    </p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/10">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Restaurant</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Opening</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Purchases</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Closing</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Net FC</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Variance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {restaurants.map((r) => {
                        const opening = openingCounts.find((c) => c.restaurant_id === r.id);
                        const closing = closingCounts.find((c) => c.restaurant_id === r.id);
                        const rInvoices = invoices.filter((i: any) => i.restaurant_id === r.id);
                        const rSales = salesRows.filter((s: any) => s.restaurant_id === r.id);
                        const ov = opening ? opening.stock_count_lines.reduce((s, l) => s + l.total_value, 0) : null;
                        const cv = closing ? closing.stock_count_lines.reduce((s, l) => s + l.total_value, 0) : null;
                        const purchases = rInvoices.reduce((s: number, i: any) => s + i.amount, 0);
                        const sales = rSales.reduce((s: number, r: any) => s + (r.net_sales ?? r.total_sales ?? 0), 0);
                        const netFC = ov !== null && cv !== null ? ov + purchases - cv : null;
                        const projected = ov !== null ? ov + purchases : null;
                        const variance = projected !== null && cv !== null ? projected - cv : null;
                        if (ov === null && cv === null && purchases === 0) return null;
                        return (
                          <tr key={r.id} className="hover:bg-accent/20">
                            <td className="px-4 py-2.5 text-xs font-medium text-foreground">{r.name}</td>
                            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
                              {ov !== null ? formatCurrency(ov) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-foreground">
                              {purchases > 0 ? formatCurrency(purchases) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
                              {cv !== null ? formatCurrency(cv) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className={cn(
                              "px-4 py-2.5 text-xs text-right font-semibold tabular-nums",
                              netFC !== null && sales > 0 ? pctText((netFC / sales) * 100) : "text-foreground"
                            )}>
                              {netFC !== null ? formatCurrency(netFC) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className={cn(
                              "px-4 py-2.5 text-xs text-right tabular-nums",
                              variance === null ? "text-muted-foreground/40"
                                : variance > 500 ? "text-red-500 font-medium"
                                : variance > 0 ? "text-amber-500"
                                : "text-green-500"
                            )}>
                              {variance !== null
                                ? (variance > 0 ? "−" : variance < 0 ? "+" : "") + formatCurrency(Math.abs(variance))
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/30">
                        <td className="px-4 py-2.5 text-xs font-semibold text-foreground">Total</td>
                        <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(openingValue!)}</td>
                        <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(totalCost)}</td>
                        <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(closingValue!)}</td>
                        <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums",
                          netFoodCostPct != null ? pctText(netFoodCostPct) : "text-foreground")}>
                          {netFoodCost !== null ? formatCurrency(netFoodCost) : "—"}
                        </td>
                        <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums",
                          stockVariance! > 500 ? "text-red-500" : stockVariance! > 0 ? "text-amber-500" : "text-green-500")}>
                          {stockVariance !== null
                            ? (stockVariance > 0 ? "−" : stockVariance < 0 ? "+" : "") + formatCurrency(Math.abs(stockVariance))
                            : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Gross vs Net comparison (when both available) */}
              {hasStockData && totalSales > 0 && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground mb-1">Gross FC % <span className="text-muted-foreground/60">(invoices only)</span></p>
                    <p className={cn("text-xl font-bold tabular-nums", foodCostPct != null ? pctText(foodCostPct) : "text-foreground")}>
                      {foodCostPct != null ? formatPercent(foodCostPct) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{formatCurrency(totalCost)} ÷ {formatCurrency(totalSales)}</p>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Net FC % <span className="text-muted-foreground/60">(stock-adjusted)</span></p>
                    <p className={cn("text-xl font-bold tabular-nums", netFoodCostPct != null ? pctText(netFoodCostPct) : "text-foreground")}>
                      {netFoodCostPct != null ? formatPercent(netFoodCostPct) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{formatCurrency(netFoodCost!)} ÷ {formatCurrency(totalSales)}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {invLoading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      )}

      {!invLoading && !hasData && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No invoices for this period</p>
          <p className="text-xs text-muted-foreground">Add invoices in Admin → Invoices to start tracking food cost.</p>
        </div>
      )}

      {!invLoading && hasData && (
        <>
          {/* Weekly trend chart */}
          {weeklyData.length > 1 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Food Cost % by Week</h3>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weeklyData} barSize={32} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={40} domain={[0, "auto"]} />
                  <Tooltip content={<PctTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <ReferenceLine y={FOOD_COST_TARGET} stroke="#f97316" strokeDasharray="4 4"
                    label={{ value: `${FOOD_COST_TARGET}% target`, position: "insideTopRight", fontSize: 10, fill: "#f97316" }} />
                  <Bar dataKey="pct" name="Food Cost %" radius={[4, 4, 0, 0]}>
                    {weeklyData.map((entry, i) => (
                      <Cell key={i} fill={entry.pct != null ? pctColour(entry.pct) : "hsl(var(--muted))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left panel: By Restaurant (all view) OR Weekly Breakdown (single) */}
            {isAllRestaurants ? (
              /* ── By Restaurant ── */
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Store className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">By Restaurant</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Restaurant</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Invoices</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Sales</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">FC %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {restaurantData.map((row) => (
                      <tr key={row.name}>
                        <td className="px-4 py-2.5 text-xs font-medium text-foreground">{row.name}</td>
                        <td className="px-4 py-2.5 text-xs text-right tabular-nums text-foreground">
                          {row.cost > 0 ? formatCurrency(row.cost) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">
                          {row.sales > 0 ? formatCurrency(row.sales) : "—"}
                        </td>
                        <td className={cn("px-4 py-2.5 text-xs text-right font-semibold tabular-nums",
                          row.pct != null ? pctText(row.pct) : "text-muted-foreground")}>
                          {row.pct != null ? formatPercent(row.pct) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td className="px-4 py-2.5 text-xs font-semibold text-foreground">All Restaurants</td>
                      <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(totalCost)}</td>
                      <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-muted-foreground">{totalSales > 0 ? formatCurrency(totalSales) : "—"}</td>
                      <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums",
                        foodCostPct != null ? pctText(foodCostPct) : "text-muted-foreground")}>
                        {foodCostPct != null ? formatPercent(foodCostPct) : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              /* ── Weekly Breakdown ── */
              weeklyData.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">Weekly Breakdown</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Week</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Invoices</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Sales</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">FC %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {weeklyData.map((row, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2.5 text-xs text-foreground">{row.week}</td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums text-foreground">{row.cost > 0 ? formatCurrency(row.cost) : "—"}</td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{row.sales > 0 ? formatCurrency(row.sales) : "—"}</td>
                          <td className={cn("px-4 py-2.5 text-xs text-right font-semibold tabular-nums",
                            row.pct != null ? pctText(row.pct) : "text-muted-foreground")}>
                            {row.pct != null ? formatPercent(row.pct) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {weeklyData.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-border bg-muted/30">
                          <td className="px-4 py-2.5 text-xs font-semibold text-foreground">Total</td>
                          <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(totalCost)}</td>
                          <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-muted-foreground">{totalSales > 0 ? formatCurrency(totalSales) : "—"}</td>
                          <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums",
                            foodCostPct != null ? pctText(foodCostPct) : "text-muted-foreground")}>
                            {foodCostPct != null ? formatPercent(foodCostPct) : "—"}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )
            )}

            {/* Right panel: By Supplier (always) */}
            {supplierData.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">By Supplier</h3>
                </div>
                <div className="p-4 space-y-3">
                  {supplierData.map((s) => (
                    <div key={s.supplier}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-foreground truncate max-w-[160px]">{s.supplier}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">{formatPercent(s.pct)}</span>
                          <span className="text-xs font-medium tabular-nums text-foreground">{formatCurrency(s.cost)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${s.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground">{supplierData.length} supplier{supplierData.length !== 1 ? "s" : ""}</span>
                  <span className="text-xs font-bold tabular-nums text-foreground">{formatCurrency(totalCost)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
