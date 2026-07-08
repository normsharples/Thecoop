import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Target } from "@/types";

// ── Metric key constants ──────────────────────────────────────────────────────
export const TARGET_METRICS = {
  DAILY_SALES: "daily_sales",
  WEEKLY_SALES: "weekly_sales",
  LABOUR_COST_PCT: "labour_cost_pct",
  TRANSACTION_COUNT: "transaction_count",
  AVG_TRANSACTION: "avg_transaction",
  GOOGLE_RATING: "google_rating",
  REVIEW_VOLUME: "review_volume",
  ROSTER_HOURS: "roster_hours",
  // Phase 4
  FOOD_COST_PCT: "food_cost_pct",
  WASTE_COST_PCT: "waste_cost_pct",
} as const;

// Day-of-week: 0 = Monday … 6 = Sunday (matches Mon–Sun grid display)
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function useTargets(restaurantId: string | null) {
  const queryClient = useQueryClient();

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ["targets", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("targets")
        .select("*")
        .eq("restaurant_id", restaurantId);
      if (error) throw error;
      return data as Target[];
    },
    enabled: !!restaurantId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      metric: string;
      period?: string;
      day_of_week?: number | null;
      value: number;
    }) => {
      const { error } = await supabase.from("targets").upsert(
        {
          restaurant_id: payload.restaurant_id,
          metric: payload.metric,
          period: payload.period ?? "current",
          day_of_week: payload.day_of_week ?? null,
          value: payload.value,
        },
        { onConflict: "restaurant_id,metric,period,day_of_week" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets", restaurantId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (targetId: string) => {
      const { error } = await supabase
        .from("targets")
        .delete()
        .eq("id", targetId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets", restaurantId] });
    },
  });

  // Copy all targets from current restaurant to one or more destinations
  const copyToMutation = useMutation({
    mutationFn: async (destinationIds: string[]) => {
      if (!targets.length) return;
      for (const destId of destinationIds) {
        const rows = targets.map((t) => ({
          restaurant_id: destId,
          metric: t.metric,
          period: t.period,
          day_of_week: t.day_of_week,
          value: t.value,
        }));
        const { error } = await supabase
          .from("targets")
          .upsert(rows, { onConflict: "restaurant_id,metric,period,day_of_week" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets"] });
    },
  });

  const getTarget = useCallback(
    (metric: string, dayOfWeek?: number | null): number | null => {
      const t = targets.find(
        (row) =>
          row.metric === metric &&
          (dayOfWeek === undefined || dayOfWeek === null
            ? row.day_of_week === null
            : row.day_of_week === dayOfWeek)
      );
      return t?.value ?? null;
    },
    [targets]
  );

  return {
    targets,
    getDailySalesTarget: (dayOfWeek: number) =>
      getTarget(TARGET_METRICS.DAILY_SALES, dayOfWeek),
    getWeeklySalesTarget: () => getTarget(TARGET_METRICS.WEEKLY_SALES),
    getLabourCostTarget: () => getTarget(TARGET_METRICS.LABOUR_COST_PCT),
    getTransactionTarget: (dayOfWeek: number) =>
      getTarget(TARGET_METRICS.TRANSACTION_COUNT, dayOfWeek),
    getAvgTransactionTarget: () => getTarget(TARGET_METRICS.AVG_TRANSACTION),
    getGoogleRatingTarget: () => getTarget(TARGET_METRICS.GOOGLE_RATING),
    getReviewVolumeTarget: () => getTarget(TARGET_METRICS.REVIEW_VOLUME),
    getRosterHoursBudget: (dayOfWeek: number) =>
      getTarget(TARGET_METRICS.ROSTER_HOURS, dayOfWeek),
    hasTargets: targets.length > 0,
    isLoading,
    upsert: upsertMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
    remove: deleteMutation.mutateAsync,
    copyTo: copyToMutation.mutateAsync,
    isCopying: copyToMutation.isPending,
  };
}
