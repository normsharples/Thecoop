import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, CalendarDays, CreditCard, Star,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { format, subDays, subYears, subMonths, parseISO } from "date-fns";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { TARGET_METRICS } from "@/hooks/useTargets";
import type { SalesDaily, Target } from "@/types";

export function DailySnapshot({ date }: { date: string }) {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const restaurantIds: string[] = selectedRestaurantId
    ? [selectedRestaurantId]
    : (restaurants?.map((r) => r.id) ?? []);

  const prevDay = format(subDays(parseISO(date), 1), "yyyy-MM-dd");
  const lyDay = format(subYears(parseISO(date), 1), "yyyy-MM-dd");
  const reviewStart = format(subMonths(parseISO(date), 1), "yyyy-MM-dd");

  // 0=Mon…6=Sun to match targets.day_of_week
  const dow = parseISO(date).getDay() === 0 ? 6 : parseISO(date).getDay() - 1;

  const { data, isLoading } = useQuery({
    queryKey: ["daily-snapshot", date, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return null;
      const [
        { data: sales },
        { data: prevSales },
        { data: lySales },
        { data: reviews },
        { data: targetRows },
      ] = await Promise.all([
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", date).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", prevDay).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", lyDay).in("restaurant_id", restaurantIds),
        supabase.from("google_reviews").select("rating").in("restaurant_id", restaurantIds).gte("review_date", reviewStart).lte("review_date", date),
        supabase.from("targets").select("*").in("restaurant_id", restaurantIds),
      ]);
      return {
        sales: (sales ?? []) as SalesDaily[],
        prevSales: (prevSales ?? []) as SalesDaily[],
        lySales: (lySales ?? []) as SalesDaily[],
        reviews: (reviews ?? []) as { rating: number }[],
        targets: (targetRows ?? []) as Target[],
      };
    },
    enabled: !!restaurantIds.length,
    staleTime: 1000 * 60 * 5,
  });

  if (!data || isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  const { sales, prevSales, lySales, reviews, targets } = data;

  const dayRev = sales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const prevDayRev = prevSales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const lyDayRev = lySales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const salesTrend = prevDayRev > 0 ? ((dayRev - prevDayRev) / prevDayRev) * 100 : null;
  const yoyTrend = lyDayRev > 0 ? ((dayRev - lyDayRev) / lyDayRev) * 100 : null;

  const dayGross = sales.reduce((s, r) => s + r.total_sales, 0);
  const lyDayGross = lySales.reduce((s, r) => s + r.total_sales, 0);

  const dayTx = sales.reduce((s, r) => s + r.transaction_count, 0);
  const prevDayTx = prevSales.reduce((s, r) => s + r.transaction_count, 0);
  const dayAvgTx = dayTx > 0 ? dayRev / dayTx : null;
  const prevAvgTx = prevDayTx > 0 ? prevDayRev / prevDayTx : null;
  const avgTxTrend = dayAvgTx !== null && prevAvgTx !== null
    ? ((dayAvgTx - prevAvgTx) / prevAvgTx) * 100
    : null;

  const dailySalesTarget = restaurantIds.reduce((sum, rid) => {
    const t = targets.find(r => r.restaurant_id === rid && r.metric === TARGET_METRICS.DAILY_SALES && r.day_of_week === dow);
    return t ? sum + t.value : sum;
  }, 0) || null;

  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : null;

  type StatStatus = "success" | "warning" | "destructive";

  const stats = [
    {
      label: "Daily Revenue (Net)",
      value: dayRev > 0 ? formatCurrency(dayRev) : "—",
      grossValue: dayGross > 0 ? formatCurrency(dayGross) : "—",
      trend: salesTrend,
      trendLabel: "vs prev day",
      subLabel: dailySalesTarget ? `target ${formatCurrency(dailySalesTarget)}` : undefined,
      icon: <DollarSign className="h-4 w-4" />,
      status: (salesTrend !== null && salesTrend >= 0 ? "success" : "warning") as StatStatus,
    },
    {
      label: "Same Day Last Year (Net)",
      value: lyDayRev > 0 ? formatCurrency(lyDayRev) : "—",
      grossValue: lyDayGross > 0 ? formatCurrency(lyDayGross) : "—",
      trend: yoyTrend,
      trendLabel: "vs today",
      subLabel: format(parseISO(lyDay), "d MMM yyyy"),
      icon: <CalendarDays className="h-4 w-4" />,
      status: (yoyTrend !== null && yoyTrend >= 0 ? "success" : "warning") as StatStatus,
    },
    {
      label: "Avg Transaction",
      value: dayAvgTx !== null ? formatCurrency(dayAvgTx) : "—",
      grossValue: undefined as string | undefined,
      trend: avgTxTrend,
      trendLabel: "vs prev day",
      subLabel: undefined,
      icon: <CreditCard className="h-4 w-4" />,
      status: (avgTxTrend !== null && avgTxTrend >= 0 ? "success" : "warning") as StatStatus,
    },
    {
      label: "Avg Rating",
      value: avgRating !== null ? avgRating.toFixed(1) : "—",
      grossValue: undefined as string | undefined,
      trend: null as number | null,
      trendLabel: "30-day avg",
      subLabel: undefined,
      icon: <Star className="h-4 w-4" />,
      status: (avgRating !== null
        ? avgRating >= 4.5 ? "success" : avgRating >= 4.0 ? "warning" : "destructive"
        : "success") as StatStatus,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{stat.label}</p>
            <div className="rounded-md bg-muted p-1.5 text-muted-foreground">{stat.icon}</div>
          </div>
          <p className="mt-2 text-2xl font-bold">{stat.value}</p>
          {stat.grossValue !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">Gross: {stat.grossValue}</p>
          )}
          {stat.subLabel && (
            <p className="mt-0.5 text-xs text-muted-foreground">{stat.subLabel}</p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            {stat.trend !== null ? (
              <>
                {stat.trend > 0 ? (
                  <TrendingUp className={cn("h-4 w-4", stat.status === "success" ? "text-green-500" : "text-red-500")} />
                ) : stat.trend < 0 ? (
                  <TrendingDown className={cn("h-4 w-4", stat.status === "success" ? "text-green-500" : "text-red-500")} />
                ) : (
                  <Minus className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={cn(
                  "text-sm font-medium",
                  stat.status === "success" && "text-green-500",
                  stat.status === "warning" && "text-amber-500",
                  stat.status === "destructive" && "text-red-500",
                )}>
                  {stat.trend > 0 ? "+" : ""}{stat.trend.toFixed(1)}%
                </span>
              </>
            ) : (
              <span className={cn(
                "text-sm font-medium",
                stat.status === "success" && "text-green-500",
                stat.status === "warning" && "text-amber-500",
                stat.status === "destructive" && "text-red-500",
              )}>
                {stat.label === "Avg Rating"
                  ? (avgRating !== null
                    ? avgRating >= 4.5 ? "Excellent" : avgRating >= 4.0 ? "Good" : "Needs work"
                    : "No data")
                  : stat.status === "destructive" ? "Over target"
                  : stat.status === "warning" ? "Near target"
                  : "On target"}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{stat.trendLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
