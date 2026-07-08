import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Projection } from "@/types";

export function useProjections(periodMonth: string, restaurantIds: string[]) {
  const queryClient = useQueryClient();

  const { data: projections = [], isLoading } = useQuery({
    queryKey: ["projections", periodMonth, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("projections")
        .select("*")
        .eq("period_month", periodMonth)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return data as Projection[];
    },
    enabled: restaurantIds.length > 0,
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      sales_projection?: number;
      labour_projection?: number;
      food_cost_projection?: number;
    }) => {
      const existing = projections.find((p) => p.restaurant_id === payload.restaurant_id);
      const { error } = await supabase.from("projections").upsert(
        {
          restaurant_id: payload.restaurant_id,
          period_month: periodMonth,
          sales_projection: payload.sales_projection ?? existing?.sales_projection ?? 0,
          labour_projection: payload.labour_projection ?? existing?.labour_projection ?? 0,
          food_cost_projection: payload.food_cost_projection ?? existing?.food_cost_projection ?? 0,
        },
        { onConflict: "restaurant_id,period_month" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projections", periodMonth] });
    },
  });

  const getProjection = (restaurantId: string): Projection | null =>
    projections.find((p) => p.restaurant_id === restaurantId) ?? null;

  return {
    projections,
    getProjection,
    isLoading,
    upsert: upsertMutation.mutateAsync,
  };
}
