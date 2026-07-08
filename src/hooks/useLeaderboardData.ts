import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  subMonths,
} from "date-fns";
import { supabase } from "@/lib/supabase";
import { TARGET_METRICS } from "@/hooks/useTargets";
import type { Target, SalesDaily, LabourDaily, GoogleReview } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LeaderboardPeriod = "thisWeek" | "thisMonth" | "thisQuarter";

export interface MetricScore {
  actual: number | null;
  target: number | null;
  score: number; // 0–100, or -1 = no data
  label: string;
}

export interface LeaderboardRow {
  restaurantId: string;
  restaurantName: string;
  rank: number;
  prevRank: number | null;
  movement: "up" | "down" | "same" | "new";
  compositeScore: number;
  scores: {
    sales: MetricScore;
    labour: MetricScore;
    rating: MetricScore;
    transactions: MetricScore;
    food_cost: MetricScore;    // disabled Phase 4
    waste: MetricScore;        // disabled Phase 4
    whs: MetricScore;          // disabled Phase 5
  };
  hasPartialData: boolean;
  noData: boolean;
}

export interface LeaderboardWeights {
  sales: number;
  labour: number;
  rating: number;
  transactions: number;
  food_cost: number;
  waste: number;
  whs: number;
}

export interface LeaderboardSettings {
  allow_manager_view: boolean;
  grace_period_days: number;
}

const DEFAULT_WEIGHTS: LeaderboardWeights = {
  sales: 31.25,
  labour: 25.0,
  rating: 25.0,
  transactions: 18.75,
  food_cost: 0,
  waste: 0,
  whs: 0,
};

const DEFAULT_SETTINGS: LeaderboardSettings = {
  allow_manager_view: true,
  grace_period_days: 30,
};

// ── Date range helpers ────────────────────────────────────────────────────────

function getPeriodRange(period: LeaderboardPeriod): { from: string; to: string } {
  const today = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");

  switch (period) {
    case "thisWeek":
      return {
        from: fmt(startOfWeek(today, { weekStartsOn: 1 })),
        to: fmt(endOfWeek(today, { weekStartsOn: 1 })),
      };
    case "thisMonth":
      return { from: fmt(startOfMonth(today)), to: fmt(endOfMonth(today)) };
    case "thisQuarter":
      return { from: fmt(startOfQuarter(today)), to: fmt(endOfQuarter(today)) };
  }
}

function getPrevPeriodRange(period: LeaderboardPeriod): { from: string; to: string } {
  const today = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");

  switch (period) {
    case "thisWeek": {
      const prevWeekStart = startOfWeek(
        new Date(today.getTime() - 7 * 86400000),
        { weekStartsOn: 1 }
      );
      const prevWeekEnd = endOfWeek(prevWeekStart, { weekStartsOn: 1 });
      return { from: fmt(prevWeekStart), to: fmt(prevWeekEnd) };
    }
    case "thisMonth": {
      const prev = subMonths(today, 1);
      return { from: fmt(startOfMonth(prev)), to: fmt(endOfMonth(prev)) };
    }
    case "thisQuarter": {
      const prev = subMonths(today, 3);
      return { from: fmt(startOfQuarter(prev)), to: fmt(endOfQuarter(prev)) };
    }
  }
}

// ── Scoring engine ────────────────────────────────────────────────────────────

function scoreMetric(
  actual: number | null,
  target: number | null,
  higherIsBetter: boolean
): number {
  if (actual === null || target === null || target === 0) return -1;
  if (higherIsBetter) {
    return Math.min(100, Math.max(0, (actual / target) * 100));
  } else {
    // Lower is better (labour %)
    return Math.max(0, Math.min(100, 100 - ((actual - target) / target) * 100));
  }
}

function scoreRating(actual: number | null): number {
  if (actual === null) return -1;
  return Math.min(100, Math.max(0, (actual / 5.0) * 100));
}

function calcComposite(
  scores: LeaderboardRow["scores"],
  weights: LeaderboardWeights
): number {
  let total = 0;
  let usedWeight = 0;

  const pairs: Array<[keyof typeof scores, keyof LeaderboardWeights]> = [
    ["sales", "sales"],
    ["labour", "labour"],
    ["rating", "rating"],
    ["transactions", "transactions"],
  ];

  for (const [scoreKey, weightKey] of pairs) {
    const s = scores[scoreKey].score;
    const w = weights[weightKey];
    if (s >= 0 && w > 0) {
      total += s * (w / 100);
      usedWeight += w / 100;
    }
  }

  if (usedWeight === 0) return 0;
  // Normalise to 100 based on weights actually used
  return Math.round((total / usedWeight) * 10) / 10;
}

function buildRow(
  restaurantId: string,
  restaurantName: string,
  salesRows: SalesDaily[],
  labourRows: LabourDaily[],
  reviewRows: GoogleReview[],
  targets: Target[],
  weights: LeaderboardWeights
): LeaderboardRow {
  // ── Aggregates ────────────────────────────────────────────────────────────
  const totalNetSales = salesRows.reduce(
    (s, r) => s + (r.net_sales ?? r.total_sales),
    0
  );
  const totalTransactions = salesRows.reduce(
    (s, r) => s + r.transaction_count,
    0
  );
  const totalLabourCost = labourRows.reduce((s, r) => s + r.total_cost, 0);
  const labourPct =
    totalNetSales > 0 ? (totalLabourCost / totalNetSales) * 100 : null;

  const avgRating =
    reviewRows.length > 0
      ? reviewRows.reduce((s, r) => s + r.rating, 0) / reviewRows.length
      : null;

  // ── Target lookups ────────────────────────────────────────────────────────
  function getT(metric: string, dow?: number | null): number | null {
    const t = targets.find(
      (row) =>
        row.restaurant_id === restaurantId &&
        row.metric === metric &&
        (dow === undefined ? true : row.day_of_week === (dow ?? null))
    );
    return t?.value ?? null;
  }

  // Weekly sales target: use stored weekly target or sum of daily targets
  const weeklySalesTarget =
    getT(TARGET_METRICS.WEEKLY_SALES) ??
    (() => {
      const dailys = [0, 1, 2, 3, 4, 5, 6].map((d) =>
        getT(TARGET_METRICS.DAILY_SALES, d)
      );
      const allSet = dailys.every((v) => v !== null);
      return allSet
        ? (dailys as number[]).reduce((a, b) => a + b, 0)
        : null;
    })();

  // Transaction target: sum across days of week (use Mon-Sun)
  const weeklyTxTarget =
    (() => {
      const dailys = [0, 1, 2, 3, 4, 5, 6].map((d) =>
        getT(TARGET_METRICS.TRANSACTION_COUNT, d)
      );
      const allSet = dailys.every((v) => v !== null);
      return allSet
        ? (dailys as number[]).reduce((a, b) => a + b, 0)
        : null;
    })();

  const labourTarget = getT(TARGET_METRICS.LABOUR_COST_PCT);
  const ratingTarget = getT(TARGET_METRICS.GOOGLE_RATING);

  // ── Scores ────────────────────────────────────────────────────────────────
  const salesScore = scoreMetric(
    salesRows.length ? totalNetSales : null,
    weeklySalesTarget,
    true
  );
  const labourScore = scoreMetric(labourPct, labourTarget, false);
  const ratingScore = scoreRating(avgRating);
  const txScore = scoreMetric(
    salesRows.length ? totalTransactions : null,
    weeklyTxTarget,
    true
  );

  const disabled: MetricScore = { actual: null, target: null, score: -1, label: "—" };

  const scores: LeaderboardRow["scores"] = {
    sales: {
      actual: salesRows.length ? totalNetSales : null,
      target: weeklySalesTarget,
      score: salesScore,
      label: "Sales",
    },
    labour: {
      actual: labourPct,
      target: labourTarget,
      score: labourScore,
      label: "Labour %",
    },
    rating: {
      actual: avgRating,
      target: ratingTarget,
      score: ratingScore,
      label: "Google Rating",
    },
    transactions: {
      actual: salesRows.length ? totalTransactions : null,
      target: weeklyTxTarget,
      score: txScore,
      label: "Transactions",
    },
    food_cost: disabled,
    waste: disabled,
    whs: disabled,
  };

  const compositeScore = calcComposite(scores, weights);
  const noData = salesRows.length === 0 && labourRows.length === 0;
  const hasPartialData =
    !noData &&
    (salesRows.length === 0 ||
      labourRows.length === 0);

  return {
    restaurantId,
    restaurantName,
    rank: 0, // filled in after sort
    prevRank: null,
    movement: "same",
    compositeScore,
    scores,
    hasPartialData,
    noData,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLeaderboardData(period: LeaderboardPeriod) {
  const range = getPeriodRange(period);
  const prevRange = getPrevPeriodRange(period);

  return useQuery({
    queryKey: ["leaderboard", period],
    queryFn: async () => {
      // Fetch restaurants + settings in parallel
      const [
        { data: restaurants },
        { data: settingsRows },
        { data: salesRows },
        { data: prevSalesRows },
        { data: labourRows },
        { data: prevLabourRows },
        { data: reviewRows },
        { data: targetRows },
      ] = await Promise.all([
        supabase.from("restaurants").select("id, name").eq("status", "active").order("name"),
        supabase.from("app_settings").select("key, value").in("key", [
          "leaderboard_weights",
          "leaderboard_settings",
        ]),
        supabase
          .from("sales_daily")
          .select("*")
          .gte("date", range.from)
          .lte("date", range.to),
        supabase
          .from("sales_daily")
          .select("*")
          .gte("date", prevRange.from)
          .lte("date", prevRange.to),
        supabase
          .from("labour_daily")
          .select("*")
          .gte("date", range.from)
          .lte("date", range.to),
        supabase
          .from("labour_daily")
          .select("*")
          .gte("date", prevRange.from)
          .lte("date", prevRange.to),
        supabase
          .from("google_reviews")
          .select("*")
          .gte("review_date", format(subMonths(new Date(), 1), "yyyy-MM-dd")),
        supabase.from("targets").select("*"),
      ]);

      const rests = restaurants ?? [];
      const settings = settingsRows ?? [];
      const weights: LeaderboardWeights =
        (settings.find((s) => s.key === "leaderboard_weights")?.value as LeaderboardWeights) ??
        DEFAULT_WEIGHTS;
      const leaderboardSettings: LeaderboardSettings =
        (settings.find((s) => s.key === "leaderboard_settings")?.value as LeaderboardSettings) ??
        DEFAULT_SETTINGS;

      // Build current rows
      const currentRows = rests.map((r: { id: string; name: string }) =>
        buildRow(
          r.id,
          r.name,
          (salesRows ?? []).filter((s: SalesDaily) => s.restaurant_id === r.id),
          (labourRows ?? []).filter((l: LabourDaily) => l.restaurant_id === r.id),
          (reviewRows ?? []).filter((rv: GoogleReview) => rv.restaurant_id === r.id),
          (targetRows ?? []) as Target[],
          weights
        )
      );

      // Build previous-period rows for movement tracking
      const prevRows = rests.map((r: { id: string; name: string }) =>
        buildRow(
          r.id,
          r.name,
          (prevSalesRows ?? []).filter((s: SalesDaily) => s.restaurant_id === r.id),
          (prevLabourRows ?? []).filter((l: LabourDaily) => l.restaurant_id === r.id),
          (reviewRows ?? []).filter((rv: GoogleReview) => rv.restaurant_id === r.id),
          (targetRows ?? []) as Target[],
          weights
        )
      );

      // Sort: no-data last, then by composite desc, ties alphabetically
      const sorted = [...currentRows].sort((a, b) => {
        if (a.noData && !b.noData) return 1;
        if (!a.noData && b.noData) return -1;
        if (b.compositeScore !== a.compositeScore)
          return b.compositeScore - a.compositeScore;
        return a.restaurantName.localeCompare(b.restaurantName);
      });

      // Assign ranks
      sorted.forEach((row, i) => {
        row.rank = i + 1;
      });

      // Sort prev period
      const prevSorted = [...prevRows].sort((a, b) => {
        if (a.noData && !b.noData) return 1;
        if (!a.noData && b.noData) return -1;
        if (b.compositeScore !== a.compositeScore)
          return b.compositeScore - a.compositeScore;
        return a.restaurantName.localeCompare(b.restaurantName);
      });
      prevSorted.forEach((row, i) => {
        row.rank = i + 1;
      });

      // Movement
      for (const row of sorted) {
        const prev = prevSorted.find((p) => p.restaurantId === row.restaurantId);
        if (!prev || prev.noData) {
          row.prevRank = null;
          row.movement = "new";
        } else {
          row.prevRank = prev.rank;
          if (row.rank < prev.rank) row.movement = "up";
          else if (row.rank > prev.rank) row.movement = "down";
          else row.movement = "same";
        }
      }

      return { rows: sorted, weights, settings: leaderboardSettings };
    },
    staleTime: 1000 * 60 * 10,
  });
}

// ── Settings mutation hook ────────────────────────────────────────────────────

export function useLeaderboardSettings() {
  const queryClient = useQueryClient();

  const { data: settingRows } = useQuery({
    queryKey: ["app-settings", "leaderboard"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["leaderboard_weights", "leaderboard_settings"]);
      return data ?? [];
    },
  });

  const weights: LeaderboardWeights =
    (settingRows?.find((s) => s.key === "leaderboard_weights")?.value as LeaderboardWeights) ??
    DEFAULT_WEIGHTS;
  const settings: LeaderboardSettings =
    (settingRows?.find((s) => s.key === "leaderboard_settings")?.value as LeaderboardSettings) ??
    DEFAULT_SETTINGS;

  const updateWeights = useMutation({
    mutationFn: async (newWeights: LeaderboardWeights) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "leaderboard_weights", value: newWeights }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings", "leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (newSettings: LeaderboardSettings) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "leaderboard_settings", value: newSettings }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings", "leaderboard"] });
    },
  });

  return { weights, settings, updateWeights, updateSettings };
}
