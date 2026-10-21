import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DailyStoreSheetSettings } from "@/types";

export function useDailyStoreSheetSettings(brandId: string | null) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["daily-store-sheet-settings", brandId],
    queryFn: async () => {
      if (!brandId) return null;
      const { data, error } = await supabase
        .from("daily_store_sheet_settings")
        .select("*")
        .eq("brand_id", brandId)
        .maybeSingle();
      if (error) throw error;
      return data as DailyStoreSheetSettings | null;
    },
    enabled: !!brandId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (
      patch: Partial<Omit<DailyStoreSheetSettings, "id" | "created_at" | "updated_at">> & {
        brand_id: string;
      }
    ) => {
      const { error } = await supabase
        .from("daily_store_sheet_settings")
        .upsert(patch, { onConflict: "brand_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["daily-store-sheet-settings", brandId],
      });
    },
  });

  return {
    settings,
    isLoading,
    upsert: upsertMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
  };
}
