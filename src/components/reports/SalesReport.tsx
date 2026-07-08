import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  DollarSign, Receipt, TrendingUp, TrendingDown, Minus,
  Download, PlusCircle, Loader2, PieChart, Tag,
  ChevronDown, SlidersHorizontal,
} from "lucide-react";
import {
  format, subDays, startOfWeek, endOfWeek,
  startOfMonth, subWeeks, subMonths, subYears, parseISO,
} from "date-fns";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import type { SalesDaily, Restaurant } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const RESTAURANT_COLORS = ["#f97316", "#3b82f6", "#22c55e"];
const CATEGORY_COLORS   = ["#f97316","#3b82f6","#22c55e","#eab308","#a855f7","#ec4899","#14b8a6","#f43f5e"];

type SubPage = "overview" | "sales-mix" | "discounts";
type Preset  = "today" | "yesterday" | "last7" | "thisWeek" | "lastWeek" | "thisMonth" | "last30" | "last90";

interface DateRange { from: string; to: string }

const SUB_PAGES: { key: SubPage; label: string; icon: React.ReactNode }[] = [
  { key: "overview",   label: "Overview",             icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { key: "sales-mix",  label: "Sales Mix",             icon: <PieChart className="h-3.5 w-3.5" /> },
  { key: "discounts",  label: "Discounts & Refunds",   icon: <Tag className="h-3.5 w-3.5" /> },
];

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7",     label: "Last 7 days" },
  { key: "thisWeek",  label: "This week" },
  { key: "lastWeek",  label: "Last week" },
  { key: "thisMonth", label: "This month" },
  { key: "last30",    label: "Last 30 days" },
  { key: "last90",    label: "Last 90 days" },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getPresetRange(preset: Preset): DateRange {
  const today = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  switch (preset) {
    case "today":     return { from: fmt(today), to: fmt(today) };
    case "yesterday": return { from: fmt(subDays(today,1)), to: fmt(subDays(today,1)) };
    case "last7":     return { from: fmt(subDays(today,6)), to: fmt(today) };
    // Week/month "to date" — bounded at today, not the end of the calendar period,
    // so the comparison periods below line up day-for-day instead of partial vs full.
    case "thisWeek":  return { from: fmt(startOfWeek(today,{weekStartsOn:1})), to: fmt(today) };
    case "lastWeek": {
      const lw = subWeeks(today,1);
      return { from: fmt(startOfWeek(lw,{weekStartsOn:1})), to: fmt(endOfWeek(lw,{weekStartsOn:1})) };
    }
    case "thisMonth": return { from: fmt(startOfMonth(today)), to: fmt(today) };
    case "last30":    return { from: fmt(subDays(today,29)), to: fmt(today) };
    case "last90":    return { from: fmt(subDays(today,89)), to: fmt(today) };
  }
}

// For "this week"/"this month" (in-progress periods), shift by a calendar week/month
// so the comparison covers the same elapsed days (e.g. 1st–7th vs 1st–7th last month),
// not a full previous period. Other presets are already complete periods of fixed
// length, so shifting by that same day-count remains a valid apples-to-apples comparison.
function getPrevRange(range: DateRange, preset: Preset): DateRange {
  const from = parseISO(range.from);
  const to   = parseISO(range.to);
  if (preset === "thisWeek")  return { from: format(subWeeks(from,1),"yyyy-MM-dd"),  to: format(subWeeks(to,1),"yyyy-MM-dd") };
  if (preset === "thisMonth") return { from: format(subMonths(from,1),"yyyy-MM-dd"), to: format(subMonths(to,1),"yyyy-MM-dd") };
  const days = Math.round((to.getTime()-from.getTime())/86400000)+1;
  return { from: format(subDays(from,days),"yyyy-MM-dd"), to: format(subDays(to,days),"yyyy-MM-dd") };
}

// Same elapsed days, one year back — e.g. 1st–7th of this month vs 1st–7th same month last year.
function getPrevYearRange(range: DateRange): DateRange {
  const from = parseISO(range.from);
  const to   = parseISO(range.to);
  return { from: format(subYears(from,1),"yyyy-MM-dd"), to: format(subYears(to,1),"yyyy-MM-dd") };
}

// ─── Small components ─────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
      source==="lightspeed" && "bg-blue-500/10 text-blue-500",
      source==="manual"     && "bg-muted/60 text-muted-foreground",
      source==="override"   && "bg-amber-500/10 text-amber-500"
    )}>{source}</span>
  );
}

function ChangeIndicator({ change }: { change: number | null }) {
  const isPos = change!==null && change>=0;
  return change!==null ? (
    <>
      {change>0 ? <TrendingUp className="h-4 w-4 text-green-500"/>
        : change<0 ? <TrendingDown className="h-4 w-4 text-red-500"/>
        : <Minus className="h-4 w-4 text-muted-foreground"/>}
      <span className={cn("text-sm font-medium",isPos?"text-green-500":"text-red-500")}>
        {change>0?"+":""}{change.toFixed(1)}%
      </span>
    </>
  ) : <span className="text-sm text-muted-foreground">—</span>;
}

function KpiCard({ label, value, prev, prevYear, prevLabel="vs prev period", icon, prefix="" }: {
  label: string; value: number|null; prev: number|null; prevYear?: number|null; prevLabel?: string;
  icon: React.ReactNode; prefix?: string;
}) {
  const change     = value!==null&&prev!==null&&prev>0     ? ((value-prev)/prev)*100     : null;
  const changeYear = value!==null&&prevYear!=null&&prevYear>0 ? ((value-prevYear)/prevYear)*100 : null;
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</div>
      </div>
      <p className="mt-3 text-3xl font-bold">{value!==null?`${prefix}${formatNumber(value)}`:"—"}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <ChangeIndicator change={change}/>
        <span className="text-xs text-muted-foreground">{prevLabel}</span>
      </div>
      {prevYear !== undefined && (
        <div className="mt-1 flex items-center gap-1.5">
          <ChangeIndicator change={changeYear}/>
          <span className="text-xs text-muted-foreground">vs same period last year</span>
        </div>
      )}
    </div>
  );
}

function SmallKpi({ label, value, sub, highlight }: {
  label: string; value: string; sub?: string; highlight?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", highlight ?? "text-foreground")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function exportCSV(data: SalesDaily[], restaurants: Restaurant[]) {
  const headers = ["Date","Restaurant","Gross Sales","Net Sales","Transactions","Avg Tx","Discounts","Refunds","Source"];
  const rows = data.map(r=>[
    r.date,
    restaurants.find(x=>x.id===r.restaurant_id)?.name??"",
    r.total_sales, r.net_sales??"", r.transaction_count, r.average_transaction,
    r.discounts_amount, r.refunds_amount, r.source,
  ]);
  const csv = [headers,...rows].map(row=>row.map(String).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href=url; a.download=`sales-report-${format(new Date(),"yyyy-MM-dd")}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SalesReport() {
  const navigate = useNavigate();
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const [subPage,     setSubPage]     = useState<SubPage>("overview");
  const [preset,      setPreset]      = useState<Preset>("last7");
  const [customRange, setCustomRange] = useState<DateRange|null>(null);

  const dateRange = customRange ?? getPresetRange(preset);
  const prevRange = getPrevRange(dateRange, preset);
  // Only "this week"/"this month" get a same-point-in-time last-year comparison —
  // other presets already compare like-for-like complete periods.
  const showYearComparison = !customRange && (preset === "thisWeek" || preset === "thisMonth");
  const prevYearRange = showYearComparison ? getPrevYearRange(dateRange) : null;
  const prevLabel = preset === "thisWeek" ? "vs last week" : preset === "thisMonth" ? "vs last month" : "vs prev period";

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants?.map(r=>r.id) ?? [];

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: salesData, isLoading } = useQuery({
    queryKey: ["sales-report", dateRange, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("sales_daily").select("*")
        .gte("date", dateRange.from).lte("date", dateRange.to)
        .in("restaurant_id", restaurantIds).order("date");
      if (error) throw error;
      return data as SalesDaily[];
    },
    enabled: !!restaurantIds.length,
  });

  const { data: prevData } = useQuery({
    queryKey: ["sales-report-prev", prevRange, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("*")
        .gte("date", prevRange.from).lte("date", prevRange.to)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantIds.length,
  });

  const { data: prevYearData } = useQuery({
    queryKey: ["sales-report-prev-year", prevYearRange, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length || !prevYearRange) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("*")
        .gte("date", prevYearRange.from).lte("date", prevYearRange.to)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantIds.length && !!prevYearRange,
  });

  // ── Aggregations ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const cur = salesData ?? [];
    const prv = prevData ?? [];
    const prvY = prevYearData ?? [];
    const sum = (arr: any[], key: string) => arr.reduce((s,r)=>s+Number(r[key]??0),0);
    const avgTx        = cur.length>0 ? sum(cur,"total_sales")/Math.max(sum(cur,"transaction_count"),1) : 0;
    const prevAvgTx     = prv.length>0 ? sum(prv,"total_sales")/Math.max(sum(prv,"transaction_count"),1) : 0;
    const prevYearAvgTx = prvY.length>0 ? sum(prvY,"total_sales")/Math.max(sum(prvY,"transaction_count"),1) : 0;
    return {
      grossSales:     { cur: sum(cur,"total_sales"),       prev: sum(prv,"total_sales"),       prevYear: sum(prvY,"total_sales") },
      netSales:       { cur: sum(cur,"net_sales"),         prev: sum(prv,"net_sales"),         prevYear: sum(prvY,"net_sales") },
      transactions:   { cur: sum(cur,"transaction_count"), prev: sum(prv,"transaction_count"), prevYear: sum(prvY,"transaction_count") },
      avgTransaction: { cur: avgTx,                        prev: prevAvgTx,                    prevYear: prevYearAvgTx },
      discounts:      { cur: sum(cur,"discounts_amount"),  prev: sum(prv,"discounts_amount"),  prevYear: sum(prvY,"discounts_amount") },
      discountCount:  { cur: sum(cur,"discounts_count"),   prev: sum(prv,"discounts_count") },
      refunds:        { cur: sum(cur,"refunds_amount"),    prev: sum(prv,"refunds_amount"),    prevYear: sum(prvY,"refunds_amount") },
      refundCount:    { cur: sum(cur,"refunds_count"),     prev: sum(prv,"refunds_count") },
    };
  }, [salesData, prevData, prevYearData]);

  // ── Trend chart ───────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    if (!salesData||!restaurants) return [];
    const dateMap = new Map<string,Record<string,number>>();
    for (const row of salesData) {
      if (!dateMap.has(row.date)) dateMap.set(row.date,{});
      const name = restaurants.find(r=>r.id===row.restaurant_id)?.name ?? row.restaurant_id;
      const entry = dateMap.get(row.date)!;
      entry[name] = (entry[name]??0)+Number(row.total_sales);
    }
    return Array.from(dateMap.entries()).sort(([a],[b])=>a.localeCompare(b))
      .map(([date,vals])=>({ date: format(parseISO(date),"d MMM"), ...vals }));
  }, [salesData, restaurants]);

  const visibleRestaurantNames = useMemo(() => {
    if (selectedRestaurantId) return [restaurants?.find(r=>r.id===selectedRestaurantId)?.name??""];
    return restaurants?.map(r=>r.name)??[];
  }, [restaurants, selectedRestaurantId]);

  // ── Category data ─────────────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const totals: Record<string,number> = {};
    for (const row of salesData??[]) {
      for (const cat of row.sales_by_category??[]) {
        totals[cat.name] = (totals[cat.name]??0)+cat.amount;
      }
    }
    return Object.entries(totals)
      .map(([name,amount])=>({ name, amount: Math.round(amount*100)/100 }))
      .sort((a,b)=>b.amount-a.amount);
  }, [salesData]);

  const totalCategoryAmount = categoryData.reduce((s,c)=>s+c.amount,0);

  // ── Product data ──────────────────────────────────────────────────────────
  const productData = useMemo(() => {
    const totals: Record<string,number> = {};
    for (const row of salesData??[]) {
      for (const prod of row.sales_by_product??[]) {
        totals[prod.name] = (totals[prod.name]??0)+prod.amount;
      }
    }
    return Object.entries(totals)
      .map(([name,amount])=>({ name, amount: Math.round(amount*100)/100 }))
      .sort((a,b)=>b.amount-a.amount);
  }, [salesData]);

  const totalProductAmount = productData.reduce((s,p)=>s+p.amount,0);

  // ── Hourly data ───────────────────────────────────────────────────────────
  const hourData = useMemo(() => {
    const totals: Record<number,number> = {};
    for (const row of salesData??[]) {
      for (const h of row.sales_by_hour??[]) {
        totals[h.hour] = (totals[h.hour]??0)+h.amount;
      }
    }
    return Array.from({length:24},(_,i)=>({
      hour:`${i}:00`, amount: Math.round((totals[i]??0)*100)/100,
    })).filter(h=>h.amount>0);
  }, [salesData]);

  // ── Discount trend ────────────────────────────────────────────────────────
  const discountTrendData = useMemo(() => {
    if (!salesData) return [];
    const dateMap = new Map<string,{discounts:number;refunds:number}>();
    for (const row of salesData) {
      if (!dateMap.has(row.date)) dateMap.set(row.date,{discounts:0,refunds:0});
      const e = dateMap.get(row.date)!;
      e.discounts += Number(row.discounts_amount??0);
      e.refunds   += Number(row.refunds_amount??0);
    }
    return Array.from(dateMap.entries()).sort(([a],[b])=>a.localeCompare(b))
      .map(([date,v])=>({ date: format(parseISO(date),"d MMM"), ...v }));
  }, [salesData]);

  const hasDiscountData = (salesData??[]).some(r=>r.discounts_amount>0||r.refunds_amount>0);

  // ── Mobile date filter expand ──────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activePresetLabel = customRange
    ? `${customRange.from} → ${customRange.to}`
    : PRESETS.find(p=>p.key===preset)?.label ?? "Last 7 days";

  // ── Filters bar ───────────────────────────────────────────────────────────
  const filtersBar = (
    <div className="space-y-3">
      {/* Mobile: compact summary row */}
      <div className="flex items-center gap-2">
        <button
          onClick={()=>setFiltersOpen(!filtersOpen)}
          className="sm:hidden inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground"/>
          {activePresetLabel}
          <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", filtersOpen && "rotate-180")}/>
        </button>

        {/* Desktop: inline preset row */}
        <div className="hidden sm:flex sm:flex-wrap gap-1.5">
          {PRESETS.map(p=>(
            <button key={p.key}
              onClick={()=>{ setPreset(p.key); setCustomRange(null); }}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                preset===p.key&&!customRange ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >{p.label}</button>
          ))}
          <div className="flex items-center gap-1.5">
            <input type="date" value={customRange?.from??""}
              onChange={e=>setCustomRange(r=>({from:e.target.value,to:r?.to??e.target.value}))}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={customRange?.to??""}
              onChange={e=>setCustomRange(r=>({from:r?.from??e.target.value,to:e.target.value}))}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!!salesData?.length && (
            <button onClick={()=>salesData&&restaurants&&exportCSV(salesData,restaurants)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors">
              <Download className="h-3.5 w-3.5"/><span className="hidden sm:inline">Export CSV</span>
            </button>
          )}
          <button onClick={()=>navigate("/reports/sales/manual-entry")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            <PlusCircle className="h-3.5 w-3.5"/><span className="hidden sm:inline">Manual Entry</span>
          </button>
        </div>
      </div>

      {/* Mobile: expanded preset grid */}
      {filtersOpen && (
        <div className="sm:hidden rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map(p=>(
              <button key={p.key}
                onClick={()=>{ setPreset(p.key); setCustomRange(null); setFiltersOpen(false); }}
                className={cn("rounded-lg px-3 py-2 text-xs font-medium transition-colors text-center",
                  preset===p.key&&!customRange ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >{p.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={customRange?.from??""}
              onChange={e=>setCustomRange(r=>({from:e.target.value,to:r?.to??e.target.value}))}
              className="h-8 flex-1 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={customRange?.to??""}
              onChange={e=>setCustomRange(r=>({from:r?.from??e.target.value,to:e.target.value}))}
              className="h-8 flex-1 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ── Sub-page switcher ─────────────────────────────────────────────── */}
      <div className="flex gap-1.5 overflow-x-auto">
        {SUB_PAGES.map(sp=>(
          <button key={sp.key} onClick={()=>setSubPage(sp.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
              subPage===sp.key
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {sp.icon}{sp.label}
          </button>
        ))}
      </div>

      {/* ── Shared filters ────────────────────────────────────────────────── */}
      {filtersBar}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary"/>
        </div>
      )}

      {/* ════════════════════════ OVERVIEW ════════════════════════════════ */}
      {!isLoading && subPage==="overview" && (
        <div className="space-y-6">
          {!salesData?.length ? (
            <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center text-center">
              <DollarSign className="h-12 w-12 text-muted-foreground mb-4"/>
              <h3 className="text-base font-semibold mb-2">No sales data</h3>
              <p className="text-sm text-muted-foreground max-w-sm">No records found for this period.</p>
              <button onClick={()=>navigate("/reports/sales/manual-entry")}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                <PlusCircle className="h-4 w-4"/> Manual Entry
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <KpiCard label="Gross Sales"     value={kpis.grossSales.cur}     prev={kpis.grossSales.prev}     prevYear={showYearComparison?kpis.grossSales.prevYear:undefined}     prevLabel={prevLabel} icon={<DollarSign className="h-5 w-5"/>}  prefix="$"/>
                <KpiCard label="Net Sales"       value={kpis.netSales.cur||null} prev={kpis.netSales.prev||null} prevYear={showYearComparison?kpis.netSales.prevYear:undefined}       prevLabel={prevLabel} icon={<DollarSign className="h-5 w-5"/>}  prefix="$"/>
                <KpiCard label="Transactions"    value={kpis.transactions.cur}   prev={kpis.transactions.prev}   prevYear={showYearComparison?kpis.transactions.prevYear:undefined}   prevLabel={prevLabel} icon={<Receipt className="h-5 w-5"/>}/>
                <KpiCard label="Avg Transaction" value={kpis.avgTransaction.cur||null} prev={kpis.avgTransaction.prev||null} prevYear={showYearComparison?kpis.avgTransaction.prevYear:undefined} prevLabel={prevLabel} icon={<TrendingUp className="h-5 w-5"/>} prefix="$"/>
              </div>

              {trendData.length>0 && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="text-sm font-semibold mb-4">Sales Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                      <XAxis dataKey="date" tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                      <YAxis tickFormatter={v=>`$${formatNumber(v)}`} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                      <Tooltip formatter={(v:number)=>[formatCurrency(v),""]}
                        contentStyle={{background:"hsl(var(--card))",border:"1px solid hsl(var(--border))",borderRadius:"8px",fontSize:"12px"}}/>
                      <Legend/>
                      {visibleRestaurantNames.map((name,i)=>(
                        <Line key={name} type="monotone" dataKey={name}
                          stroke={RESTAURANT_COLORS[i%RESTAURANT_COLORS.length]}
                          strokeWidth={2} dot={false} activeDot={{r:4}}/>
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {categoryData.length>0 && (
                  <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="text-sm font-semibold mb-4">Sales by Category</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={categoryData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false}/>
                        <XAxis type="number" tickFormatter={v=>`$${formatNumber(v)}`} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <YAxis type="category" dataKey="name" width={90} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip formatter={(v:number)=>[formatCurrency(v),"Sales"]}
                          contentStyle={{background:"hsl(var(--card))",border:"1px solid hsl(var(--border))",borderRadius:"8px",fontSize:"12px"}}/>
                        <Bar dataKey="amount" radius={[0,4,4,0]}>
                          {categoryData.map((_,i)=><Cell key={i} fill={CATEGORY_COLORS[i%CATEGORY_COLORS.length]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {hourData.length>0 && (
                  <div className="rounded-xl border border-border bg-card p-6">
                    <h3 className="text-sm font-semibold mb-4">Sales by Hour</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={hourData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis dataKey="hour" tick={{fontSize:10}} stroke="hsl(var(--muted-foreground))"/>
                        <YAxis tickFormatter={v=>`$${formatNumber(v)}`} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip formatter={(v:number)=>[formatCurrency(v),"Sales"]}
                          contentStyle={{background:"hsl(var(--card))",border:"1px solid hsl(var(--border))",borderRadius:"8px",fontSize:"12px"}}/>
                        <Bar dataKey="amount" fill="#f97316" radius={[4,4,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {salesData.length>0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-6 py-4 border-b border-border">
                    <h3 className="text-sm font-semibold">Data</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {["Date","Restaurant","Gross Sales","Net Sales","Transactions","Avg Tx","Source"].map(h=>(
                            <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {salesData.map(row=>{
                          const r = restaurants?.find(x=>x.id===row.restaurant_id);
                          return (
                            <tr key={row.id} className="hover:bg-muted/10 transition-colors">
                              <td className="px-4 py-3 text-sm">{format(parseISO(row.date),"d MMM yyyy")}</td>
                              <td className="px-4 py-3 text-sm font-medium">{r?.name??"—"}</td>
                              <td className="px-4 py-3 text-sm font-medium">{formatCurrency(row.total_sales)}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{row.net_sales!==null?formatCurrency(row.net_sales):"—"}</td>
                              <td className="px-4 py-3 text-sm">{row.transaction_count}</td>
                              <td className="px-4 py-3 text-sm">{formatCurrency(row.average_transaction)}</td>
                              <td className="px-4 py-3"><SourceBadge source={row.source}/></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ════════════════════════ SALES MIX ═══════════════════════════════ */}
      {!isLoading && subPage==="sales-mix" && (
        <div className="space-y-6">
          {categoryData.length===0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <PieChart className="h-10 w-10 text-muted-foreground mx-auto mb-3"/>
              <p className="text-sm font-medium text-foreground mb-1">No sales mix data</p>
              <p className="text-xs text-muted-foreground">
                Sales Mix data is captured from Lightspeed. Ensure the Lightspeed sync is running.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <SmallKpi
                  label="Total Sales"
                  value={formatCurrency(totalCategoryAmount)}
                  sub={`${categoryData.length} categories`}
                />
                {categoryData.slice(0,3).map((cat)=>(
                  <SmallKpi
                    key={cat.name}
                    label={cat.name}
                    value={formatCurrency(cat.amount)}
                    sub={formatPercent(totalCategoryAmount>0?(cat.amount/totalCategoryAmount)*100:0)+" of total"}
                  />
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="text-sm font-semibold mb-4">Sales by Category</h3>
                <ResponsiveContainer width="100%" height={Math.max(200, categoryData.length*40)}>
                  <BarChart data={categoryData} layout="vertical" margin={{top:0,right:20,left:0,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false}/>
                    <XAxis type="number" tickFormatter={v=>`$${formatNumber(v)}`} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                    <YAxis type="category" dataKey="name" width={110} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                    <Tooltip formatter={(v:number)=>[formatCurrency(v),"Sales"]}
                      contentStyle={{background:"hsl(var(--card))",border:"1px solid hsl(var(--border))",borderRadius:"8px",fontSize:"12px"}}/>
                    <Bar dataKey="amount" radius={[0,4,4,0]}>
                      {categoryData.map((_,i)=><Cell key={i} fill={CATEGORY_COLORS[i%CATEGORY_COLORS.length]}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="text-sm font-semibold">Category Breakdown</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Category</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Total Sales</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">% of Total</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-40">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {categoryData.map((cat,i)=>{
                      const pct = totalCategoryAmount>0 ? (cat.amount/totalCategoryAmount)*100 : 0;
                      return (
                        <tr key={cat.name} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{background:CATEGORY_COLORS[i%CATEGORY_COLORS.length]}}/>
                              {cat.name}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium tabular-nums">{formatCurrency(cat.amount)}</td>
                          <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">{formatPercent(pct)}</td>
                          <td className="px-4 py-3">
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:CATEGORY_COLORS[i%CATEGORY_COLORS.length]}}/>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td className="px-4 py-2.5 text-sm font-semibold">Total</td>
                      <td className="px-4 py-2.5 text-sm text-right font-bold tabular-nums">{formatCurrency(totalCategoryAmount)}</td>
                      <td className="px-4 py-2.5 text-sm text-right text-muted-foreground">100%</td>
                      <td/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════════ DISCOUNTS & REFUNDS ═════════════════════════ */}
      {!isLoading && subPage==="discounts" && (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SmallKpi
              label="Total Discounts"
              value={formatCurrency(kpis.discounts.cur)}
              sub={`${kpis.discountCount.cur} applied`}
              highlight={kpis.discounts.cur>0 ? "text-amber-500" : undefined}
            />
            <SmallKpi
              label="Total Refunds"
              value={formatCurrency(kpis.refunds.cur)}
              sub={`${kpis.refundCount.cur} processed`}
              highlight={kpis.refunds.cur>0 ? "text-red-500" : undefined}
            />
            <SmallKpi
              label="Discount Rate"
              value={kpis.grossSales.cur>0
                ? formatPercent((kpis.discounts.cur/kpis.grossSales.cur)*100)
                : "—"}
              sub="of gross sales"
            />
            <SmallKpi
              label="Refund Rate"
              value={kpis.grossSales.cur>0
                ? formatPercent((kpis.refunds.cur/kpis.grossSales.cur)*100)
                : "—"}
              sub="of gross sales"
            />
          </div>

          {!hasDiscountData ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center">
              <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-3"/>
              <p className="text-sm font-medium text-foreground mb-1">No discount or refund data yet</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Discount and refund data will appear here once captured via the Lightspeed integration
                or added through Manual Entry.
              </p>
            </div>
          ) : (
            <>
              {/* Trend chart */}
              {discountTrendData.length>1 && (
                <div className="rounded-xl border border-border bg-card p-6">
                  <h3 className="text-sm font-semibold mb-4">Discounts &amp; Refunds Trend</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={discountTrendData} margin={{top:8,right:8,left:0,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false}/>
                      <XAxis dataKey="date" tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                      <YAxis tickFormatter={v=>`$${formatNumber(v)}`} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))" width={55}/>
                      <Tooltip formatter={(v:number)=>[formatCurrency(v),""]}
                        contentStyle={{background:"hsl(var(--card))",border:"1px solid hsl(var(--border))",borderRadius:"8px",fontSize:"12px"}}/>
                      <Legend/>
                      <Bar dataKey="discounts" name="Discounts" fill="#f59e0b" radius={[4,4,0,0]}/>
                      <Bar dataKey="refunds"   name="Refunds"   fill="#ef4444" radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Daily table */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="text-sm font-semibold">Daily Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Date","Restaurant","Gross Sales","Discounts","# Disc","Refunds","# Ref","Net Sales"].map(h=>(
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(salesData??[]).map(row=>{
                        const r = restaurants?.find(x=>x.id===row.restaurant_id);
                        return (
                          <tr key={row.id} className="hover:bg-muted/10 transition-colors">
                            <td className="px-4 py-3 text-sm">{format(parseISO(row.date),"d MMM yyyy")}</td>
                            <td className="px-4 py-3 text-sm font-medium">{r?.name??"—"}</td>
                            <td className="px-4 py-3 text-sm tabular-nums">{formatCurrency(row.total_sales)}</td>
                            <td className="px-4 py-3 text-sm tabular-nums text-amber-500">{row.discounts_amount>0?formatCurrency(row.discounts_amount):"—"}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{row.discounts_count||"—"}</td>
                            <td className="px-4 py-3 text-sm tabular-nums text-red-500">{row.refunds_amount>0?formatCurrency(row.refunds_amount):"—"}</td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{row.refunds_count||"—"}</td>
                            <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">{row.net_sales!==null?formatCurrency(row.net_sales):"—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
