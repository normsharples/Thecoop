import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, subYears, parseISO } from "date-fns";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useGoogleRatings } from "@/hooks/useGoogleRatings";
import type { SalesDaily, LabourDaily } from "@/types";

type Status = "success" | "warning" | "destructive";

function StatusDot({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        status === "success" && "bg-green-500",
        status === "warning" && "bg-amber-500",
        status === "destructive" && "bg-red-500"
      )}
    />
  );
}

function labourStatus(percent: number): Status {
  if (percent >= 35) return "destructive";
  if (percent >= 30) return "warning";
  return "success";
}

function ratingStatus(rating: number): Status {
  if (rating >= 4.5) return "success";
  if (rating >= 4.0) return "warning";
  return "destructive";
}

export function WeeklyStatsCards({ date }: { date: string }) {
  const { data: restaurants, isLoading: restaurantsLoading } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const anchor = parseISO(date);
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });

  const wsStr = format(weekStart, "yyyy-MM-dd");
  const weStr = format(weekEnd, "yyyy-MM-dd");
  const prevYearWsStr = format(subYears(weekStart, 1), "yyyy-MM-dd");
  const prevYearWeStr = format(subYears(weekEnd, 1), "yyyy-MM-dd");

  const visibleRestaurants = selectedRestaurantId
    ? restaurants?.filter((r) => r.id === selectedRestaurantId)
    : restaurants;

  const { data: salesData } = useQuery({
    queryKey: ["weekly-stats-sales", wsStr, selectedRestaurantId],
    queryFn: async () => {
      const ids = visibleRestaurants?.map((r) => r.id) ?? [];
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("restaurant_id, net_sales, total_sales, transaction_count")
        .gte("date", wsStr)
        .lte("date", weStr)
        .in("restaurant_id", ids);
      if (error) throw error;
      return data as SalesDaily[];
    },
    enabled: !!visibleRestaurants?.length,
  });

  const { data: prevYearSalesData } = useQuery({
    queryKey: ["weekly-stats-prev-year-sales", prevYearWsStr, selectedRestaurantId],
    queryFn: async () => {
      const ids = visibleRestaurants?.map((r) => r.id) ?? [];
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("restaurant_id, net_sales, total_sales")
        .gte("date", prevYearWsStr)
        .lte("date", prevYearWeStr)
        .in("restaurant_id", ids);
      if (error) throw error;
      return data as SalesDaily[];
    },
    enabled: !!visibleRestaurants?.length,
  });

  const { data: labourData } = useQuery({
    queryKey: ["weekly-stats-labour", wsStr, selectedRestaurantId],
    queryFn: async () => {
      const ids = visibleRestaurants?.map((r) => r.id) ?? [];
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("labour_daily")
        .select("restaurant_id, total_cost, labour_percent, total_hours")
        .gte("date", wsStr)
        .lte("date", weStr)
        .in("restaurant_id", ids);
      if (error) throw error;
      return data as LabourDaily[];
    },
    enabled: !!visibleRestaurants?.length,
  });

  // Current overall Google rating per store (from the daily snapshot table).
  const { data: ratingMap } = useGoogleRatings(visibleRestaurants?.map((r) => r.id) ?? []);

  if (restaurantsLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visibleRestaurants?.map((restaurant) => {
        const storeSales = salesData?.filter((s) => s.restaurant_id === restaurant.id) ?? [];
        const prevYearStoreSales = prevYearSalesData?.filter((s) => s.restaurant_id === restaurant.id) ?? [];
        const storeLabour = labourData?.filter((l) => l.restaurant_id === restaurant.id) ?? [];

        const weeklyRevenue = storeSales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
        const prevYearRevenue = prevYearStoreSales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
        const weeklyGross = storeSales.reduce((s, r) => s + r.total_sales, 0);
        const yoyPct =
          weeklyRevenue > 0 && prevYearRevenue > 0
            ? ((weeklyRevenue - prevYearRevenue) / prevYearRevenue) * 100
            : null;
        const totalLabourCost = storeLabour.reduce((s, r) => s + r.total_cost, 0);
        const labourPct = weeklyRevenue > 0 ? (totalLabourCost / weeklyRevenue) * 100 : null;
        const totalLabourHours = storeLabour.reduce((s, r) => s + Number(r.total_hours), 0);
        const spmh = totalLabourHours > 0 ? weeklyGross / totalLabourHours : null;
        const avgRating = ratingMap?.[restaurant.id]?.rating ?? null;

        return (
          <div key={restaurant.id} className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-base font-semibold">{restaurant.name}</h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Weekly Revenue</span>
                <div className="flex flex-col items-end gap-0.5">
                  <div className="flex items-center gap-2">
                    {yoyPct !== null && (
                      <span className={cn("text-xs font-medium", yoyPct >= 0 ? "text-green-500" : "text-red-400")}>
                        {yoyPct >= 0 ? "+" : ""}{yoyPct.toFixed(1)}% YoY
                      </span>
                    )}
                    <span className="text-sm font-medium">
                      {weeklyRevenue > 0 ? formatCurrency(weeklyRevenue) : "—"} <span className="text-[10px] font-normal text-muted-foreground">net</span>
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {weeklyGross > 0 ? formatCurrency(weeklyGross) : "—"} gross
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Labour %</span>
                <div className="flex items-center gap-2">
                  {labourPct !== null && <StatusDot status={labourStatus(labourPct)} />}
                  <span
                    className={cn(
                      "text-sm font-medium",
                      labourPct !== null && labourStatus(labourPct) === "destructive" && "text-red-400",
                      labourPct !== null && labourStatus(labourPct) === "warning" && "text-amber-400"
                    )}
                  >
                    {labourPct !== null ? formatPercent(labourPct) : "—"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Sales / Hour</span>
                <span className="text-sm font-medium">
                  {spmh !== null ? formatCurrency(spmh) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Google Rating</span>
                <div className="flex items-center gap-2">
                  {avgRating !== null && <StatusDot status={ratingStatus(avgRating)} />}
                  <span className="text-sm font-medium">
                    {avgRating !== null ? avgRating.toFixed(1) : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
