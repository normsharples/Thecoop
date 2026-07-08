import { useQuery } from "@tanstack/react-query";
import { format, subDays, subMonths, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { TARGET_METRICS } from "@/hooks/useTargets";
import type { Target, SalesDaily, LabourDaily, GoogleReview } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VitalStatus = "green" | "amber" | "red" | "grey";
export type VitalTrend = "up" | "down" | "flat";

export interface VitalData {
  id: string;
  label: string;
  value: string;
  numericValue: number | null;
  target: string | null;
  numericTarget: number | null;
  status: VitalStatus;
  trend: VitalTrend;
  trendValue: string;
  subtitle: string;
  reportPath: string;
  noData: boolean;
  isPlaceholder?: boolean;
  placeholderPhase?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcTrend(
  current: number | null,
  previous: number | null
): { trend: VitalTrend; trendValue: string } {
  if (current === null || previous === null || previous === 0) {
    return { trend: "flat", trendValue: "—" };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return { trend: "flat", trendValue: "0%" };
  return {
    trend: pct > 0 ? "up" : "down",
    trendValue: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
  };
}

function fmt(n: number, type: "currency" | "percent" | "number" | "rating"): string {
  if (type === "currency") {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }
  if (type === "percent") return `${n.toFixed(1)}%`;
  if (type === "rating") return n.toFixed(1);
  return new Intl.NumberFormat("en-AU").format(n);
}

// javascript getDay() → 0=Sunday. Our day_of_week: 0=Monday.
function jsDayToTargetDow(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

// ── Aggregate helpers ─────────────────────────────────────────────────────────

function aggregateSales(rows: SalesDaily[]) {
  return rows.reduce(
    (acc, r) => {
      acc.net_sales += r.net_sales ?? r.total_sales;
      acc.transaction_count += r.transaction_count;
      return acc;
    },
    { net_sales: 0, transaction_count: 0 }
  );
}

function aggregateLabour(rows: LabourDaily[]) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.total_cost += r.total_cost;
      acc.scheduled_hours += r.scheduled_hours ?? r.total_hours;
      return acc;
    },
    { total_cost: 0, scheduled_hours: 0 }
  );
  return totals;
}

// ── Target lookup ─────────────────────────────────────────────────────────────

function getTargetValue(
  targets: Target[],
  restaurantId: string,
  metric: string,
  dayOfWeek?: number | null
): number | null {
  const t = targets.find(
    (row) =>
      row.restaurant_id === restaurantId &&
      row.metric === metric &&
      (dayOfWeek === undefined || dayOfWeek === null
        ? row.day_of_week === null
        : row.day_of_week === dayOfWeek)
  );
  return t?.value ?? null;
}

function getAllTargets(
  targets: Target[],
  restaurantIds: string[],
  metric: string,
  dayOfWeek?: number | null
): number[] {
  return restaurantIds
    .map((id) => getTargetValue(targets, id, metric, dayOfWeek))
    .filter((v): v is number => v !== null);
}

// ── Build vitals ──────────────────────────────────────────────────────────────

function buildVitals(params: {
  salesRows: SalesDaily[];
  labourRows: LabourDaily[];
  prevSalesRows: SalesDaily[];
  prevLabourRows: LabourDaily[];
  reviewRows: GoogleReview[];
  targets: Target[];
  restaurantIds: string[];
  date: string;
}): VitalData[] {
  const {
    salesRows,
    labourRows,
    prevSalesRows,
    prevLabourRows,
    reviewRows,
    targets,
    restaurantIds,
    date,
  } = params;

  const jsDay = parseISO(date).getDay();
  const dow = jsDayToTargetDow(jsDay);

  // ── Aggregate current period ───────────────────────────────────────────────
  const currSales = aggregateSales(salesRows);
  const prevSales = aggregateSales(prevSalesRows);
  const currLabour = aggregateLabour(labourRows);
  const prevLabour = aggregateLabour(prevLabourRows);

  // ── Sales daily targets sum ────────────────────────────────────────────────
  const salesTargets = getAllTargets(targets, restaurantIds, TARGET_METRICS.DAILY_SALES, dow);
  const totalSalesTarget = salesTargets.length ? salesTargets.reduce((a, b) => a + b, 0) : null;

  // ── Transaction targets sum ────────────────────────────────────────────────
  const txTargets = getAllTargets(targets, restaurantIds, TARGET_METRICS.TRANSACTION_COUNT, dow);
  const totalTxTarget = txTargets.length ? txTargets.reduce((a, b) => a + b, 0) : null;

  // ── Avg transaction targets (average of per-store targets) ─────────────────
  const avgTxTargetVals = getAllTargets(targets, restaurantIds, TARGET_METRICS.AVG_TRANSACTION);
  const avgTxTarget =
    avgTxTargetVals.length
      ? avgTxTargetVals.reduce((a, b) => a + b, 0) / avgTxTargetVals.length
      : null;

  // ── Labour cost % target (average across stores, or first if one store) ────
  const labourPctTargetVals = getAllTargets(
    targets,
    restaurantIds,
    TARGET_METRICS.LABOUR_COST_PCT
  );
  const labourPctTarget =
    labourPctTargetVals.length
      ? labourPctTargetVals.reduce((a, b) => a + b, 0) / labourPctTargetVals.length
      : null;

  // ── Google rating & review volume ─────────────────────────────────────────
  const ratingTargetVals = getAllTargets(targets, restaurantIds, TARGET_METRICS.GOOGLE_RATING);
  const ratingTarget =
    ratingTargetVals.length
      ? ratingTargetVals.reduce((a, b) => a + b, 0) / ratingTargetVals.length
      : null;

  const reviewVolumeTargetVals = getAllTargets(
    targets,
    restaurantIds,
    TARGET_METRICS.REVIEW_VOLUME
  );
  const reviewVolumeTarget = reviewVolumeTargetVals.length
    ? reviewVolumeTargetVals.reduce((a, b) => a + b, 0)
    : null;

  // ── Roster hours ──────────────────────────────────────────────────────────
  const rosterTargetVals = getAllTargets(targets, restaurantIds, TARGET_METRICS.ROSTER_HOURS, dow);
  const rosterTarget = rosterTargetVals.length
    ? rosterTargetVals.reduce((a, b) => a + b, 0)
    : null;

  // ── Calculate actual avg transaction ──────────────────────────────────────
  const totalAvgTx =
    currSales.transaction_count > 0
      ? currSales.net_sales / currSales.transaction_count
      : null;
  const prevAvgTx =
    prevSales.transaction_count > 0
      ? prevSales.net_sales / prevSales.transaction_count
      : null;

  // ── Labour cost % ─────────────────────────────────────────────────────────
  const labourPct =
    currSales.net_sales > 0 ? (currLabour.total_cost / currSales.net_sales) * 100 : null;
  const prevLabourPct =
    prevSales.net_sales > 0
      ? (prevLabour.total_cost / prevSales.net_sales) * 100
      : null;

  // ── Google reviews (last 30 days) ─────────────────────────────────────────
  const avgRating =
    reviewRows.length > 0
      ? reviewRows.reduce((sum, r) => sum + r.rating, 0) / reviewRows.length
      : null;
  const reviewCount = reviewRows.length;

  // ── Roster hours (scheduled_hours for the day) ────────────────────────────
  const scheduledHours = labourRows.reduce(
    (sum, r) => sum + (r.scheduled_hours ?? r.total_hours),
    0
  );

  // ── Trend calculations ────────────────────────────────────────────────────
  const salesTrend = calcTrend(
    currSales.net_sales || null,
    prevSales.net_sales || null
  );
  const labourTrend = calcTrend(labourPct, prevLabourPct);
  const txTrend = calcTrend(
    currSales.transaction_count || null,
    prevSales.transaction_count || null
  );
  const avgTxTrend = calcTrend(totalAvgTx, prevAvgTx);

  // ── Status calculations ───────────────────────────────────────────────────

  function salesStatus(): VitalStatus {
    if (!salesRows.length) return "grey";
    if (!totalSalesTarget) return "grey";
    const pct = (currSales.net_sales / totalSalesTarget) * 100;
    if (pct >= 100) return "green";
    if (pct >= 85) return "amber";
    return "red";
  }

  function labourStatus(): VitalStatus {
    if (!labourRows.length || labourPct === null) return "grey";
    if (!labourPctTarget) return "grey";
    if (labourPct < labourPctTarget) return "green";
    if (labourPct <= labourPctTarget + 5) return "amber";
    return "red";
  }

  function txStatus(): VitalStatus {
    if (!salesRows.length) return "grey";
    if (!totalTxTarget) return "grey";
    const pct = (currSales.transaction_count / totalTxTarget) * 100;
    if (pct >= 100) return "green";
    if (pct >= 85) return "amber";
    return "red";
  }

  function avgTxStatus(): VitalStatus {
    if (totalAvgTx === null) return "grey";
    if (!avgTxTarget) return "grey";
    const pct = (totalAvgTx / avgTxTarget) * 100;
    if (pct >= 100) return "green";
    if (pct >= 90) return "amber";
    return "red";
  }

  function ratingStatus(): VitalStatus {
    if (avgRating === null) return "grey";
    if (!ratingTarget) return "grey";
    if (avgRating >= ratingTarget) return "green";
    if (avgRating >= ratingTarget - 0.5) return "amber";
    return "red";
  }

  function reviewVolumeStatus(): VitalStatus {
    if (!reviewVolumeTarget) return "grey";
    const pct = (reviewCount / reviewVolumeTarget) * 100;
    if (pct >= 100) return "green";
    if (pct >= 75) return "amber";
    return "red";
  }

  function rosterStatus(): VitalStatus {
    if (!rosterTarget) return "grey";
    const pct = (scheduledHours / rosterTarget) * 100;
    if (pct <= 100) return "green";
    if (pct <= 110) return "amber";
    return "red";
  }

  // ── Build vital cards ─────────────────────────────────────────────────────

  const noSalesData = salesRows.length === 0;
  const noLabourData = labourRows.length === 0;

  const vitals: VitalData[] = [
    // 1: Daily Sales vs Target
    {
      id: "daily_sales",
      label: "Daily Sales",
      value: noSalesData ? "No data" : fmt(currSales.net_sales, "currency"),
      numericValue: noSalesData ? null : currSales.net_sales,
      target: totalSalesTarget ? fmt(totalSalesTarget, "currency") : null,
      numericTarget: totalSalesTarget,
      status: salesStatus(),
      ...salesTrend,
      subtitle: totalSalesTarget
        ? noSalesData
          ? "No data"
          : `${((currSales.net_sales / totalSalesTarget) * 100).toFixed(0)}% of target`
        : "No target set",
      reportPath: "/reports/sales",
      noData: noSalesData,
    },
    // 2: Labour Cost %
    {
      id: "labour_pct",
      label: "Labour Cost %",
      value: noLabourData || labourPct === null ? "No data" : fmt(labourPct, "percent"),
      numericValue: labourPct,
      target: labourPctTarget ? fmt(labourPctTarget, "percent") : null,
      numericTarget: labourPctTarget,
      status: labourStatus(),
      ...labourTrend,
      subtitle: labourPctTarget
        ? noLabourData
          ? "No data"
          : labourPct !== null && labourPct < labourPctTarget
          ? `${(labourPctTarget - labourPct).toFixed(1)}% below target`
          : labourPct !== null
          ? `${(labourPct - labourPctTarget).toFixed(1)}% above target`
          : ""
        : "No target set",
      reportPath: "/reports/labour",
      noData: noLabourData,
    },
    // 3: Transactions Today
    {
      id: "transactions",
      label: "Transactions",
      value: noSalesData ? "No data" : fmt(currSales.transaction_count, "number"),
      numericValue: noSalesData ? null : currSales.transaction_count,
      target: totalTxTarget ? fmt(totalTxTarget, "number") : null,
      numericTarget: totalTxTarget,
      status: txStatus(),
      ...txTrend,
      subtitle: totalTxTarget
        ? noSalesData
          ? "No data"
          : `${((currSales.transaction_count / totalTxTarget) * 100).toFixed(0)}% of target`
        : "No target set",
      reportPath: "/reports/sales",
      noData: noSalesData,
    },
    // 4: Avg Transaction Value
    {
      id: "avg_transaction",
      label: "Avg Transaction",
      value: totalAvgTx === null ? "No data" : fmt(totalAvgTx, "currency"),
      numericValue: totalAvgTx,
      target: avgTxTarget ? fmt(avgTxTarget, "currency") : null,
      numericTarget: avgTxTarget,
      status: avgTxStatus(),
      ...avgTxTrend,
      subtitle: avgTxTarget
        ? totalAvgTx === null
          ? "No data"
          : `${((totalAvgTx / avgTxTarget) * 100).toFixed(0)}% of target`
        : "No target set",
      reportPath: "/reports/sales",
      noData: totalAvgTx === null,
    },
    // 5: Google Rating (30-day)
    {
      id: "google_rating",
      label: "Google Rating",
      value: avgRating === null ? "No data" : fmt(avgRating, "rating"),
      numericValue: avgRating,
      target: ratingTarget ? fmt(ratingTarget, "rating") : null,
      numericTarget: ratingTarget,
      status: ratingStatus(),
      trend: "flat",
      trendValue: "30-day avg",
      subtitle: ratingTarget
        ? avgRating === null
          ? "No reviews"
          : avgRating >= ratingTarget
          ? "Meeting target"
          : `${(ratingTarget - avgRating).toFixed(1)} below target`
        : "No target set",
      reportPath: "/reports/reviews",
      noData: avgRating === null,
    },
    // 6: Review Volume (30-day)
    {
      id: "review_volume",
      label: "Review Volume",
      value: fmt(reviewCount, "number"),
      numericValue: reviewCount,
      target: reviewVolumeTarget ? fmt(reviewVolumeTarget, "number") + "/mo" : null,
      numericTarget: reviewVolumeTarget,
      status: reviewVolumeStatus(),
      trend: "flat",
      trendValue: "30-day total",
      subtitle: reviewVolumeTarget
        ? `${((reviewCount / reviewVolumeTarget) * 100).toFixed(0)}% of monthly target`
        : "No target set",
      reportPath: "/reports/reviews",
      noData: false,
    },
    // 7: Roster Hours vs Budget
    {
      id: "roster_hours",
      label: "Roster Hours",
      value: noLabourData ? "No data" : fmt(scheduledHours, "number") + "h",
      numericValue: noLabourData ? null : scheduledHours,
      target: rosterTarget ? fmt(rosterTarget, "number") + "h" : null,
      numericTarget: rosterTarget,
      status: rosterStatus(),
      trend: "flat",
      trendValue: "—",
      subtitle: rosterTarget
        ? noLabourData
          ? "No data"
          : `${((scheduledHours / rosterTarget) * 100).toFixed(0)}% of budget`
        : "No target set",
      reportPath: "/reports/labour",
      noData: noLabourData,
    },
    // 8–13: Phase 4/5 placeholders
    ...(
      [
        { id: "food_cost", label: "Food Cost %", phase: "Phase 4" },
        { id: "waste_cost", label: "Waste Cost %", phase: "Phase 4" },
        { id: "cash_variance", label: "Cash Variance", phase: "Phase 4" },
        { id: "whs_audit", label: "WHS Audit Score", phase: "Phase 5" },
        { id: "compliance", label: "Compliance Index", phase: "Phase 5" },
      ] as const
    ).map((p) => ({
      id: p.id,
      label: p.label,
      value: "—",
      numericValue: null,
      target: null,
      numericTarget: null,
      status: "grey" as VitalStatus,
      trend: "flat" as VitalTrend,
      trendValue: p.phase,
      subtitle: `Coming ${p.phase}`,
      reportPath: "/reports",
      noData: true,
      isPlaceholder: true,
      placeholderPhase: p.phase,
    })),
  ];

  return vitals;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePulseData(restaurantId: string | null, date?: string) {
  const pulseDate = date ?? format(subDays(new Date(), 1), "yyyy-MM-dd");
  const prevDate = format(subDays(parseISO(pulseDate), 1), "yyyy-MM-dd");
  const reviewStartDate = format(subMonths(parseISO(pulseDate), 1), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["pulse", restaurantId, pulseDate],
    queryFn: async () => {
      // ── Fetch restaurants list to resolve "All Stores" ────────────────────
      let restaurantIds: string[] = [];
      if (restaurantId) {
        restaurantIds = [restaurantId];
      } else {
        const { data: rests } = await supabase
          .from("restaurants")
          .select("id")
          .eq("status", "active");
        restaurantIds = (rests ?? []).map((r: { id: string }) => r.id);
      }

      if (!restaurantIds.length) {
        return { vitals: [], date: pulseDate, restaurantIds: [] };
      }

      // ── Parallel fetch ────────────────────────────────────────────────────
      const [
        { data: salesRows },
        { data: prevSalesRows },
        { data: labourRows },
        { data: prevLabourRows },
        { data: reviewRows },
        { data: targetRows },
      ] = await Promise.all([
        supabase
          .from("sales_daily")
          .select("*")
          .eq("date", pulseDate)
          .in("restaurant_id", restaurantIds),
        supabase
          .from("sales_daily")
          .select("*")
          .eq("date", prevDate)
          .in("restaurant_id", restaurantIds),
        supabase
          .from("labour_daily")
          .select("*")
          .eq("date", pulseDate)
          .in("restaurant_id", restaurantIds),
        supabase
          .from("labour_daily")
          .select("*")
          .eq("date", prevDate)
          .in("restaurant_id", restaurantIds),
        supabase
          .from("google_reviews")
          .select("*")
          .in("restaurant_id", restaurantIds)
          .gte("review_date", reviewStartDate)
          .lte("review_date", pulseDate),
        supabase
          .from("targets")
          .select("*")
          .in("restaurant_id", restaurantIds),
      ]);

      const vitals = buildVitals({
        salesRows: (salesRows ?? []) as SalesDaily[],
        labourRows: (labourRows ?? []) as LabourDaily[],
        prevSalesRows: (prevSalesRows ?? []) as SalesDaily[],
        prevLabourRows: (prevLabourRows ?? []) as LabourDaily[],
        reviewRows: (reviewRows ?? []) as GoogleReview[],
        targets: (targetRows ?? []) as Target[],
        restaurantIds,
        date: pulseDate,
      });

      // ── Per-store breakdown for "All Stores" view ─────────────────────────
      const perStore =
        !restaurantId && restaurantIds.length > 1
          ? restaurantIds.map((rid) => {
              const sv = buildVitals({
                salesRows: ((salesRows ?? []) as SalesDaily[]).filter(
                  (r) => r.restaurant_id === rid
                ),
                labourRows: ((labourRows ?? []) as LabourDaily[]).filter(
                  (r) => r.restaurant_id === rid
                ),
                prevSalesRows: ((prevSalesRows ?? []) as SalesDaily[]).filter(
                  (r) => r.restaurant_id === rid
                ),
                prevLabourRows: ((prevLabourRows ?? []) as LabourDaily[]).filter(
                  (r) => r.restaurant_id === rid
                ),
                reviewRows: ((reviewRows ?? []) as GoogleReview[]).filter(
                  (r) => r.restaurant_id === rid
                ),
                targets: (targetRows ?? []) as Target[],
                restaurantIds: [rid],
                date: pulseDate,
              });
              return { restaurantId: rid, vitals: sv.slice(0, 7) };
            })
          : null;

      return { vitals, date: pulseDate, restaurantIds, perStore };
    },
    staleTime: 1000 * 60 * 5,
  });
}
