import { useQuery } from "@tanstack/react-query";
import { format, subDays, subMonths, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { TARGET_METRICS } from "@/hooks/useTargets";
import { cn } from "@/lib/utils";
import type { Target, SalesDaily, LabourDaily, GoogleReview } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsDayToTargetDow(jsDay: number) {
  return jsDay === 0 ? 6 : jsDay - 1;
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function getTargetVal(
  targets: Target[],
  restaurantIds: string[],
  metric: string,
  dayOfWeek?: number | null
): number | null {
  const vals = restaurantIds
    .map((rid) => {
      const t = targets.find(
        (r) =>
          r.restaurant_id === rid &&
          r.metric === metric &&
          (dayOfWeek === undefined || dayOfWeek === null
            ? r.day_of_week === null
            : r.day_of_week === dayOfWeek)
      );
      return t?.value ?? null;
    })
    .filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const BRAND = "#1a4d2e";

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      className="text-center py-2.5 text-sm font-bold uppercase tracking-widest text-white"
      style={{ background: BRAND }}
    >
      {title}
    </div>
  );
}

type MetricStatus = "good" | "warn" | "bad" | "neutral";

function indexColor(status: MetricStatus) {
  if (status === "good") return "#22863a";
  if (status === "warn") return "#b45309";
  if (status === "bad") return "#dc2626";
  return undefined;
}

interface MetricBoxProps {
  label: string;
  value: string;
  subLabel?: string;
  large?: boolean;
  status?: MetricStatus;
  className?: string;
}

function MetricBox({ label, value, subLabel, large, status = "neutral", className }: MetricBoxProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-5 text-center",
        "border-r border-b border-gray-100 dark:border-border last:border-r-0",
        className
      )}
    >
      <span
        className={cn(
          "font-bold leading-none",
          large ? "text-4xl" : "text-2xl"
        )}
        style={status !== "neutral" ? { color: indexColor(status) } : undefined}
      >
        {value}
      </span>
      {subLabel && (
        <span className="mt-0.5 text-[10px] text-muted-foreground">{subLabel}</span>
      )}
      <span className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function MetricGrid({
  children,
  cols,
}: {
  children: React.ReactNode;
  cols: number;
}) {
  return (
    <div
      className="grid bg-white dark:bg-card"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-border animate-pulse">
      <div className="h-10 bg-gray-300 dark:bg-muted" />
      <div className="grid grid-cols-5 bg-white dark:bg-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-6 border-r border-gray-100 dark:border-border last:border-r-0">
            <div className="h-10 w-20 mx-auto rounded bg-gray-100 dark:bg-muted mb-2" />
            <div className="h-3 w-16 mx-auto rounded bg-gray-100 dark:bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardReport({ date }: { date: string }) {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const restaurantIds: string[] = selectedRestaurantId
    ? [selectedRestaurantId]
    : (restaurants?.map((r) => r.id) ?? []);

  const prevDate = format(subDays(parseISO(date), 1), "yyyy-MM-dd");
  const reviewStart = format(subMonths(parseISO(date), 1), "yyyy-MM-dd");
  const dow = jsDayToTargetDow(parseISO(date).getDay());

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-report", date, restaurantIds.join(",")],
    queryFn: async () => {
      if (!restaurantIds.length) return null;
      const [
        { data: salesRows },
        { data: prevSalesRows },
        { data: labourRows },
        { data: reviewRows },
        { data: targetRows },
      ] = await Promise.all([
        supabase.from("sales_daily").select("*").eq("date", date).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select("*").eq("date", prevDate).in("restaurant_id", restaurantIds),
        supabase.from("labour_daily").select("*").eq("date", date).in("restaurant_id", restaurantIds),
        supabase.from("google_reviews").select("*").in("restaurant_id", restaurantIds).gte("review_date", reviewStart).lte("review_date", date),
        supabase.from("targets").select("*").in("restaurant_id", restaurantIds),
      ]);
      return {
        sales: (salesRows ?? []) as SalesDaily[],
        prevSales: (prevSalesRows ?? []) as SalesDaily[],
        labour: (labourRows ?? []) as LabourDaily[],
        reviews: (reviewRows ?? []) as GoogleReview[],
        targets: (targetRows ?? []) as Target[],
      };
    },
    enabled: !!restaurantIds.length,
    staleTime: 1000 * 60 * 5,
  });

  if (!restaurantIds.length || isLoading) return <Skeleton />;
  if (!data) return null;

  const { sales, prevSales, labour, reviews, targets } = data;

  // ── Revenue metrics ───────────────────────────────────────────────────────
  const totalSales = sales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const prevTotalSales = prevSales.reduce((s, r) => s + (r.net_sales ?? r.total_sales), 0);
  const totalTx = sales.reduce((s, r) => s + r.transaction_count, 0);
  const avgTx = totalTx > 0 ? totalSales / totalTx : null;

  const salesTarget = getTargetVal(targets, restaurantIds, TARGET_METRICS.DAILY_SALES, dow);
  const txTarget = getTargetVal(targets, restaurantIds, TARGET_METRICS.TRANSACTION_COUNT, dow);
  const avgTxTarget = getTargetVal(targets, restaurantIds, TARGET_METRICS.AVG_TRANSACTION);

  const salesIndexTarget = salesTarget && totalSales > 0
    ? Math.round((totalSales / salesTarget) * 100)
    : null;
  const salesIndexPrev = prevTotalSales > 0 && totalSales > 0
    ? Math.round((totalSales / prevTotalSales) * 100)
    : null;

  function salesStatus(index: number | null): MetricStatus {
    if (!index) return "neutral";
    if (index >= 100) return "good";
    if (index >= 85) return "warn";
    return "bad";
  }

  // ── Labour metrics ────────────────────────────────────────────────────────
  const totalLabourCost = labour.reduce((s, r) => s + r.total_cost, 0);
  const scheduledHours = labour.reduce((s, r) => s + (r.scheduled_hours ?? r.total_hours), 0);
  const labourPct = totalSales > 0 ? (totalLabourCost / totalSales) * 100 : null;

  const labourPctTarget = getTargetVal(targets, restaurantIds, TARGET_METRICS.LABOUR_COST_PCT);
  const rosterBudget = getTargetVal(targets, restaurantIds, TARGET_METRICS.ROSTER_HOURS, dow);

  const labourVariance = labourPct !== null && labourPctTarget !== null
    ? labourPct - labourPctTarget
    : null;

  function labourStatus(): MetricStatus {
    if (!labourVariance === null || labourPct === null || !labourPctTarget) return "neutral";
    if (labourPct < labourPctTarget) return "good";
    if (labourPct <= labourPctTarget + 5) return "warn";
    return "bad";
  }

  // ── Reviews metrics ───────────────────────────────────────────────────────
  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : null;
  const reviewCount = reviews.length;

  const ratingTarget = getTargetVal(targets, restaurantIds, TARGET_METRICS.GOOGLE_RATING);
  const reviewVolumeTarget = getTargetVal(targets, restaurantIds, TARGET_METRICS.REVIEW_VOLUME);

  function ratingStatus(): MetricStatus {
    if (!avgRating || !ratingTarget) return "neutral";
    if (avgRating >= ratingTarget) return "good";
    if (avgRating >= ratingTarget - 0.5) return "warn";
    return "bad";
  }

  const noSales = sales.length === 0;
  const noLabour = labour.length === 0;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: `1.5px solid ${BRAND}` }}
    >
      {/* Period header */}
      <div
        className="px-4 py-2 text-sm font-medium text-white flex items-center gap-3"
        style={{ background: BRAND }}
      >
        <span className="text-white/60 uppercase tracking-wider text-xs font-semibold">Date</span>
        <span>{format(parseISO(date), "EEEE, d MMMM yyyy")}</span>
      </div>

      {/* ── REVENUE ── */}
      <SectionHeader title="Revenue" />
      <MetricGrid cols={6}>
        <MetricBox
          label="Index v Target"
          value={salesIndexTarget !== null ? String(salesIndexTarget) : "—"}
          subLabel={salesTarget ? `vs ${fmtCurrency(salesTarget)}` : undefined}
          large
          status={salesStatus(salesIndexTarget)}
        />
        <MetricBox
          label="Index v Prev Day"
          value={salesIndexPrev !== null ? String(salesIndexPrev) : "—"}
          subLabel={prevTotalSales > 0 ? `vs ${fmtCurrency(prevTotalSales)}` : undefined}
          large
          status={salesStatus(salesIndexPrev)}
        />
        <MetricBox
          label="Revenue"
          value={noSales ? "—" : fmtCurrency(totalSales)}
        />
        <MetricBox
          label="Target"
          value={salesTarget ? fmtCurrency(salesTarget) : "—"}
          status="neutral"
        />
        <MetricBox
          label="Transactions"
          value={noSales ? "—" : totalTx.toLocaleString("en-AU")}
          subLabel={txTarget ? `target ${txTarget.toLocaleString()}` : undefined}
        />
        <MetricBox
          label="Avg Transaction"
          value={avgTx !== null ? fmtCurrency(avgTx) : "—"}
          subLabel={avgTxTarget ? `target ${fmtCurrency(avgTxTarget)}` : undefined}
        />
      </MetricGrid>

      {/* ── LABOUR ── */}
      <SectionHeader title="Labour" />
      <MetricGrid cols={5}>
        <MetricBox
          label="Labour %"
          value={labourPct !== null ? fmtPct(labourPct) : "—"}
          status={labourStatus()}
          large
        />
        <MetricBox
          label="Target %"
          value={labourPctTarget !== null ? fmtPct(labourPctTarget) : "—"}
        />
        <MetricBox
          label="Variance"
          value={
            labourVariance !== null
              ? `${labourVariance > 0 ? "+" : ""}${labourVariance.toFixed(1)}%`
              : "—"
          }
          status={
            labourVariance === null
              ? "neutral"
              : labourVariance <= 0
              ? "good"
              : labourVariance <= 5
              ? "warn"
              : "bad"
          }
        />
        <MetricBox
          label="Roster Hours"
          value={noLabour ? "—" : `${scheduledHours.toFixed(0)}h`}
          subLabel={rosterBudget ? `budget ${rosterBudget.toFixed(0)}h` : undefined}
        />
        <MetricBox
          label="Labour Cost"
          value={noLabour ? "—" : fmtCurrency(totalLabourCost)}
        />
      </MetricGrid>

      {/* ── GOOGLE REVIEWS ── */}
      <SectionHeader title="Google Reviews (30-day)" />
      <MetricGrid cols={4}>
        <MetricBox
          label="Avg Rating"
          value={avgRating !== null ? avgRating.toFixed(1) : "—"}
          subLabel="out of 5.0"
          large
          status={ratingStatus()}
        />
        <MetricBox
          label="Target Rating"
          value={ratingTarget !== null ? ratingTarget.toFixed(1) : "—"}
        />
        <MetricBox
          label="Reviews (30d)"
          value={String(reviewCount)}
          subLabel={
            reviewVolumeTarget
              ? `${Math.round((reviewCount / reviewVolumeTarget) * 100)}% of target`
              : undefined
          }
          status={
            reviewVolumeTarget
              ? reviewCount >= reviewVolumeTarget
                ? "good"
                : reviewCount >= reviewVolumeTarget * 0.75
                ? "warn"
                : "bad"
              : "neutral"
          }
        />
        <MetricBox
          label="Monthly Target"
          value={reviewVolumeTarget ? String(reviewVolumeTarget) : "—"}
        />
      </MetricGrid>
    </div>
  );
}
