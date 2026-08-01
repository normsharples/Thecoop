import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, startOfMonth, subDays, subMonths } from "date-fns";
import { Package, ShoppingCart, Trash, SlidersHorizontal, ArrowLeftRight, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

const WEEK_OPTS = { weekStartsOn: 1 as const };
const FOOD_COST_TARGET = 30;

type Preset = "thisWeek" | "thisMonth" | "last30" | "last3m";
const PRESETS: { label: string; value: Preset }[] = [
  { label: "This Week", value: "thisWeek" },
  { label: "This Month", value: "thisMonth" },
  { label: "Last 30 Days", value: "last30" },
  { label: "Last 3 Months", value: "last3m" },
];
const fmt = (d: Date) => format(d, "yyyy-MM-dd");
function getRange(p: Preset) {
  const t = new Date();
  switch (p) {
    case "thisWeek": return { from: fmt(startOfWeek(t, WEEK_OPTS)), to: fmt(endOfWeek(t, WEEK_OPTS)) };
    case "thisMonth": return { from: fmt(startOfMonth(t)), to: fmt(t) };
    case "last30": return { from: fmt(subDays(t, 29)), to: fmt(t) };
    case "last3m": return { from: fmt(subMonths(t, 3)), to: fmt(t) };
  }
}

const CONSUMPTION = ["sale_depletion", "waste", "count_adjustment", "in_transit_loss"];

interface MoveRow {
  movement_type: string;
  value_delta: number;
  food_cost_item: { category: string | null } | null;
}

function costColour(pct: number | null) {
  if (pct == null) return "text-muted-foreground";
  if (pct <= 28) return "text-green-500";
  if (pct <= 33) return "text-amber-500";
  return "text-red-500";
}

export default function FoodUsageReport() {
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const { selectedRestaurantIds } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const range = customRange ?? getRange(preset);
  const scopedIds = selectedRestaurantIds.length
    ? selectedRestaurantIds
    : restaurants.map((r) => r.id);
  const scopeKey = scopedIds.join(",");
  const scopeLabel =
    selectedRestaurantIds.length === 1
      ? restaurants.find((r) => r.id === selectedRestaurantIds[0])?.name ?? "1 venue"
      : selectedRestaurantIds.length > 1
        ? `${selectedRestaurantIds.length} venues`
        : "All Restaurants";

  const { data: moves = [], isLoading } = useQuery<MoveRow[]>({
    queryKey: ["food-usage-moves", scopeKey, range.from, range.to],
    queryFn: async () => {
      const q = supabase
        .from("inventory_movements")
        .select("movement_type, value_delta, food_cost_item:food_cost_items(category)")
        .in("movement_type", CONSUMPTION)
        .gte("movement_date", range.from)
        .lte("movement_date", range.to)
        .in("restaurant_id", scopedIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as MoveRow[];
    },
  });

  const { data: revenue = 0 } = useQuery<number>({
    queryKey: ["food-usage-sales", scopeKey, range.from, range.to],
    queryFn: async () => {
      const q = supabase
        .from("sales_daily")
        .select("net_sales, total_sales")
        .gte("date", range.from)
        .lte("date", range.to)
        .in("restaurant_id", scopedIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).reduce(
        (s: number, r: { net_sales: number | null; total_sales: number }) => s + (r.net_sales ?? r.total_sales ?? 0),
        0
      );
    },
  });

  const agg = useMemo(() => {
    const isPaper = (c: string | null) => !!c && /packag|paper/i.test(c);
    let sales = 0, waste = 0, variance = 0, loss = 0, paper = 0, food = 0;
    for (const m of moves) {
      const v = -(m.value_delta ?? 0); // outflow value_delta is negative → cost is positive
      if (m.movement_type === "sale_depletion") sales += v;
      else if (m.movement_type === "waste") waste += v;
      else if (m.movement_type === "count_adjustment") variance += v;
      else if (m.movement_type === "in_transit_loss") loss += v;
      if (isPaper(m.food_cost_item?.category ?? null)) paper += v; else food += v;
    }
    const total = sales + waste + variance + loss;
    return { sales, waste, variance, loss, paper, food, total };
  }, [moves]);

  const usagePct = revenue > 0 ? (agg.total / revenue) * 100 : null;

  const breakdown = [
    { label: "Sold (recipe depletion)", value: agg.sales, icon: ShoppingCart, tone: "text-blue-500" },
    { label: "Waste", value: agg.waste, icon: Trash, tone: "text-red-500" },
    { label: "Count variance (shrinkage)", value: agg.variance, icon: SlidersHorizontal, tone: "text-purple-500" },
    { label: "In-transit loss", value: agg.loss, icon: ArrowLeftRight, tone: "text-amber-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Food Cost — Usage</h2>
          <span className="text-sm text-muted-foreground">— {scopeLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => { setPreset(p.value); setCustomRange(null); }}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                  preset === p.value && !customRange ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className={cn(
            "flex items-center gap-1.5 rounded-lg px-1.5 py-0.5",
            customRange && "ring-1 ring-primary"
          )}>
            <input type="date" value={customRange?.from ?? ""}
              onChange={e => setCustomRange(r => ({ from: e.target.value, to: r?.to ?? e.target.value }))}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={customRange?.to ?? ""}
              onChange={e => setCustomRange(r => ({ from: r?.from ?? e.target.value, to: e.target.value }))}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Usage-based food cost is what was actually <span className="font-medium">consumed</span> from live inventory
          (sales depletion, waste, count variance, in-transit loss) valued at moving-average cost — not what was purchased.
          Requires the ledger to be populated (opening balances, invoices, sales depletion).
        </p>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Usage COGS</p>
          <p className="text-xl font-bold tabular-nums text-foreground">{formatCurrency(agg.total)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Food {formatCurrency(agg.food)} · Paper {formatCurrency(agg.paper)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Net Sales</p>
          <p className="text-xl font-bold tabular-nums text-foreground">{formatCurrency(revenue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Usage Food Cost %</p>
          <p className={cn("text-xl font-bold tabular-nums", costColour(usagePct))}>
            {usagePct != null ? formatPercent(usagePct) : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Target ≤ {FOOD_COST_TARGET}%</p>
        </div>
      </div>

      {/* Breakdown */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : agg.total === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No usage recorded in this period. Once opening balances, invoices, and sales depletion feed the ledger, consumption shows here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {breakdown.map((b) => {
            const Icon = b.icon;
            const share = agg.total !== 0 ? (b.value / agg.total) * 100 : 0;
            return (
              <div key={b.label} className="flex items-center gap-3 px-4 py-3">
                <Icon className={cn("h-4 w-4 shrink-0", b.tone)} />
                <span className="text-sm text-foreground flex-1">{b.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{share.toFixed(0)}%</span>
                <span className="text-sm font-semibold tabular-nums text-foreground w-24 text-right">{formatCurrency(b.value)}</span>
              </div>
            );
          })}
          <div className="flex items-center px-4 py-2.5 bg-muted/30">
            <span className="text-sm font-semibold text-foreground flex-1">Total usage COGS</span>
            <span className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(agg.total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
