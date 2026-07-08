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
  addWeeks,
  addMonths,
  addQuarters,
  addYears,
  eachWeekOfInterval,
  isWithinInterval,
} from "date-fns";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Receipt,
  Users,
  Store,
  Wallet,
  PiggyBank,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Layers,
  Landmark,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_OPTS = { weekStartsOn: 1 as const };
const COGS_TARGET = 30; // % of revenue
const LABOUR_TARGET = 30; // % of revenue
const MARGIN_TARGET = 100 - COGS_TARGET - LABOUR_TARGET; // 40% operating (prime cost) margin target
const NET_MARGIN_TARGET = 10; // % of revenue, typical restaurant net margin target after overheads

type Preset = "thisWeek" | "lastWeek" | "thisMonth" | "last30" | "last3m";
interface DateRange { from: string; to: string }

const PRESETS: { label: string; value: Preset }[] = [
  { label: "This Week", value: "thisWeek" },
  { label: "Last Week", value: "lastWeek" },
  { label: "This Month", value: "thisMonth" },
  { label: "Last 30 Days", value: "last30" },
  { label: "Last 3 Months", value: "last3m" },
];

function fmt(d: Date) { return format(d, "yyyy-MM-dd"); }

function getRange(preset: Preset): DateRange {
  const today = new Date();
  switch (preset) {
    // Week/month "to date" — bounded at today, not the end of the calendar period,
    // so the comparison periods below line up day-for-day instead of partial vs full.
    case "thisWeek": return { from: fmt(startOfWeek(today, WEEK_OPTS)), to: fmt(today) };
    case "lastWeek": {
      const lw = subWeeks(today, 1);
      return { from: fmt(startOfWeek(lw, WEEK_OPTS)), to: fmt(endOfWeek(lw, WEEK_OPTS)) };
    }
    case "thisMonth": return { from: fmt(startOfMonth(today)), to: fmt(today) };
    case "last30": return { from: fmt(subDays(today, 29)), to: fmt(today) };
    case "last3m": return { from: fmt(subMonths(today, 3)), to: fmt(today) };
  }
}

// For "this week"/"this month" (in-progress periods), shift by a calendar week/month
// so the comparison covers the same elapsed days (e.g. 1st–7th vs 1st–7th last month),
// not a full previous period. Other presets are already complete periods of fixed
// length, so shifting by that same day-count remains a valid apples-to-apples comparison.
function getPrev(range: DateRange, preset: Preset): DateRange {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  if (preset === "thisWeek") return { from: fmt(subWeeks(from, 1)), to: fmt(subWeeks(to, 1)) };
  if (preset === "thisMonth") return { from: fmt(subMonths(from, 1)), to: fmt(subMonths(to, 1)) };
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  return { from: fmt(subDays(from, days)), to: fmt(subDays(from, 1)) };
}

// ─── Recurring expense occurrences ───────────────────────────────────────────
// Regular expenses (rent, utilities, insurance) are stored as templates, not
// one row per period — occurrences within any date range are computed on the fly.

type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
interface RecurringExpenseRow {
  id: string;
  restaurant_id: string;
  name: string;
  category: string | null;
  amount: number;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  active: boolean;
}

function addByFrequency(date: Date, frequency: Frequency, n: number): Date {
  switch (frequency) {
    case "weekly": return addWeeks(date, n);
    case "monthly": return addMonths(date, n);
    case "quarterly": return addQuarters(date, n);
    case "yearly": return addYears(date, n);
  }
}

function countOccurrences(startDate: Date, endDate: Date | null, frequency: Frequency, rangeFrom: Date, rangeTo: Date): number {
  if (startDate > rangeTo) return 0;
  if (endDate && endDate < rangeFrom) return 0;
  let count = 0;
  for (let i = 0; i < 2000; i++) {
    const occurrence = addByFrequency(startDate, frequency, i);
    if (occurrence > rangeTo) break;
    if (occurrence >= rangeFrom && (!endDate || occurrence <= endDate)) count++;
  }
  return count;
}

function recurringAmountInRange(templates: RecurringExpenseRow[], from: Date, to: Date, restaurantId?: string): number {
  return templates
    .filter((t) => t.active && (!restaurantId || t.restaurant_id === restaurantId))
    .reduce((sum, t) => {
      const start = parseISO(t.start_date);
      const end = t.end_date ? parseISO(t.end_date) : null;
      return sum + countOccurrences(start, end, t.frequency, from, to) * t.amount;
    }, 0);
}

// ─── Colour helpers ───────────────────────────────────────────────────────────
// Cost ratios: lower is better.
function costText(pct: number, target: number) {
  if (pct <= target) return "text-green-500";
  if (pct <= target + 5) return "text-amber-500";
  return "text-red-500";
}
// Margin: higher is better.
function marginText(pct: number) {
  if (pct >= MARGIN_TARGET) return "text-green-500";
  if (pct >= MARGIN_TARGET - 10) return "text-amber-500";
  return "text-red-500";
}
// Net margin (after overheads) uses a lower, more realistic benchmark.
function netMarginText(pct: number) {
  if (pct >= NET_MARGIN_TARGET) return "text-green-500";
  if (pct >= NET_MARGIN_TARGET - 5) return "text-amber-500";
  return "text-red-500";
}
function netMarginColour(pct: number) {
  if (pct >= NET_MARGIN_TARGET) return "#22c55e";
  if (pct >= NET_MARGIN_TARGET - 5) return "#f59e0b";
  return "#ef4444";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, delta, deltaGoodDirection = "down", highlight }: {
  label: string; value: string; sub?: string;
  delta?: number | null; deltaGoodDirection?: "down" | "up"; highlight?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", highlight ?? "text-foreground")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {delta != null && (
        <div className="flex items-center gap-1 text-xs">
          {delta === 0 ? (
            <><Minus className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">No change</span></>
          ) : (() => {
            const isGood = deltaGoodDirection === "down" ? delta < 0 : delta > 0;
            const Icon = delta > 0 ? TrendingUp : TrendingDown;
            return (
              <>
                <Icon className={cn("h-3 w-3", isGood ? "text-green-500" : "text-red-500")} />
                <span className={isGood ? "text-green-500" : "text-red-500"}>
                  {delta > 0 ? "+" : ""}{formatPercent(delta)} vs prev
                </span>
              </>
            );
          })()}
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
          {p.name}: {p.dataKey === "margin" ? formatPercent(p.value) : formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

function StatementRow({ label, value, sub, indent = false, bold = false, negative = false, tone }: {
  label: string; value: string; sub?: string; indent?: boolean; bold?: boolean; negative?: boolean;
  tone?: string;
}) {
  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-2.5",
      bold && "bg-muted/30 border-t border-border"
    )}>
      <div className={cn(indent && "pl-4")}>
        <p className={cn("text-sm", bold ? "font-semibold text-foreground" : "text-foreground/90")}>
          {label}
        </p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <p className={cn(
        "text-sm tabular-nums",
        bold ? "font-bold" : "font-medium",
        tone ?? (negative ? "text-red-500" : "text-foreground")
      )}>
        {negative && value !== "—" ? `− ${value}` : value}
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PnLReport() {
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(true);
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const isAllRestaurants = !selectedRestaurantId;
  const allRestaurantIds = restaurants.map((r) => r.id);
  const scopedIds = isAllRestaurants ? allRestaurantIds : selectedRestaurantId ? [selectedRestaurantId] : [];
  const range = getRange(preset);
  const prev = getPrev(range, preset);

  // ── Helpers: scoped queries ─────────────────────────────────────────────────
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
      .select("restaurant_id, date, total_sales, net_sales")
      .gte("date", from)
      .lte("date", to);
    if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
    return q;
  }
  function scopeLabour(from: string, to: string) {
    let q = supabase
      .from("labour_daily")
      .select("restaurant_id, date, total_cost, total_hours")
      .gte("date", from)
      .lte("date", to);
    if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
    return q;
  }
  function scopeExpenses(from: string, to: string) {
    let q = supabase
      .from("expenses")
      .select("restaurant_id, category, description, amount, expense_date")
      .gte("expense_date", from)
      .lte("expense_date", to);
    if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
    return q;
  }

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ["pnl-invoices", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeInvoices(range.from, range.to); if (error) throw error; return data ?? []; },
  });
  const { data: prevInvoices = [] } = useQuery({
    queryKey: ["pnl-invoices", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeInvoices(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  const { data: salesRows = [], isLoading: salesLoading } = useQuery({
    queryKey: ["pnl-sales", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeSales(range.from, range.to); if (error) throw error; return data ?? []; },
  });
  const { data: prevSalesRows = [] } = useQuery({
    queryKey: ["pnl-sales", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeSales(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  const { data: labourRows = [], isLoading: labourLoading } = useQuery({
    queryKey: ["pnl-labour", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeLabour(range.from, range.to); if (error) throw error; return data ?? []; },
  });
  const { data: prevLabourRows = [] } = useQuery({
    queryKey: ["pnl-labour", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeLabour(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  const { data: oneOffExpenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ["pnl-expenses", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeExpenses(range.from, range.to); if (error) throw error; return data ?? []; },
  });
  const { data: prevOneOffExpenses = [] } = useQuery({
    queryKey: ["pnl-expenses", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeExpenses(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  const { data: recurringExpenses = [], isLoading: recurringLoading } = useQuery<RecurringExpenseRow[]>({
    queryKey: ["pnl-recurring-expenses", scopedIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_expenses")
        .select("id, restaurant_id, name, category, amount, frequency, start_date, end_date, active")
        .in("restaurant_id", scopedIds)
        .eq("active", true);
      if (error) throw error;
      return (data ?? []) as RecurringExpenseRow[];
    },
    enabled: scopedIds.length > 0,
  });

  // Supplier category map — used to break purchases down by category
  const { data: suppliers = [] } = useQuery({
    queryKey: ["pnl-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("name, category");
      if (error) throw error;
      return (data ?? []) as { name: string; category: string | null }[];
    },
  });
  const categoryByName = useMemo(() => {
    const map = new Map<string, string>();
    suppliers.forEach((s) => map.set(s.name.trim().toLowerCase(), s.category?.trim() || "Uncategorised"));
    return map;
  }, [suppliers]);

  // Stock counts — used to sharpen COGS to a stock-adjusted figure when available
  type CountRow = { id: string; restaurant_id: string; count_date: string; stock_count_lines: { total_value: number }[] };
  function latestPerRestaurant(rows: CountRow[]): CountRow[] {
    const seen = new Set<string>();
    const result: CountRow[] = [];
    for (const row of rows) {
      if (!seen.has(row.restaurant_id)) { seen.add(row.restaurant_id); result.push(row); }
    }
    return result;
  }
  const { data: openingCounts = [] } = useQuery<CountRow[]>({
    queryKey: ["pnl-stock-opening", scopedIds.join(","), range.from],
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
  const { data: closingCounts = [] } = useQuery<CountRow[]>({
    queryKey: ["pnl-stock-closing", scopedIds.join(","), range.from, range.to],
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

  function sumCountValue(counts: CountRow[]): number {
    return counts.reduce((s, c) => s + c.stock_count_lines.reduce((ls, l) => ls + l.total_value, 0), 0);
  }
  const openingValue = openingCounts.length > 0 ? sumCountValue(openingCounts) : null;
  const closingValue = closingCounts.length > 0 ? sumCountValue(closingCounts) : null;
  const hasStockData = openingValue !== null && closingValue !== null;

  // ── Totals ────────────────────────────────────────────────────────────────
  const grossSales = useMemo(() => salesRows.reduce((s: number, r: any) => s + Number(r.total_sales ?? 0), 0), [salesRows]);
  const revenue = useMemo(() => salesRows.reduce((s: number, r: any) => s + Number(r.net_sales ?? r.total_sales ?? 0), 0), [salesRows]);

  const purchases = useMemo(() => invoices.reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0), [invoices]);
  const labourCost = useMemo(() => labourRows.reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0), [labourRows]);

  const cogs = hasStockData ? openingValue! + purchases - closingValue! : purchases;
  const cogsPct = revenue > 0 ? (cogs / revenue) * 100 : null;
  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : null;

  const labourPct = revenue > 0 ? (labourCost / revenue) * 100 : null;
  const operatingProfit = grossProfit - labourCost;
  const operatingMarginPct = revenue > 0 ? (operatingProfit / revenue) * 100 : null;
  const primeCostPct = cogsPct != null && labourPct != null ? cogsPct + labourPct : null;

  // Overhead expenses (one-off + recurring templates from Admin → Expenses)
  const oneOffOverhead = useMemo(() => oneOffExpenses.reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0), [oneOffExpenses]);
  const recurringOverhead = useMemo(
    () => recurringAmountInRange(recurringExpenses, parseISO(range.from), parseISO(range.to)),
    [recurringExpenses, range]
  );
  const totalOverheads = oneOffOverhead + recurringOverhead;
  const overheadPct = revenue > 0 ? (totalOverheads / revenue) * 100 : null;

  const netProfit = operatingProfit - totalOverheads;
  const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : null;

  // Previous period comparisons (gross purchases — stock counts not diffed per prior period)
  const prevRevenue = useMemo(() => prevSalesRows.reduce((s: number, r: any) => s + Number(r.net_sales ?? r.total_sales ?? 0), 0), [prevSalesRows]);
  const prevPurchases = useMemo(() => prevInvoices.reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0), [prevInvoices]);
  const prevLabourCost = useMemo(() => prevLabourRows.reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0), [prevLabourRows]);
  const prevOperatingProfit = prevRevenue - prevPurchases - prevLabourCost;
  const prevOperatingMarginPct = prevRevenue > 0 ? (prevOperatingProfit / prevRevenue) * 100 : null;
  const marginDelta = operatingMarginPct != null && prevOperatingMarginPct != null ? operatingMarginPct - prevOperatingMarginPct : null;
  const revenueDelta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;

  const prevOneOffOverhead = useMemo(() => prevOneOffExpenses.reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0), [prevOneOffExpenses]);
  const prevRecurringOverhead = useMemo(
    () => recurringAmountInRange(recurringExpenses, parseISO(prev.from), parseISO(prev.to)),
    [recurringExpenses, prev]
  );
  const prevTotalOverheads = prevOneOffOverhead + prevRecurringOverhead;
  const prevNetProfit = prevOperatingProfit - prevTotalOverheads;
  const prevNetMarginPct = prevRevenue > 0 ? (prevNetProfit / prevRevenue) * 100 : null;
  const netMarginDelta = netMarginPct != null && prevNetMarginPct != null ? netMarginPct - prevNetMarginPct : null;

  // ── Weekly trend ─────────────────────────────────────────────────────────────
  const weeklyData = useMemo(() => {
    const from = parseISO(range.from);
    const to = parseISO(range.to);
    const weeks = eachWeekOfInterval({ start: from, end: to }, WEEK_OPTS);
    return weeks.map((wStart) => {
      const wEnd = endOfWeek(wStart, WEEK_OPTS);
      const wRevenue = salesRows.filter((r: any) => isWithinInterval(parseISO(r.date), { start: wStart, end: wEnd }))
        .reduce((s: number, r: any) => s + Number(r.net_sales ?? r.total_sales ?? 0), 0);
      const wPurchases = invoices.filter((i: any) => isWithinInterval(parseISO(i.invoice_date), { start: wStart, end: wEnd }))
        .reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0);
      const wLabour = labourRows.filter((r: any) => isWithinInterval(parseISO(r.date), { start: wStart, end: wEnd }))
        .reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0);
      const wOneOffOverhead = oneOffExpenses.filter((e: any) => isWithinInterval(parseISO(e.expense_date), { start: wStart, end: wEnd }))
        .reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);
      const wOverhead = wOneOffOverhead + recurringAmountInRange(recurringExpenses, wStart, wEnd);
      const wProfit = wRevenue - wPurchases - wLabour - wOverhead;
      return {
        week: format(wStart, "d MMM"),
        revenue: wRevenue,
        purchases: wPurchases,
        labour: wLabour,
        overhead: wOverhead,
        profit: wProfit,
        margin: wRevenue > 0 ? (wProfit / wRevenue) * 100 : null,
      };
    });
  }, [salesRows, invoices, labourRows, oneOffExpenses, recurringExpenses, range]);

  // ── By restaurant (all-view) ──────────────────────────────────────────────────
  const restaurantData = useMemo(() => {
    if (!isAllRestaurants) return [];
    return restaurants.map((r) => {
      const rRevenue = salesRows.filter((row: any) => row.restaurant_id === r.id).reduce((s: number, row: any) => s + Number(row.net_sales ?? row.total_sales ?? 0), 0);
      const rPurchases = invoices.filter((i: any) => i.restaurant_id === r.id).reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0);
      const rLabour = labourRows.filter((row: any) => row.restaurant_id === r.id).reduce((s: number, row: any) => s + Number(row.total_cost ?? 0), 0);
      const rOneOffOverhead = oneOffExpenses.filter((e: any) => e.restaurant_id === r.id).reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);
      const rOverhead = rOneOffOverhead + recurringAmountInRange(recurringExpenses, parseISO(range.from), parseISO(range.to), r.id);
      const rProfit = rRevenue - rPurchases - rLabour - rOverhead;
      return {
        name: r.name,
        revenue: rRevenue,
        purchases: rPurchases,
        labour: rLabour,
        overhead: rOverhead,
        profit: rProfit,
        margin: rRevenue > 0 ? (rProfit / rRevenue) * 100 : null,
      };
    }).filter((row) => row.revenue > 0 || row.purchases > 0 || row.labour > 0 || row.overhead > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [isAllRestaurants, restaurants, salesRows, invoices, labourRows, oneOffExpenses, recurringExpenses, range]);

  // ── COGS by category ───────────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((i: any) => {
      const cat = categoryByName.get(i.supplier_name.trim().toLowerCase()) ?? "Uncategorised";
      map.set(cat, (map.get(cat) ?? 0) + Number(i.amount ?? 0));
    });
    return [...map.entries()]
      .map(([category, cost]) => ({ category, cost, pct: purchases > 0 ? (cost / purchases) * 100 : 0 }))
      .sort((a, b) => b.cost - a.cost);
  }, [invoices, categoryByName, purchases]);

  // ── Overheads by category (one-off + recurring, prorated to the period) ────
  const overheadCategoryData = useMemo(() => {
    const map = new Map<string, number>();
    oneOffExpenses.forEach((e: any) => {
      const cat = e.category?.trim() || "Uncategorised";
      map.set(cat, (map.get(cat) ?? 0) + Number(e.amount ?? 0));
    });
    recurringExpenses.forEach((t) => {
      const start = parseISO(t.start_date);
      const end = t.end_date ? parseISO(t.end_date) : null;
      const occurrences = countOccurrences(start, end, t.frequency, parseISO(range.from), parseISO(range.to));
      if (occurrences === 0) return;
      const cat = t.category?.trim() || "Uncategorised";
      map.set(cat, (map.get(cat) ?? 0) + occurrences * t.amount);
    });
    return [...map.entries()]
      .map(([category, cost]) => ({ category, cost, pct: totalOverheads > 0 ? (cost / totalOverheads) * 100 : 0 }))
      .sort((a, b) => b.cost - a.cost);
  }, [oneOffExpenses, recurringExpenses, range, totalOverheads]);

  const isLoading = invLoading || salesLoading || labourLoading || expensesLoading || recurringLoading;
  const hasData = revenue > 0 || purchases > 0 || labourCost > 0 || totalOverheads > 0;

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="sm:hidden inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            {PRESETS.find((p) => p.value === preset)?.label ?? "This Month"}
            <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", filtersOpen && "rotate-180")} />
          </button>

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

      {isAllRestaurants && (
        <p className="text-xs text-muted-foreground">
          Showing combined data across all restaurants — {format(parseISO(range.from), "d MMM")} to {format(parseISO(range.to), "d MMM yyyy")}.
        </p>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Revenue"
          value={formatCurrency(revenue)}
          sub={`Net sales · ${salesRows.length} day${salesRows.length !== 1 ? "s" : ""}`}
          delta={revenueDelta}
          deltaGoodDirection="up"
        />
        <KpiCard
          label={hasStockData ? "Net COGS" : "COGS (Purchases)"}
          value={formatCurrency(cogs)}
          sub={hasStockData ? "Stock-adjusted · Opening + Purchases − Closing" : `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
          highlight={cogsPct != null ? costText(cogsPct, COGS_TARGET) : undefined}
        />
        <KpiCard
          label="Gross Profit"
          value={formatCurrency(grossProfit)}
          sub={grossMarginPct != null ? `${formatPercent(grossMarginPct)} margin` : undefined}
          highlight={grossMarginPct != null ? marginText(grossMarginPct) : undefined}
        />
        <KpiCard
          label="Labour Cost"
          value={formatCurrency(labourCost)}
          sub={labourPct != null ? `${formatPercent(labourPct)} of revenue` : undefined}
          highlight={labourPct != null ? costText(labourPct, LABOUR_TARGET) : undefined}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Prime Cost %"
          value={primeCostPct != null ? formatPercent(primeCostPct) : "—"}
          sub={`COGS + Labour · Target ≤ ${COGS_TARGET + LABOUR_TARGET}%`}
          highlight={primeCostPct != null ? costText(primeCostPct, COGS_TARGET + LABOUR_TARGET) : undefined}
        />
        <KpiCard
          label="Operating Profit"
          value={formatCurrency(operatingProfit)}
          sub="Revenue − COGS − Labour"
          highlight={operatingProfit >= 0 ? "text-green-500" : "text-red-500"}
        />
        <KpiCard
          label="Operating Margin"
          value={operatingMarginPct != null ? formatPercent(operatingMarginPct) : "—"}
          sub={`Target ≥ ${MARGIN_TARGET}%`}
          delta={marginDelta}
          deltaGoodDirection="up"
          highlight={operatingMarginPct != null ? marginText(operatingMarginPct) : undefined}
        />
        <KpiCard
          label="Overhead Expenses"
          value={formatCurrency(totalOverheads)}
          sub={overheadPct != null ? `${formatPercent(overheadPct)} of revenue · Admin → Expenses` : "Admin → Expenses"}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          label="Net Profit"
          value={formatCurrency(netProfit)}
          sub="Operating Profit − Overheads"
          highlight={netProfit >= 0 ? "text-green-500" : "text-red-500"}
        />
        <KpiCard
          label="Net Margin"
          value={netMarginPct != null ? formatPercent(netMarginPct) : "—"}
          sub={`Target ≥ ${NET_MARGIN_TARGET}%`}
          delta={netMarginDelta}
          deltaGoodDirection="up"
          highlight={netMarginPct != null ? netMarginText(netMarginPct) : undefined}
        />
        <KpiCard
          label="Avg Daily Net Profit"
          value={salesRows.length > 0 ? formatCurrency(netProfit / salesRows.length) : "—"}
          sub="Net profit ÷ trading days"
        />
      </div>

      {/* P&L Statement */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setStatementOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">P&amp;L Statement</h3>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              — {format(parseISO(range.from), "d MMM")} to {format(parseISO(range.to), "d MMM yyyy")}
            </span>
          </div>
          {statementOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {statementOpen && (
          <div className="divide-y divide-border">
            <StatementRow label="Gross Sales" value={formatCurrency(grossSales)} />
            <StatementRow label="Revenue (Net Sales)" value={formatCurrency(revenue)} bold />

            <StatementRow
              label={hasStockData ? "Net Cost of Goods Sold" : "Cost of Goods Sold"}
              sub={hasStockData ? "Opening stock + purchases − closing stock" : "From invoices entered in Admin → Invoices"}
              value={formatCurrency(cogs)}
              negative
              tone={cogsPct != null ? costText(cogsPct, COGS_TARGET) : undefined}
            />
            <StatementRow
              label="Gross Profit"
              sub={grossMarginPct != null ? `${formatPercent(grossMarginPct)} margin` : undefined}
              value={formatCurrency(grossProfit)}
              bold
              tone={grossMarginPct != null ? marginText(grossMarginPct) : undefined}
            />

            <StatementRow
              label="Labour Cost"
              sub="From rostered/actual hours in Labour reports"
              value={formatCurrency(labourCost)}
              negative
              tone={labourPct != null ? costText(labourPct, LABOUR_TARGET) : undefined}
            />
            <StatementRow
              label="Operating Profit"
              sub={operatingMarginPct != null ? `${formatPercent(operatingMarginPct)} margin · Prime Cost basis` : undefined}
              value={formatCurrency(operatingProfit)}
              bold
              tone={operatingMarginPct != null ? marginText(operatingMarginPct) : undefined}
            />

            <StatementRow
              label="Overhead Expenses"
              sub="One-off + recurring expenses from Admin → Expenses"
              value={formatCurrency(totalOverheads)}
              negative
            />
            <StatementRow
              label="Net Profit"
              sub={netMarginPct != null ? `${formatPercent(netMarginPct)} margin` : undefined}
              value={formatCurrency(netProfit)}
              bold
              tone={netProfit >= 0 ? "text-green-500" : "text-red-500"}
            />
          </div>
        )}

        <div className="px-4 py-2.5 bg-muted/20 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            {totalOverheads > 0 || recurringExpenses.length > 0
              ? "Reflects sales, purchases, labour and overhead expenses tracked in the Coop."
              : "Reflects sales, purchases and labour tracked in the Coop. Add rent, utilities, insurance and other overheads in Admin → Expenses for a complete Net Profit figure — until then, Net Profit equals Operating Profit."}
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      )}

      {!isLoading && !hasData && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <PiggyBank className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No data for this period</p>
          <p className="text-xs text-muted-foreground">
            Add sales, labour, invoices and expenses to start building a live P&amp;L.
          </p>
        </div>
      )}

      {!isLoading && hasData && (
        <>
          {/* Weekly trend chart */}
          {weeklyData.length > 1 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Net Margin % by Week</h3>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weeklyData} barSize={32} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<PctTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <ReferenceLine y={NET_MARGIN_TARGET} stroke="#f97316" strokeDasharray="4 4"
                    label={{ value: `${NET_MARGIN_TARGET}% target`, position: "insideTopRight", fontSize: 10, fill: "#f97316" }} />
                  <Bar dataKey="margin" name="Net Margin %" radius={[4, 4, 0, 0]}>
                    {weeklyData.map((entry, i) => (
                      <Cell key={i} fill={entry.margin != null ? netMarginColour(entry.margin) : "hsl(var(--muted))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left panel: By Restaurant (all view) OR Weekly Breakdown (single) */}
            {isAllRestaurants ? (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Store className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">By Restaurant</h3>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Restaurant</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Revenue</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">COGS</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Labour</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Overhead</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Net Profit</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {restaurantData.map((row) => (
                      <tr key={row.name}>
                        <td className="px-4 py-2.5 text-xs font-medium text-foreground">{row.name}</td>
                        <td className="px-4 py-2.5 text-xs text-right tabular-nums text-foreground">{formatCurrency(row.revenue)}</td>
                        <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(row.purchases)}</td>
                        <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(row.labour)}</td>
                        <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(row.overhead)}</td>
                        <td className={cn("px-4 py-2.5 text-xs text-right font-semibold tabular-nums", row.profit >= 0 ? "text-green-500" : "text-red-500")}>
                          {formatCurrency(row.profit)}
                        </td>
                        <td className={cn("px-4 py-2.5 text-xs text-right font-semibold tabular-nums", row.margin != null ? netMarginText(row.margin) : "text-muted-foreground")}>
                          {row.margin != null ? formatPercent(row.margin) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td className="px-4 py-2.5 text-xs font-semibold text-foreground">All Restaurants</td>
                      <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(revenue)}</td>
                      <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(purchases)}</td>
                      <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(labourCost)}</td>
                      <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(totalOverheads)}</td>
                      <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums", netProfit >= 0 ? "text-green-500" : "text-red-500")}>
                        {formatCurrency(netProfit)}
                      </td>
                      <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums", netMarginPct != null ? netMarginText(netMarginPct) : "text-muted-foreground")}>
                        {netMarginPct != null ? formatPercent(netMarginPct) : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </div>
            ) : (
              weeklyData.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                    <Wallet className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">Weekly Breakdown</h3>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Week</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Revenue</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">COGS</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Labour</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Overhead</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Net Profit</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {weeklyData.map((row, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2.5 text-xs text-foreground">{row.week}</td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums text-foreground">{formatCurrency(row.revenue)}</td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(row.purchases)}</td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(row.labour)}</td>
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(row.overhead)}</td>
                          <td className={cn("px-4 py-2.5 text-xs text-right font-semibold tabular-nums", row.profit >= 0 ? "text-green-500" : "text-red-500")}>
                            {formatCurrency(row.profit)}
                          </td>
                          <td className={cn("px-4 py-2.5 text-xs text-right font-semibold tabular-nums", row.margin != null ? netMarginText(row.margin) : "text-muted-foreground")}>
                            {row.margin != null ? formatPercent(row.margin) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {weeklyData.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-border bg-muted/30">
                          <td className="px-4 py-2.5 text-xs font-semibold text-foreground">Total</td>
                          <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(revenue)}</td>
                          <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(purchases)}</td>
                          <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(labourCost)}</td>
                          <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground">{formatCurrency(totalOverheads)}</td>
                          <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums", netProfit >= 0 ? "text-green-500" : "text-red-500")}>
                            {formatCurrency(netProfit)}
                          </td>
                          <td className={cn("px-4 py-2.5 text-xs text-right font-bold tabular-nums", netMarginPct != null ? netMarginText(netMarginPct) : "text-muted-foreground")}>
                            {netMarginPct != null ? formatPercent(netMarginPct) : "—"}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  </div>
                </div>
              )
            )}

            {/* Right panel: COGS by category */}
            {categoryData.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Receipt className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Purchases by Category</h3>
                </div>
                <div className="p-4 space-y-3">
                  {categoryData.map((c) => (
                    <div key={c.category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-foreground truncate max-w-[160px]">{c.category}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">{formatPercent(c.pct)}</span>
                          <span className="text-xs font-medium tabular-nums text-foreground">{formatCurrency(c.cost)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${c.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground">{categoryData.length} categor{categoryData.length !== 1 ? "ies" : "y"}</span>
                  <span className="text-xs font-bold tabular-nums text-foreground">{formatCurrency(purchases)}</span>
                </div>
              </div>
            )}

            {/* Overheads by category */}
            {overheadCategoryData.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Landmark className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Overheads by Category</h3>
                </div>
                <div className="p-4 space-y-3">
                  {overheadCategoryData.map((c) => (
                    <div key={c.category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-foreground truncate max-w-[160px]">{c.category}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">{formatPercent(c.pct)}</span>
                          <span className="text-xs font-medium tabular-nums text-foreground">{formatCurrency(c.cost)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${c.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground">{overheadCategoryData.length} categor{overheadCategoryData.length !== 1 ? "ies" : "y"}</span>
                  <span className="text-xs font-bold tabular-nums text-foreground">{formatCurrency(totalOverheads)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Labour by day count (fallback context when no COGS/labour breakdown exists) */}
          {labourRows.length === 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No labour data for this period — Net Profit currently only deducts COGS and overheads.
                Add labour figures in Reports → Labour or via manual entry for a complete P&amp;L.
              </p>
            </div>
          )}
          {oneOffExpenses.length === 0 && recurringExpenses.length === 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No overhead expenses recorded — Net Profit currently equals Operating Profit.
                Add rent, utilities, insurance and other overheads in Admin → Expenses for a complete P&amp;L.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
