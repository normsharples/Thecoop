import { useQuery } from "@tanstack/react-query";
import { DollarSign, Receipt, Users, Star, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { format, subDays, parseISO } from "date-fns";

export function TodaySnapshot({ date }: { date?: string }) {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const today = date ?? format(new Date(), "yyyy-MM-dd");
  const yesterday = format(subDays(parseISO(today), 1), "yyyy-MM-dd");

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants?.map((r) => r.id) ?? [];

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["snapshot-sales", today, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("*")
        .in("date", [today, yesterday])
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantIds.length,
  });

  const { data: labourData } = useQuery({
    queryKey: ["snapshot-labour", today, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("labour_daily")
        .select("*")
        .eq("date", today)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantIds.length,
  });

  const { data: reviewsData } = useQuery({
    queryKey: ["snapshot-reviews", selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("google_reviews")
        .select("rating")
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantIds.length,
  });

  // Aggregate across all visible restaurants
  const todaySales = salesData?.filter((s) => s.date === today) ?? [];
  const yesterdaySales = salesData?.filter((s) => s.date === yesterday) ?? [];

  const totalSalesToday = todaySales.reduce((sum, s) => sum + Number(s.total_sales), 0);
  const totalSalesYesterday = yesterdaySales.reduce((sum, s) => sum + Number(s.total_sales), 0);
  const totalTransactions = todaySales.reduce((sum, s) => sum + Number(s.transaction_count), 0);
  const totalTransactionsYest = yesterdaySales.reduce((sum, s) => sum + Number(s.transaction_count), 0);

  const avgLabour = labourData?.length
    ? labourData.reduce((sum, l) => sum + Number(l.labour_percent), 0) / labourData.length
    : null;

  const avgRating = reviewsData?.length
    ? reviewsData.reduce((sum, r) => sum + Number(r.rating), 0) / reviewsData.length
    : null;

  const salesTrend = totalSalesYesterday > 0
    ? ((totalSalesToday - totalSalesYesterday) / totalSalesYesterday) * 100
    : null;
  const txTrend = totalTransactionsYest > 0
    ? ((totalTransactions - totalTransactionsYest) / totalTransactionsYest) * 100
    : null;

  const isToday = today === format(new Date(), "yyyy-MM-dd");

  const stats = [
    {
      label: isToday ? "Today's Sales" : "Sales",
      value: totalSalesToday > 0 ? formatCurrency(totalSalesToday) : "—",
      trend: salesTrend,
      trendLabel: "vs prev day",
      icon: <DollarSign className="h-5 w-5" />,
      isLoading: salesLoading,
    },
    {
      label: "Transactions",
      value: totalTransactions > 0 ? totalTransactions.toString() : "—",
      trend: txTrend,
      trendLabel: "vs prev day",
      icon: <Receipt className="h-5 w-5" />,
      isLoading: salesLoading,
    },
    {
      label: "Labour %",
      value: avgLabour !== null ? formatPercent(avgLabour) : "—",
      trend: null,
      trendLabel: "target <30%",
      icon: <Users className="h-5 w-5" />,
      isLoading: false,
      status: avgLabour !== null
        ? avgLabour >= 35 ? "destructive" : avgLabour >= 30 ? "warning" : "success"
        : "success",
    },
    {
      label: "Google Rating",
      value: avgRating !== null ? avgRating.toFixed(1) : "—",
      trend: null,
      trendLabel: "avg across stores",
      icon: <Star className="h-5 w-5" />,
      isLoading: false,
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => {
        const status = "status" in stat ? stat.status : (stat.trend !== null && stat.trend >= 0 ? "success" : "warning");
        return (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <div className="rounded-lg bg-muted p-2 text-muted-foreground">{stat.icon}</div>
            </div>
            {stat.isLoading ? (
              <div className="mt-3 h-9 w-24 animate-pulse rounded bg-muted" />
            ) : (
              <p className="mt-3 text-3xl font-bold">{stat.value}</p>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              {stat.trend !== null ? (
                <>
                  {stat.trend > 0 ? (
                    <TrendingUp className={cn("h-4 w-4", status === "success" ? "text-green-500" : "text-red-500")} />
                  ) : stat.trend < 0 ? (
                    <TrendingDown className={cn("h-4 w-4", status === "success" ? "text-green-500" : "text-red-500")} />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={cn(
                    "text-sm font-medium",
                    status === "success" && "text-green-500",
                    status === "warning" && "text-amber-500",
                    status === "destructive" && "text-red-500"
                  )}>
                    {stat.trend > 0 ? "+" : ""}{stat.trend.toFixed(1)}%
                  </span>
                </>
              ) : (
                <span className={cn(
                  "text-sm font-medium",
                  status === "success" && "text-green-500",
                  status === "warning" && "text-amber-500",
                  status === "destructive" && "text-red-500"
                )}>
                  {"status" in stat && stat.status === "destructive" ? "Over target" :
                   "status" in stat && stat.status === "warning" ? "Near target" :
                   "status" in stat ? "On target" : ""}
                </span>
              )}
              <span className="text-xs text-muted-foreground">{stat.trendLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
