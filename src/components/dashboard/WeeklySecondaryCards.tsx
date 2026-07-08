import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, subWeeks, parseISO } from "date-fns";
import { Receipt, Users, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { TARGET_METRICS } from "@/hooks/useTargets";
import type { SalesDaily, LabourDaily, Target } from "@/types";

function weeklyLabourTarget(targets: Target[], restaurantIds: string[]): number | null {
  const vals = restaurantIds
    .map((rid) => targets.find((r) => r.restaurant_id === rid && r.metric === TARGET_METRICS.LABOUR_COST_PCT && r.day_of_week === null)?.value ?? null)
    .filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function WeeklySecondaryCards({ date }: { date: string }) {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const restaurantIds: string[] = selectedRestaurantId
    ? [selectedRestaurantId]
    : (restaurants?.map((r) => r.id) ?? []);

  const anchor = parseISO(date);
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const prevWeekStart = subWeeks(weekStart, 1);
  const prevWeekEnd = subWeeks(weekEnd, 1);

  const wsStr = format(weekStart, "yyyy-MM-dd");
  const weStr = format(weekEnd, "yyyy-MM-dd");
  const pwsStr = format(prevWeekStart, "yyyy-MM-dd");
  const pweStr = format(prevWeekEnd, "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    queryKey: ["weekly-secondary", wsStr, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return null;
      const [
        { data: sales },
        { data: prevSales },
        { data: labour },
        { data: targetRows },
      ] = await Promise.all([
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").gte("date", wsStr).lte("date", weStr).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").gte("date", pwsStr).lte("date", pweStr).in("restaurant_id", restaurantIds),
        supabase.from("labour_daily").select("total_cost").gte("date", wsStr).lte("date", weStr).in("restaurant_id", restaurantIds),
        supabase.from("targets").select("*").in("restaurant_id", restaurantIds),
      ]);
      return {
        sales: (sales ?? []) as SalesDaily[],
        prevSales: (prevSales ?? []) as SalesDaily[],
        labour: (labour ?? []) as LabourDaily[],
        targets: (targetRows ?? []) as Target[],
      };
    },
    enabled: !!restaurantIds.length,
    staleTime: 1000 * 60 * 5,
  });

  if (!data || isLoading) {
    return (
      <>
        <div className="rounded-xl border border-border bg-card p-4 h-28 animate-pulse" />
        <div className="rounded-xl border border-border bg-card p-4 h-28 animate-pulse" />
      </>
    );
  }

  const { sales, prevSales, labour, targets } = data;

  const weekRev = sales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const weekTx = sales.reduce((s, r) => s + r.transaction_count, 0);
  const prevTx = prevSales.reduce((s, r) => s + r.transaction_count, 0);
  const txTrend = prevTx > 0 ? ((weekTx - prevTx) / prevTx) * 100 : null;

  const totalLabourCost = labour.reduce((s, r) => s + r.total_cost, 0);
  const labourPct = weekRev > 0 ? (totalLabourCost / weekRev) * 100 : null;
  const labourTarget = weeklyLabourTarget(targets, restaurantIds);
  const labourStatus =
    labourPct === null || !labourTarget ? "success"
    : labourPct >= labourTarget + 5 ? "destructive"
    : labourPct >= labourTarget ? "warning"
    : "success";

  type StatStatus = "success" | "warning" | "destructive";
  const txStatus: StatStatus = txTrend !== null && txTrend >= 0 ? "success" : "warning";

  return (
    <>
      {/* Transactions */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Transactions</p>
          <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
            <Receipt className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold">
          {weekTx > 0 ? weekTx.toLocaleString("en-AU") : "—"}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          {txTrend !== null ? (
            <>
              {txTrend > 0 ? (
                <TrendingUp className={cn("h-4 w-4", txStatus === "success" ? "text-green-500" : "text-red-500")} />
              ) : txTrend < 0 ? (
                <TrendingDown className={cn("h-4 w-4", txStatus === "success" ? "text-green-500" : "text-red-500")} />
              ) : (
                <Minus className="h-4 w-4 text-muted-foreground" />
              )}
              <span className={cn("text-sm font-medium", txStatus === "success" ? "text-green-500" : "text-amber-500")}>
                {txTrend > 0 ? "+" : ""}{txTrend.toFixed(1)}%
              </span>
            </>
          ) : (
            <span className="text-sm font-medium text-muted-foreground">—</span>
          )}
          <span className="text-xs text-muted-foreground">vs prev week</span>
        </div>
      </div>

      {/* Labour % */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Labour %</p>
          <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
            <Users className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold">
          {labourPct !== null ? formatPercent(labourPct) : "—"}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className={cn(
            "text-sm font-medium",
            labourStatus === "success" && "text-green-500",
            labourStatus === "warning" && "text-amber-500",
            labourStatus === "destructive" && "text-red-500",
          )}>
            {labourStatus === "destructive" ? "Over target" : labourStatus === "warning" ? "Near target" : "On target"}
          </span>
          <span className="text-xs text-muted-foreground">
            {labourTarget ? `target ${formatPercent(labourTarget)}` : "no target set"}
          </span>
        </div>
      </div>
    </>
  );
}
