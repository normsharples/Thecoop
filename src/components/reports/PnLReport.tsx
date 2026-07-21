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
  ChevronRight,
  SlidersHorizontal,
  Layers,
  Landmark,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { canonicalCategory, OVERHEAD_NODES, CAT, type PnlNode } from "@/lib/pnlCategories";

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_OPTS = { weekStartsOn: 1 as const };
const COGS_TARGET = 30; // % of revenue
const LABOUR_TARGET = 30; // % of revenue
const MARGIN_TARGET = 100 - COGS_TARGET - LABOUR_TARGET; // 40% operating (prime cost) margin target
const NET_MARGIN_TARGET = 10; // % of revenue, typical restaurant net margin target after overheads

// channel_payouts keys fees by `venue` text; the P&L scopes by restaurant_id.
// Map the two here so transaction fees can be attributed to the right restaurant.
const VENUE_TO_RNAME: Record<string, string> = { "Pollo": "Geelong West", "Pollo - Torquay": "Torquay" };
const RNAME_TO_VENUE: Record<string, string> = { "Geelong West": "Pollo", "Torquay": "Pollo - Torquay" };

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

// ─── Hierarchical P&L statement ───────────────────────────────────────────────

type LineKind = "revTotal" | "revChild" | "cost" | "subtotal" | "netTotal";
interface PnlLine {
  key: string;
  label: string;
  amount: number;
  prev: number;
  depth: number;
  kind: LineKind;
  note?: string;
  children?: PnlLine[];
}

function changePct(amount: number, prev: number): number | null {
  return prev > 0 ? ((amount - prev) / prev) * 100 : null;
}

function TreeRow({ line, revenue, expanded, onToggle }: {
  line: PnlLine; revenue: number; expanded: Set<string>; onToggle: (k: string) => void;
}) {
  const hasChildren = !!line.children?.length;
  const open = expanded.has(line.key);
  const pct = revenue > 0 ? (line.amount / revenue) * 100 : null;
  const change = changePct(line.amount, line.prev);
  const isCost = line.kind === "cost";
  const bold = line.kind === "revTotal" || line.kind === "subtotal" || line.kind === "netTotal";
  const goodUp = !isCost; // revenue/subtotals: up is good; costs: down is good
  const changeGood = change != null && (goodUp ? change > 0 : change < 0);

  return (
    <>
      <div
        className={cn(
          "flex items-center justify-between gap-3 pr-4 py-2.5 transition-colors",
          bold && "bg-muted/30",
          (line.kind === "subtotal" || line.kind === "netTotal") && "border-t border-border",
          hasChildren && "cursor-pointer hover:bg-accent/30"
        )}
        style={{ paddingLeft: 16 + line.depth * 20 }}
        onClick={hasChildren ? () => onToggle(line.key) : undefined}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {hasChildren ? (
            <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-90")} />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className={cn("text-sm truncate", bold ? "font-semibold text-foreground" : "text-foreground/90")}>
            {line.label}
          </span>
          {line.note && <span className="text-[10px] text-muted-foreground italic hidden sm:inline">· {line.note}</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums w-11 text-right hidden sm:inline">
            {pct != null ? formatPercent(pct) : ""}
          </span>
          <span className={cn("text-[11px] tabular-nums w-14 text-right hidden md:inline", change == null ? "text-muted-foreground/50" : changeGood ? "text-green-500" : "text-red-500")}>
            {change != null ? `${change > 0 ? "+" : ""}${formatPercent(change)}` : "—"}
          </span>
          <span className={cn(
            "text-sm tabular-nums w-24 text-right",
            bold ? "font-bold" : "font-medium",
            line.kind === "netTotal" ? (line.amount >= 0 ? "text-green-500" : "text-red-500")
              : isCost ? "text-red-500" : "text-foreground"
          )}>
            {isCost && line.amount !== 0 ? "− " : ""}{formatCurrency(Math.abs(line.amount))}
          </span>
        </div>
      </div>
      {hasChildren && open && line.children!.map((c) => (
        <TreeRow key={c.key} line={c} revenue={revenue} expanded={expanded} onToggle={onToggle} />
      ))}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PnLReport() {
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleKey = (k: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });
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
      .select("restaurant_id, supplier_name, amount, category, invoice_date")
      .gte("invoice_date", from)
      .lte("invoice_date", to);
    if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
    return q;
  }
  function scopeSales(from: string, to: string) {
    let q = supabase
      .from("sales_daily")
      .select("restaurant_id, date, total_sales, net_sales, online_sales, delivery_sales")
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
  // Transaction fees (Uber Eats, Lightspeed, …) live in channel_payouts, keyed by venue.
  function scopeFees(from: string, to: string) {
    let q = supabase
      .from("channel_payouts")
      .select("venue, channel, date, fees, payout_amount")
      .gte("date", from)
      .lte("date", to);
    if (selectedRestaurantId) {
      const rname = restaurants.find((r) => r.id === selectedRestaurantId)?.name ?? "";
      q = q.eq("venue", RNAME_TO_VENUE[rname] ?? "__none__");
    }
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

  // Weekly payroll actuals (manual) — the source of truth for Labour COST.
  function scopeWeeklyLabour(from: string, to: string) {
    let q = supabase
      .from("weekly_labour")
      .select("restaurant_id, week_start, actual_labour, payroll_tax, overtime, penalty_rates")
      .gte("week_start", from)
      .lte("week_start", to);
    if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
    return q;
  }
  const { data: weeklyLabour = [] } = useQuery({
    queryKey: ["pnl-weekly-labour", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeWeeklyLabour(range.from, range.to); if (error) throw error; return data ?? []; },
  });
  const { data: prevWeeklyLabour = [] } = useQuery({
    queryKey: ["pnl-weekly-labour", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeWeeklyLabour(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  const { data: rawOneOffExpenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ["pnl-expenses", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeExpenses(range.from, range.to); if (error) throw error; return data ?? []; },
  });
  const { data: rawPrevOneOffExpenses = [] } = useQuery({
    queryKey: ["pnl-expenses", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeExpenses(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  // Transaction fees from channel_payouts, surfaced as two P&L expense lines:
  //   "Transaction Fees – Lightspeed" (POS card fees) and
  //   "Transaction Fees – Delivery"   (Uber Eats + DoorDash + Bite).
  const { data: channelFees = [] } = useQuery({
    queryKey: ["pnl-fees", selectedRestaurantId, range.from, range.to],
    queryFn: async () => { const { data, error } = await scopeFees(range.from, range.to); if (error) throw error; return data ?? []; },
  });
  const { data: prevChannelFees = [] } = useQuery({
    queryKey: ["pnl-fees", selectedRestaurantId, prev.from, prev.to],
    queryFn: async () => { const { data, error } = await scopeFees(prev.from, prev.to); if (error) throw error; return data ?? []; },
  });

  // Turn per-day channel fee rows into expense-shaped lines (one per restaurant/date/line),
  // so they flow through the existing overhead, weekly, by-restaurant and category logic.
  function feesToExpenseRows(rows: any[]) {
    const acc = new Map<string, any>();
    for (const f of rows) {
      const rid = restaurants.find((r) => r.name === VENUE_TO_RNAME[f.venue])?.id;
      if (!rid) continue;
      const line = f.channel === "Lightspeed" ? "Lightspeed" : "Delivery";
      const key = `${rid}|${f.date}|${line}`;
      const existing = acc.get(key)?.amount ?? 0;
      acc.set(key, {
        restaurant_id: rid,
        category: `Transaction Fees – ${line}`,
        description: line,
        amount: existing + Number(f.fees ?? 0),
        expense_date: f.date,
      });
    }
    return [...acc.values()].filter((e) => e.amount > 0);
  }
  const feeExpenseRows = useMemo(() => feesToExpenseRows(channelFees), [channelFees, restaurants]);
  const prevFeeExpenseRows = useMemo(() => feesToExpenseRows(prevChannelFees), [prevChannelFees, restaurants]);
  // Transaction fees are kept SEPARATE from overheads — their own P&L block, and
  // their own deduction from Net Profit (see netProfit / weekly / by-restaurant below).
  const oneOffExpenses = rawOneOffExpenses;
  const prevOneOffExpenses = rawPrevOneOffExpenses;
  const lightspeedFees = useMemo(() => feeExpenseRows.filter((e) => e.description === "Lightspeed").reduce((s, e) => s + e.amount, 0), [feeExpenseRows]);
  const deliveryFees = useMemo(() => feeExpenseRows.filter((e) => e.description === "Delivery").reduce((s, e) => s + e.amount, 0), [feeExpenseRows]);
  const transactionFees = lightspeedFees + deliveryFees;
  const prevTransactionFees = useMemo(() => prevFeeExpenseRows.reduce((s, e) => s + e.amount, 0), [prevFeeExpenseRows]);

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

  // ── Totals ────────────────────────────────────────────────────────────────
  const revenue = useMemo(() => salesRows.reduce((s: number, r: any) => s + Number(r.net_sales ?? r.total_sales ?? 0), 0), [salesRows]);

  const purchases = useMemo(() => invoices.reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0), [invoices]);

  // ── Revenue channel split (Instore / Delivery[Uber,Doordash] / Web-App / Catering) ──
  function revenueSplit(rows: any[], payouts: any[]) {
    const total = rows.reduce((s, r) => s + Number(r.total_sales ?? 0), 0);
    const online = rows.reduce((s, r) => s + Number(r.online_sales ?? 0), 0);
    const delivery = rows.reduce((s, r) => s + Number(r.delivery_sales ?? 0), 0);
    const instore = Math.max(total - online - delivery, 0);
    // Split delivery into Uber vs Doordash by their payout share within the period.
    const uberPayout = payouts.filter((p) => /uber/i.test(p.channel)).reduce((s, p) => s + Number(p.payout_amount ?? 0), 0);
    const doorPayout = payouts.filter((p) => /door/i.test(p.channel)).reduce((s, p) => s + Number(p.payout_amount ?? 0), 0);
    const denom = uberPayout + doorPayout;
    const uber = denom > 0 ? delivery * (uberPayout / denom) : 0;
    const doordash = denom > 0 ? delivery * (doorPayout / denom) : delivery;
    return { total, instore, delivery, uber, doordash, webApp: online, catering: 0 };
  }
  const rev = useMemo(() => revenueSplit(salesRows, channelFees), [salesRows, channelFees]);
  const prevRev = useMemo(() => revenueSplit(prevSalesRows, prevChannelFees), [prevSalesRows, prevChannelFees]);

  // ── COGS split (Food vs Paper) from invoice categories ──
  function paperOf(rows: any[]) { return rows.filter((i) => canonicalCategory(i.category) === CAT.PAPER).reduce((s, i) => s + Number(i.amount ?? 0), 0); }
  const paperCost = useMemo(() => paperOf(invoices), [invoices]);
  const foodCost = Math.max(purchases - paperCost, 0);
  const prevPaperCost = useMemo(() => paperOf(prevInvoices), [prevInvoices]);

  // ── Labour: Deputy owns HOURS, weekly payroll owns COST ──
  const labourHours = useMemo(() => labourRows.reduce((s: number, r: any) => s + Number(r.total_hours ?? 0), 0), [labourRows]);
  const labourCostDeputy = useMemo(() => labourRows.reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0), [labourRows]);
  function sumWL(rows: any[], key: string) { return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0); }
  const wlActual = useMemo(() => sumWL(weeklyLabour, "actual_labour"), [weeklyLabour]);
  const wlTax = useMemo(() => sumWL(weeklyLabour, "payroll_tax"), [weeklyLabour]);
  const wlOvertime = useMemo(() => sumWL(weeklyLabour, "overtime"), [weeklyLabour]);
  const wlPenalty = useMemo(() => sumWL(weeklyLabour, "penalty_rates"), [weeklyLabour]);
  const hasWeeklyLabour = weeklyLabour.length > 0;
  const labourManualTotal = wlActual + wlTax + wlOvertime + wlPenalty;
  // Effective labour cost used everywhere in the P&L: manual payroll if entered, else Deputy.
  const labourCost = hasWeeklyLabour ? labourManualTotal : labourCostDeputy;

  const cogs = purchases; // invoice-based: Food Cost + Paper Cost
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

  const netProfit = operatingProfit - totalOverheads - transactionFees;
  const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : null;

  // Previous period comparisons (gross purchases — stock counts not diffed per prior period)
  const prevRevenue = useMemo(() => prevSalesRows.reduce((s: number, r: any) => s + Number(r.net_sales ?? r.total_sales ?? 0), 0), [prevSalesRows]);
  const prevPurchases = useMemo(() => prevInvoices.reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0), [prevInvoices]);
  const prevLabourCost = useMemo(() => {
    const manual = prevWeeklyLabour.reduce((s: number, r: any) => s + Number(r.actual_labour ?? 0) + Number(r.payroll_tax ?? 0) + Number(r.overtime ?? 0) + Number(r.penalty_rates ?? 0), 0);
    if (prevWeeklyLabour.length > 0) return manual;
    return prevLabourRows.reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0);
  }, [prevWeeklyLabour, prevLabourRows]);
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
  const prevNetProfit = prevOperatingProfit - prevTotalOverheads - prevTransactionFees;
  const prevNetMarginPct = prevRevenue > 0 ? (prevNetProfit / prevRevenue) * 100 : null;
  const netMarginDelta = netMarginPct != null && prevNetMarginPct != null ? netMarginPct - prevNetMarginPct : null;

  // ── Overheads grouped by canonical category (one-off + recurring, prorated) ──
  function overheadMap(oneOff: any[], from: Date, to: Date): Map<string, number> {
    const map = new Map<string, number>();
    oneOff.forEach((e: any) => {
      const c = canonicalCategory(e.category);
      map.set(c, (map.get(c) ?? 0) + Number(e.amount ?? 0));
    });
    recurringExpenses.forEach((t) => {
      const occ = countOccurrences(parseISO(t.start_date), t.end_date ? parseISO(t.end_date) : null, t.frequency, from, to);
      if (occ === 0) return;
      const c = canonicalCategory(t.category);
      map.set(c, (map.get(c) ?? 0) + occ * t.amount);
    });
    return map;
  }
  const ohMap = useMemo(() => overheadMap(oneOffExpenses, parseISO(range.from), parseISO(range.to)), [oneOffExpenses, recurringExpenses, range]);
  const prevOhMap = useMemo(() => overheadMap(prevOneOffExpenses, parseISO(prev.from), parseISO(prev.to)), [prevOneOffExpenses, recurringExpenses, prev]);
  const catSum = (map: Map<string, number>, cats: string[]) => cats.reduce((s, c) => s + (map.get(c) ?? 0), 0);

  // ── Structured statement model (revenue + expense tree) ──────────────────────
  const statementLines: PnlLine[] = useMemo(() => {
    // Scale channel split so children reconcile to net Revenue (net vs gross sales).
    const f = rev.total > 0 ? revenue / rev.total : 1;
    const pf = prevRev.total > 0 ? prevRevenue / prevRev.total : 1;

    const revenueLine: PnlLine = {
      key: "revenue", label: "Revenue", amount: revenue, prev: prevRevenue, depth: 0, kind: "revTotal",
      children: [
        { key: "r-instore", label: "Instore", amount: rev.instore * f, prev: prevRev.instore * pf, depth: 1, kind: "revChild" },
        {
          key: "r-delivery", label: "Delivery", amount: rev.delivery * f, prev: prevRev.delivery * pf, depth: 1, kind: "revChild",
          children: [
            { key: "r-uber", label: "Uber", amount: rev.uber * f, prev: prevRev.uber * pf, depth: 2, kind: "revChild" },
            { key: "r-door", label: "Doordash", amount: rev.doordash * f, prev: prevRev.doordash * pf, depth: 2, kind: "revChild" },
          ],
        },
        { key: "r-web", label: "Web / App", amount: rev.webApp * f, prev: prevRev.webApp * pf, depth: 1, kind: "revChild" },
        { key: "r-catering", label: "Catering", amount: 0, prev: 0, depth: 1, kind: "revChild", note: "Coming soon" },
      ],
    };

    const cogsLine: PnlLine = {
      key: "cogs", label: "Cost of Goods Sold", amount: cogs, prev: prevPurchases, depth: 0, kind: "cost",
      children: [
        { key: "c-food", label: "Food Cost", amount: foodCost, prev: Math.max(prevPurchases - prevPaperCost, 0), depth: 1, kind: "cost" },
        { key: "c-paper", label: "Paper Cost", amount: paperCost, prev: prevPaperCost, depth: 1, kind: "cost" },
      ],
    };
    const grossLine: PnlLine = { key: "gross", label: "Gross Profit", amount: grossProfit, prev: prevRevenue - prevPurchases, depth: 0, kind: "subtotal" };

    const labourLine: PnlLine = {
      key: "labour", label: "Labour", amount: labourCost, prev: prevLabourCost, depth: 0, kind: "cost",
      note: hasWeeklyLabour ? `${labourHours.toFixed(0)} hrs (Deputy)` : "Deputy estimate — enter payroll in Data Management",
      children: hasWeeklyLabour ? [
        { key: "l-actual", label: "Actual Labour", amount: wlActual, prev: sumWL(prevWeeklyLabour, "actual_labour"), depth: 1, kind: "cost" },
        { key: "l-tax", label: "Payroll Tax", amount: wlTax, prev: sumWL(prevWeeklyLabour, "payroll_tax"), depth: 1, kind: "cost" },
        { key: "l-ot", label: "Overtime", amount: wlOvertime, prev: sumWL(prevWeeklyLabour, "overtime"), depth: 1, kind: "cost" },
        { key: "l-penalty", label: "Penalty Rates", amount: wlPenalty, prev: sumWL(prevWeeklyLabour, "penalty_rates"), depth: 1, kind: "cost" },
      ] : undefined,
    };
    const operatingLine: PnlLine = { key: "operating", label: "Operating Profit", amount: operatingProfit, prev: prevOperatingProfit, depth: 0, kind: "subtotal" };

    const buildOverhead = (node: PnlNode, depth: number): PnlLine => {
      if (node.children) {
        const children = node.children.map((c) => buildOverhead(c, depth + 1));
        return {
          key: "oh-" + node.key, label: node.label, depth, kind: "cost",
          amount: children.reduce((s, c) => s + c.amount, 0),
          prev: children.reduce((s, c) => s + c.prev, 0),
          children,
        };
      }
      const cats = node.cats ?? [];
      return { key: "oh-" + node.key, label: node.label, depth, kind: "cost", amount: catSum(ohMap, cats), prev: catSum(prevOhMap, cats) };
    };
    const overheadChildren = OVERHEAD_NODES.map((n) => buildOverhead(n, 1));
    const uncat = ohMap.get(CAT.UNCATEGORISED) ?? 0;
    if (uncat > 0) {
      overheadChildren.push({ key: "oh-uncat", label: "Uncategorised", amount: uncat, prev: prevOhMap.get(CAT.UNCATEGORISED) ?? 0, depth: 1, kind: "cost", note: "Fix in Admin → Expenses" });
    }
    const overheadLine: PnlLine = { key: "overheads", label: "Overhead Expenses", amount: totalOverheads, prev: prevTotalOverheads, depth: 0, kind: "cost", children: overheadChildren };

    const prevLsFees = prevFeeExpenseRows.filter((e) => e.description === "Lightspeed").reduce((s, e) => s + e.amount, 0);
    const prevDelFees = prevFeeExpenseRows.filter((e) => e.description === "Delivery").reduce((s, e) => s + e.amount, 0);
    const feesLine: PnlLine = {
      key: "fees", label: "Transaction Fees", amount: transactionFees, prev: prevTransactionFees, depth: 0, kind: "cost",
      children: [
        { key: "f-ls", label: "Lightspeed (card)", amount: lightspeedFees, prev: prevLsFees, depth: 1, kind: "cost" },
        { key: "f-del", label: "Delivery commissions", amount: deliveryFees, prev: prevDelFees, depth: 1, kind: "cost" },
      ],
    };

    const netLine: PnlLine = { key: "net", label: "Net Profit", amount: netProfit, prev: prevNetProfit, depth: 0, kind: "netTotal" };

    return [revenueLine, cogsLine, grossLine, labourLine, operatingLine, overheadLine, feesLine, netLine];
  }, [rev, prevRev, revenue, prevRevenue, cogs, prevPurchases, foodCost, paperCost, prevPaperCost, grossProfit, labourCost, prevLabourCost, labourHours, hasWeeklyLabour, wlActual, wlTax, wlOvertime, wlPenalty, prevWeeklyLabour, operatingProfit, prevOperatingProfit, ohMap, prevOhMap, totalOverheads, prevTotalOverheads, transactionFees, prevTransactionFees, lightspeedFees, deliveryFees, prevFeeExpenseRows, netProfit, prevNetProfit]);

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
      // Use manual payroll when available (matches main P&L source hierarchy)
      const wkFmt = format(wStart, "yyyy-MM-dd");
      const wlMatch = weeklyLabour.filter((r: any) => r.week_start === wkFmt);
      const wLabour = wlMatch.length > 0
        ? wlMatch.reduce((s: number, r: any) => s + Number(r.actual_labour ?? 0) + Number(r.payroll_tax ?? 0) + Number(r.overtime ?? 0) + Number(r.penalty_rates ?? 0), 0)
        : labourRows.filter((r: any) => isWithinInterval(parseISO(r.date), { start: wStart, end: wEnd }))
          .reduce((s: number, r: any) => s + Number(r.total_cost ?? 0), 0);
      const wOneOffOverhead = oneOffExpenses.filter((e: any) => isWithinInterval(parseISO(e.expense_date), { start: wStart, end: wEnd }))
        .reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);
      const wOverhead = wOneOffOverhead + recurringAmountInRange(recurringExpenses, wStart, wEnd);
      const wFees = feeExpenseRows.filter((e) => isWithinInterval(parseISO(e.expense_date), { start: wStart, end: wEnd }))
        .reduce((s, e) => s + e.amount, 0);
      const wProfit = wRevenue - wPurchases - wLabour - wOverhead - wFees;
      return {
        week: format(wStart, "d MMM"),
        revenue: wRevenue,
        purchases: wPurchases,
        labour: wLabour,
        overhead: wOverhead,
        fees: wFees,
        profit: wProfit,
        margin: wRevenue > 0 ? (wProfit / wRevenue) * 100 : null,
      };
    });
  }, [salesRows, invoices, labourRows, weeklyLabour, oneOffExpenses, recurringExpenses, feeExpenseRows, range]);

  // ── By restaurant (all-view) ──────────────────────────────────────────────────
  const restaurantData = useMemo(() => {
    if (!isAllRestaurants) return [];
    return restaurants.map((r) => {
      const rRevenue = salesRows.filter((row: any) => row.restaurant_id === r.id).reduce((s: number, row: any) => s + Number(row.net_sales ?? row.total_sales ?? 0), 0);
      const rPurchases = invoices.filter((i: any) => i.restaurant_id === r.id).reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0);
      const rLabour = labourRows.filter((row: any) => row.restaurant_id === r.id).reduce((s: number, row: any) => s + Number(row.total_cost ?? 0), 0);
      const rOneOffOverhead = oneOffExpenses.filter((e: any) => e.restaurant_id === r.id).reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0);
      const rOverhead = rOneOffOverhead + recurringAmountInRange(recurringExpenses, parseISO(range.from), parseISO(range.to), r.id);
      const rFees = feeExpenseRows.filter((e) => e.restaurant_id === r.id).reduce((s, e) => s + e.amount, 0);
      const rProfit = rRevenue - rPurchases - rLabour - rOverhead - rFees;
      return {
        name: r.name,
        revenue: rRevenue,
        purchases: rPurchases,
        labour: rLabour,
        overhead: rOverhead,
        fees: rFees,
        profit: rProfit,
        margin: rRevenue > 0 ? (rProfit / rRevenue) * 100 : null,
      };
    }).filter((row) => row.revenue > 0 || row.purchases > 0 || row.labour > 0 || row.overhead > 0 || row.fees > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [isAllRestaurants, restaurants, salesRows, invoices, labourRows, oneOffExpenses, recurringExpenses, feeExpenseRows, range]);

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
  const hasData = revenue > 0 || purchases > 0 || labourCost > 0 || totalOverheads > 0 || transactionFees > 0;

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
          label="COGS"
          value={formatCurrency(cogs)}
          sub={`Food + Paper · ${invoices.length} invoice${invoices.length !== 1 ? "s" : ""}`}
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
          sub="Operating Profit − Overheads − Transaction Fees"
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
          <>
            {/* Column headers */}
            <div className="flex items-center justify-between gap-3 pr-4 pl-4 py-2 border-b border-border bg-muted/10">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Line item</span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-11 text-right hidden sm:inline">% Rev</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-14 text-right hidden md:inline">vs prev</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-24 text-right">Amount</span>
              </div>
            </div>
            <div>
              {statementLines.map((l) => (
                <TreeRow key={l.key} line={l} revenue={revenue} expanded={expanded} onToggle={toggleKey} />
              ))}
            </div>
          </>
        )}

        <div className="px-4 py-2.5 bg-muted/20 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            Revenue auto-fills from sales syncs. COGS splits from invoice categories, Labour cost from weekly payroll
            (Admin → Data Management), overheads from Admin → Expenses. Click any row to expand its detail.
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
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground hidden lg:table-cell">Fees</th>
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
                        <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden lg:table-cell">{formatCurrency(row.fees)}</td>
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
                      <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground hidden lg:table-cell">{formatCurrency(transactionFees)}</td>
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
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground hidden lg:table-cell">Fees</th>
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
                          <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground hidden lg:table-cell">{formatCurrency(row.fees)}</td>
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
                          <td className="px-4 py-2.5 text-xs text-right font-semibold tabular-nums text-foreground hidden lg:table-cell">{formatCurrency(transactionFees)}</td>
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

            {/* Transaction fees (Lightspeed + Delivery), deducted from Net Profit */}
            {transactionFees > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Receipt className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Transaction Fees</h3>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { label: "Lightspeed", cost: lightspeedFees },
                    { label: "Delivery", cost: deliveryFees },
                  ].filter((l) => l.cost > 0).map((l) => {
                    const pct = transactionFees > 0 ? (l.cost / transactionFees) * 100 : 0;
                    return (
                      <div key={l.label}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-foreground truncate max-w-[160px]">{l.label}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground">{formatPercent(pct)}</span>
                            <span className="text-xs font-medium tabular-nums text-foreground">{formatCurrency(l.cost)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground">Total transaction fees</span>
                  <span className="text-xs font-bold tabular-nums text-foreground">{formatCurrency(transactionFees)}</span>
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
