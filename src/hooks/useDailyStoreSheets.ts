import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { DailyStoreSheet } from "@/types";

export function useDailyStoreSheets(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const { data: sheets = [], isLoading } = useQuery({
    queryKey: ["daily-store-sheets", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("daily_store_sheets")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sheet_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data as DailyStoreSheet[];
    },
    enabled: !!restaurantId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      sheet_date: string;
      shift_notes: string | null;
    }) => {
      const { error } = await supabase.from("daily_store_sheets").upsert(
        {
          restaurant_id: payload.restaurant_id,
          sheet_date: payload.sheet_date,
          shift_notes: payload.shift_notes,
          recorded_by: profile?.id ?? null,
        },
        { onConflict: "restaurant_id,sheet_date" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["daily-store-sheets", restaurantId],
      });
    },
  });

  return {
    sheets,
    isLoading,
    upsert: upsertMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
  };
}

export function useDailyStoreSheet(
  restaurantId: string | null,
  date: string | null
) {
  const { data: sheet, isLoading } = useQuery({
    queryKey: ["daily-store-sheet", restaurantId, date],
    queryFn: async () => {
      if (!restaurantId || !date) return null;
      const { data, error } = await supabase
        .from("daily_store_sheets")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("sheet_date", date)
        .maybeSingle();
      if (error) throw error;
      return data as DailyStoreSheet | null;
    },
    enabled: !!restaurantId && !!date,
  });

  return { sheet, isLoading };
}
