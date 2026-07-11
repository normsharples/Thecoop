import { useQuery } from "@tanstack/react-query";
import { format, subDays, parseISO } from "date-fns";
import { Receipt, Gauge, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import type { SalesDaily, LabourDaily } from "@/types";

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
        { data: prevLabour },
      ] = await Promise.all([
        supabase.from("sales_daily").select("total_sales, transaction_count").eq("date", date).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("total_sales, transaction_count").eq("date", prevDay).in("restaurant_id", restaurantIds),
        supabase.from("labour_daily").select("total_hours").eq("date", date).in("restaurant_id", restaurantIds),
        supabase.from("labour_daily").select("total_hours").eq("date", prevDay).in("restaurant_id", restaurantIds),
      ]);
      return {
        sales: (sales ?? []) as SalesDaily[],
        prevSales: (prevSales ?? []) as SalesDaily[],
        labour: (labour ?? []) as LabourDaily[],
        prevLabour: (prevLabour ?? []) as LabourDaily[],
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

  const { sales, prevSales, labour, prevLabour } = data;

  const dayTx = sales.reduce((s, r) => s + r.transaction_count, 0);
  const prevTx = prevSales.reduce((s, r) => s + r.transaction_count, 0);
  const txTrend = prevTx > 0 ? ((dayTx - prevTx) / prevTx) * 100 : null;
  const txStatus = txTrend !== null && txTrend >= 0 ? "success" : "warning";

  // Group SPMH = total gross sales ÷ total actual hours across the visible restaurants.
  const grossSales = sales.reduce((s, r) => s + r.total_sales, 0);
  const labourHours = labour.reduce((s, r) => s + Number(r.total_hours), 0);
  const spmh = labourHours > 0 ? grossSales / labourHours : null;
  const prevGross = prevSales.reduce((s, r) => s + r.total_sales, 0);
  const prevHours = prevLabour.reduce((s, r) => s + Number(r.total_hours), 0);
  const prevSpmh = prevHours > 0 ? prevGross / prevHours : null;
  const spmhTrend = spmh !== null && prevSpmh !== null && prevSpmh > 0
    ? ((spmh - prevSpmh) / prevSpmh) * 100 : null;
  const spmhStatus = spmhTrend !== null && spmhTrend >= 0 ? "success" : "warning";

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

      {/* SPMH (Sales Per Man Hour) */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">SPMH (Sales Per Man Hour)</p>
          <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
            <Gauge className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold">
          {spmh !== null ? formatCurrency(spmh) : "—"}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          {spmhTrend !== null ? (
            <>
              {spmhTrend > 0 ? (
                <TrendingUp className={cn("h-4 w-4", spmhStatus === "success" ? "text-green-500" : "text-red-500")} />
              ) : spmhTrend < 0 ? (
                <TrendingDown className={cn("h-4 w-4", spmhStatus === "success" ? "text-green-500" : "text-red-500")} />
              ) : (
                <Minus className="h-4 w-4 text-muted-foreground" />
              )}
              <span className={cn("text-sm font-medium", spmhStatus === "success" ? "text-green-500" : "text-amber-500")}>
                {spmhTrend > 0 ? "+" : ""}{spmhTrend.toFixed(1)}%
              </span>
            </>
          ) : (
            <span className="text-sm font-medium text-muted-foreground">—</span>
          )}
          <span className="text-xs text-muted-foreground">vs prev day</span>
        </div>
      </div>
    </>
  );
}
