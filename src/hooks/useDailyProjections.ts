import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DailyProjection } from "@/types";

/**
 * Per-day projected sales for one or more venues over a date range.
 * Feeds the Roster dashboard's Required-hours calculation and is edited from
 * the Projections tab's daily grid.
 */
export function useDailyProjections(
  restaurantIds: string[],
  from: string,
  to: string
) {
  const queryClient = useQueryClient();

  const { data: projections = [], isLoading } = useQuery({
    queryKey: ["daily-projections", from, to, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("daily_projections")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data as DailyProjection[];
    },
    enabled: restaurantIds.length > 0,
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      date: string;
      projected_sales: number;
    }) => {
      const { error } = await supabase.from("daily_projections").upsert(
        {
          restaurant_id: payload.restaurant_id,
          date: payload.date,
          projected_sales: payload.projected_sales,
        },
        { onConflict: "restaurant_id,date" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-projections"] });
    },
  });

  const getProjection = useCallback(
    (restaurantId: string, date: string): number | null => {
      const p = projections.find(
        (row) => row.restaurant_id === restaurantId && row.date === date
      );
      return p?.projected_sales ?? null;
    },
    [projections]
  );

  return {
    projections,
    getProjection,
    isLoading,
    upsert: upsertMutation.mutateAsync,
  };
}
