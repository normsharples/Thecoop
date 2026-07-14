import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, CalendarDays, CreditCard, Star,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import {
  format, startOfWeek, endOfWeek, subWeeks, subYears, parseISO,
} from "date-fns";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useGoogleRatings, combineRatings, totalReviewCount } from "@/hooks/useGoogleRatings";
import { TARGET_METRICS } from "@/hooks/useTargets";
import type { Target, SalesDaily, LabourDaily } from "@/types";

function weeklyTargetFromDaily(targets: Target[], restaurantIds: string[]): number | null {
  let total = 0;
  let found = false;
  for (const rid of restaurantIds) {
    for (let dow = 0; dow <= 6; dow++) {
      const t = targets.find(
        (r) => r.restaurant_id === rid && r.metric === TARGET_METRICS.DAILY_SALES && r.day_of_week === dow
      );
      if (t) { total += t.value; found = true; }
    }
  }
  return found ? total : null;
}

export function WeeklySnapshot({ date }: { date: string }) {
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
  const prevYearWeekStart = subYears(weekStart, 1);
  const prevYearWeekEnd = subYears(weekEnd, 1);

  // Current overall Google rating per store (from the daily snapshot table).
  const { data: ratingMap } = useGoogleRatings(restaurantIds);

  const wsStr = format(weekStart, "yyyy-MM-dd");
  const weStr = format(weekEnd, "yyyy-MM-dd");
  const pwsStr = format(prevWeekStart, "yyyy-MM-dd");
  const pweStr = format(prevWeekEnd, "yyyy-MM-dd");
  const pyWsStr = format(prevYearWeekStart, "yyyy-MM-dd");
  const pyWeStr = format(prevYearWeekEnd, "yyyy-MM-dd");

  const lyDateLabel = `${format(prevYearWeekStart, "d MMM")} – ${format(prevYearWeekEnd, "d MMM yyyy")}`;

  const { data, isLoading } = useQuery({
    queryKey: ["weekly-snapshot", wsStr, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return null;
      const [
        { data: sales },
        { data: prevSales },
        { data: prevYearSales },
        { data: labour },
        { data: targetRows },
      ] = await Promise.all([
        supabase.from("sales_daily").select("*").gte("date", wsStr).lte("date", weStr).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("*").gte("date", pwsStr).lte("date", pweStr).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").gte("date", pyWsStr).lte("date", pyWeStr).in("restaurant_id", restaurantIds),
        supabase.from("labour_daily").select("*").gte("date", wsStr).lte("date", weStr).in("restaurant_id", restaurantIds),
        supabase.from("targets").select("*").in("restaurant_id", restaurantIds),
      ]);
      return {
        sales: (sales ?? []) as SalesDaily[],
        prevSales: (prevSales ?? []) as SalesDaily[],
        prevYearSales: (prevYearSales ?? []) as SalesDaily[],
        labour: (labour ?? []) as LabourDaily[],
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

  const { sales, prevSales, prevYearSales, targets } = data;

  // Revenue
  const weekRev = sales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const prevRev = prevSales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const prevYearRev = prevYearSales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const salesTrend = prevRev > 0 ? ((weekRev - prevRev) / prevRev) * 100 : null;
  const yoyTrend = prevYearRev > 0 ? ((weekRev - prevYearRev) / prevYearRev) * 100 : null;

  const weekGross = sales.reduce((s, r) => s + r.total_sales, 0);
  const prevYearGross = prevYearSales.reduce((s, r) => s + r.total_sales, 0);

  // Targets
  const weeklyTarget =
    weeklyTargetFromDaily(targets, restaurantIds) ??
    targets.find((t) => t.metric === TARGET_METRICS.WEEKLY_SALES && t.day_of_week === null)?.value ??
    null;

  // Transactions & avg tx
  const weekTx = sales.reduce((s, r) => s + r.transaction_count, 0);
  const prevTx = prevSales.reduce((s, r) => s + r.transaction_count, 0);
  const weekAvgTx = weekTx > 0 ? weekRev / weekTx : null;
  const prevAvgTx = prevTx > 0 ? prevRev / prevTx : null;
  const avgTxTrend = weekAvgTx !== null && prevAvgTx !== null ? ((weekAvgTx - prevAvgTx) / prevAvgTx) * 100 : null;

  // Rating — current overall Google rating across the shown store(s).
  const storeRatings = Object.values(ratingMap ?? {});
  const avgRating = combineRatings(storeRatings);
  const ratingReviews = totalReviewCount(storeRatings);

  type StatStatus = "success" | "warning" | "destructive";

  const stats = [
    {
      label: "Weekly Revenue (Net)",
      value: weekRev > 0 ? formatCurrency(weekRev) : "—",
      grossValue: weekGross > 0 ? formatCurrency(weekGross) : "—",
      trend: salesTrend,
      trendLabel: "vs prev week",
      subLabel: weeklyTarget ? `target ${formatCurrency(weeklyTarget)}` : undefined,
      icon: <DollarSign className="h-4 w-4" />,
      status: (salesTrend !== null && salesTrend >= 0 ? "success" : "warning") as StatStatus,
    },
    {
      label: "Same Week Last Year (Net)",
      value: prevYearRev > 0 ? formatCurrency(prevYearRev) : "—",
      grossValue: prevYearGross > 0 ? formatCurrency(prevYearGross) : "—",
      trend: yoyTrend,
      trendLabel: "vs this week",
      subLabel: lyDateLabel,
      icon: <CalendarDays className="h-4 w-4" />,
      status: (yoyTrend !== null && yoyTrend >= 0 ? "success" : "warning") as StatStatus,
    },
    {
      label: "Avg Transaction",
      value: weekAvgTx !== null ? formatCurrency(weekAvgTx) : "—",
      grossValue: undefined as string | undefined,
      trend: avgTxTrend,
      trendLabel: "vs prev week",
      subLabel: undefined,
      icon: <CreditCard className="h-4 w-4" />,
      status: (avgTxTrend !== null && avgTxTrend >= 0 ? "success" : "warning") as StatStatus,
    },
    {
      label: "Google Rating",
      value: avgRating !== null ? avgRating.toFixed(1) : "—",
      grossValue: undefined as string | undefined,
      trend: null as number | null,
      trendLabel: "current",
      subLabel: ratingReviews !== null ? `${ratingReviews.toLocaleString()} reviews` : undefined,
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
                {stat.label === "Google Rating"
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
