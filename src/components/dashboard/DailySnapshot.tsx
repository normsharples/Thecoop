import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format, subDays, subYears, parseISO } from "date-fns";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useScopedRestaurantIds } from "@/contexts/WidgetScope";
import { useGoogleRatings, combineRatings, totalReviewCount } from "@/hooks/useGoogleRatings";
import { TARGET_METRICS } from "@/hooks/useTargets";
import type { SalesDaily, Target } from "@/types";

export function DailySnapshot({ date }: { date: string }) {
  const { data: restaurants } = useRestaurants();
  const selectedRestaurantIds = useScopedRestaurantIds();

  const restaurantIds: string[] = selectedRestaurantIds.length
    ? selectedRestaurantIds
    : (restaurants?.map((r) => r.id) ?? []);

  const prevDay = format(subDays(parseISO(date), 1), "yyyy-MM-dd");
  const lyDay = format(subYears(parseISO(date), 1), "yyyy-MM-dd");

  // Current overall Google rating per store (from the daily snapshot table).
  const { data: ratingMap } = useGoogleRatings(restaurantIds);

  // 0=Mon…6=Sun to match targets.day_of_week
  const dow = parseISO(date).getDay() === 0 ? 6 : parseISO(date).getDay() - 1;

  const { data, isLoading } = useQuery({
    queryKey: ["daily-snapshot", date, restaurantIds.join(",")],
    queryFn: async () => {
      if (!restaurantIds.length) return null;
      const [
        { data: sales },
        { data: prevSales },
        { data: lySales },
        { data: targetRows },
      ] = await Promise.all([
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", date).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", prevDay).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("net_sales, total_sales, transaction_count").eq("date", lyDay).in("restaurant_id", restaurantIds),
        supabase.from("targets").select("*").in("restaurant_id", restaurantIds),
      ]);
      return {
        sales: (sales ?? []) as SalesDaily[],
        prevSales: (prevSales ?? []) as SalesDaily[],
        lySales: (lySales ?? []) as SalesDaily[],
        targets: (targetRows ?? []) as Target[],
      };
    },
    enabled: !!restaurantIds.length,
    staleTime: 1000 * 60 * 5,
  });

  if (!data || isLoading) {
    return (
      <div className="h-[168px] animate-pulse rounded-xl border border-border bg-card" />
    );
  }

  const { sales, prevSales, lySales, targets } = data;

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

  // Current overall Google rating across the shown store(s).
  const storeRatings = Object.values(ratingMap ?? {});
  const avgRating = combineRatings(storeRatings);
  const ratingReviews = totalReviewCount(storeRatings);

  const ratingWord =
    avgRating === null ? "No data"
    : avgRating >= 4.5 ? "Excellent"
    : avgRating >= 4.0 ? "Good"
    : "Needs work";

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap gap-x-10 gap-y-7 p-5 lg:p-6">

        {/* The hero. One number leads the page — everything else supports it. */}
        <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-2.5">
          <p className="eyebrow">Net revenue</p>
          <div className="flex flex-wrap items-baseline gap-3.5">
            <span className="text-[44px] font-semibold leading-none tracking-[-0.025em] tabular-nums">
              {dayRev > 0 ? formatCurrency(dayRev) : "—"}
            </span>
            <Delta trend={salesTrend} />
          </div>
          <p className="text-xs text-muted-foreground">
            {dayGross > 0 ? `${formatCurrency(dayGross)} gross` : "No sales recorded"}
            {dailySalesTarget ? ` · target ${formatCurrency(dailySalesTarget)}` : ""}
          </p>
        </div>

        <div className="grid flex-1 basis-[320px] grid-cols-1 gap-7 sm:grid-cols-3">
          <Figure
            label="Avg transaction"
            value={dayAvgTx !== null ? formatCurrency(dayAvgTx) : "—"}
            note={`${dayTx.toLocaleString()} transactions`}
            trend={avgTxTrend}
          />
          <Figure
            label="Same day last year"
            value={lyDayRev > 0 ? formatCurrency(lyDayRev) : "—"}
            note={lyDayGross > 0
              ? `${formatCurrency(lyDayGross)} gross · ${format(parseISO(lyDay), "d MMM yyyy")}`
              : format(parseISO(lyDay), "d MMM yyyy")}
            trend={yoyTrend}
          />
          <Figure
            label="Google rating"
            value={avgRating !== null ? avgRating.toFixed(1) : "—"}
            note={ratingReviews !== null
              ? `${ratingWord} · ${ratingReviews.toLocaleString()} reviews`
              : ratingWord}
            tone={avgRating === null ? "muted"
              : avgRating >= 4.5 ? "success"
              : avgRating >= 4.0 ? "warning"
              : "destructive"}
          />
        </div>
      </div>
    </section>
  );
}

/** A supporting figure: eyebrow, value, one line of context. */
function Figure({
  label, value, note, trend, tone,
}: {
  label: string;
  value: string;
  note: string;
  trend?: number | null;
  tone?: "success" | "warning" | "destructive" | "muted";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="eyebrow">{label}</p>
      <p className="text-2xl font-semibold leading-tight tracking-[-0.02em] tabular-nums">{value}</p>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {tone && tone !== "muted" && (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              tone === "success" && "bg-success",
              tone === "warning" && "bg-warning",
              tone === "destructive" && "bg-destructive",
            )}
          />
        )}
        {trend !== undefined && trend !== null && (
          <span className={cn("font-medium", trend >= 0 ? "text-success" : "text-destructive")}>
            {trend > 0 ? "+" : ""}{trend.toFixed(1)}%
          </span>
        )}
        <span className="truncate">{note}</span>
      </p>
    </div>
  );
}

/** The one place a percentage change is set loud: beside the hero figure. */
function Delta({ trend }: { trend: number | null }) {
  if (trend === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
        <Minus className="h-3 w-3" />
        No comparison
      </span>
    );
  }
  const up = trend >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        up ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive",
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {trend > 0 ? "+" : ""}{trend.toFixed(1)}%
      <span className="font-normal opacity-80">vs prev day</span>
    </span>
  );
}
