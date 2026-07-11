import { useQuery } from "@tanstack/react-query";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { format, parseISO, subYears } from "date-fns";

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

export function QuickStatsCards({ date }: { date?: string }) {
  const { data: restaurants, isLoading: restaurantsLoading } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const today = date ?? format(new Date(), "yyyy-MM-dd");
  const prevYearDate = format(subYears(parseISO(today), 1), "yyyy-MM-dd");

  const visibleRestaurants = selectedRestaurantId
    ? restaurants?.filter((r) => r.id === selectedRestaurantId)
    : restaurants;

  const { data: salesData } = useQuery({
    queryKey: ["sales-today", today, selectedRestaurantId],
    queryFn: async () => {
      const ids = visibleRestaurants?.map((r) => r.id) ?? [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("*")
        .eq("date", today)
        .in("restaurant_id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!visibleRestaurants?.length,
  });

  const { data: prevYearSalesData } = useQuery({
    queryKey: ["sales-prev-year", prevYearDate, selectedRestaurantId],
    queryFn: async () => {
      const ids = visibleRestaurants?.map((r) => r.id) ?? [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("*")
        .eq("date", prevYearDate)
        .in("restaurant_id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!visibleRestaurants?.length,
  });

  const { data: labourData } = useQuery({
    queryKey: ["labour-today", today, selectedRestaurantId],
    queryFn: async () => {
      const ids = visibleRestaurants?.map((r) => r.id) ?? [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("labour_daily")
        .select("*")
        .eq("date", today)
        .in("restaurant_id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!visibleRestaurants?.length,
  });

  const { data: reviewsData } = useQuery({
    queryKey: ["reviews-avg", selectedRestaurantId],
    queryFn: async () => {
      const ids = visibleRestaurants?.map((r) => r.id) ?? [];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("google_reviews")
        .select("restaurant_id, rating")
        .in("restaurant_id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!visibleRestaurants?.length,
  });

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
        const sales = salesData?.find((s) => s.restaurant_id === restaurant.id);
        const prevYearSales = prevYearSalesData?.find((s) => s.restaurant_id === restaurant.id);
        const labour = labourData?.find((l) => l.restaurant_id === restaurant.id);
        const restaurantReviews = reviewsData?.filter((r) => r.restaurant_id === restaurant.id);
        const avgRating = restaurantReviews?.length
          ? restaurantReviews.reduce((sum, r) => sum + r.rating, 0) / restaurantReviews.length
          : null;

        const labourPct = labour?.labour_percent ?? null;
        const rating = avgRating;

        const labourHours = labour?.total_hours ?? null;
        const grossSales = sales?.total_sales ?? null;
        const spmh = grossSales !== null && labourHours && labourHours > 0
          ? grossSales / labourHours : null;

        const currentSales = sales?.net_sales ?? sales?.total_sales ?? null;
        const priorSales = prevYearSales?.net_sales ?? prevYearSales?.total_sales ?? null;
        const yoyPct =
          currentSales !== null && priorSales !== null && priorSales > 0
            ? ((currentSales - priorSales) / priorSales) * 100
            : null;

        return (
          <div key={restaurant.id} className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-base font-semibold">{restaurant.name}</h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Sales Today</span>
                <div className="flex flex-col items-end gap-0.5">
                  <div className="flex items-center gap-2">
                    {yoyPct !== null && (
                      <span className={cn("text-xs font-medium", yoyPct >= 0 ? "text-green-500" : "text-red-400")}>
                        {yoyPct >= 0 ? "+" : ""}{yoyPct.toFixed(1)}% YoY
                      </span>
                    )}
                    <span className="text-sm font-medium">
                      {currentSales !== null ? formatCurrency(currentSales) : "—"} <span className="text-[10px] font-normal text-muted-foreground">net</span>
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {sales ? formatCurrency(sales.total_sales) : "—"} gross
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
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Avg Rating</span>
                <div className="flex items-center gap-2">
                  {rating !== null && <StatusDot status={ratingStatus(rating)} />}
                  <span className="text-sm font-medium">
                    {rating !== null ? rating.toFixed(1) : "—"}
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
