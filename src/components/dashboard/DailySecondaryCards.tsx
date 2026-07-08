import { useQuery } from "@tanstack/react-query";
import { format, subDays, parseISO } from "date-fns";
import { Receipt, Users, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, formatPercent } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { TARGET_METRICS } from "@/hooks/useTargets";
import type { SalesDaily, LabourDaily, Target } from "@/types";

export function DailySecondaryCards({ date }: { date: string }) {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const restaurantIds: string[] = selectedRestaurantId
    ? [selectedRestaurantId]
    : (restaurants?.map((r) => r.id) ?? []);

  const prevDay = format(subDays(parseISO(date), 1), "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    queryKey: ["daily-secondary", date, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return null;
      const [
        { data: sales },
        { data: prevSales },
        { data: labour },
        { data: targetRows },
      ] = await Promise.all([
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", date).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", prevDay).in("restaurant_id", restaurantIds),
        supabase.from("labour_daily").select("total_cost").eq("date", date).in("restaurant_id", restaurantIds),
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

  const dayRev = sales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const dayTx = sales.reduce((s, r) => s + r.transaction_count, 0);
  const prevTx = prevSales.reduce((s, r) => s + r.transaction_count, 0);
  const txTrend = prevTx > 0 ? ((dayTx - prevTx) / prevTx) * 100 : null;
  const txStatus = txTrend !== null && txTrend >= 0 ? "success" : "warning";

  const totalLabourCost = labour.reduce((s, r) => s + r.total_cost, 0);
  const labourPct = dayRev > 0 ? (totalLabourCost / dayRev) * 100 : null;

  const labourTargetVals = restaurantIds
    .map(rid => targets.find(r => r.restaurant_id === rid && r.metric === TARGET_METRICS.LABOUR_COST_PCT && r.day_of_week === null)?.value ?? null)
    .filter((v): v is number => v !== null);
  const labourTarget = labourTargetVals.length ? labourTargetVals.reduce((a, b) => a + b, 0) / labourTargetVals.length : null;

  const labourStatus =
    labourPct === null || !labourTarget ? "success"
    : labourPct >= labourTarget + 5 ? "destructive"
    : labourPct >= labourTarget ? "warning"
    : "success";

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
          {dayTx > 0 ? dayTx.toLocaleString("en-AU") : "—"}
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
          <span className="text-xs text-muted-foreground">vs prev day</span>
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
