import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { StaffingConfig } from "@/types";

export const DEFAULT_STAFFING_CONFIG: Omit<
  StaffingConfig,
  "restaurant_id" | "created_at" | "updated_at"
> = {
  ly_weight: 0.5,
  lw_weight: 0.5,
  growth_pct: 0,
  growth_auto: true,
  open_hour: 10,
  close_hour: 21,
  min_shift_hours: 3,
  break_threshold_hours: 5,
  break_minutes: 30,
};

/**
 * Per-venue staffing/projection config. Returns a defaulted config even when no
 * row exists yet, so the UI and engine always have sensible values.
 */
export function useStaffingConfig(restaurantId: string | null) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["staffing-config", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from("staffing_config")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) throw error;
      return (data as StaffingConfig | null) ?? null;
    },
    enabled: !!restaurantId,
  });

  const config: StaffingConfig | null = restaurantId
    ? data ?? {
        restaurant_id: restaurantId,
        ...DEFAULT_STAFFING_CONFIG,
        created_at: "",
        updated_at: "",
      }
    : null;

  const save = useMutation({
    mutationFn: async (patch: Partial<StaffingConfig> & { restaurant_id: string }) => {
      const merged = { ...DEFAULT_STAFFING_CONFIG, ...(data ?? {}), ...patch };
      const { error } = await supabase.from("staffing_config").upsert(
        {
          restaurant_id: patch.restaurant_id,
          ly_weight: merged.ly_weight,
          lw_weight: merged.lw_weight,
          growth_pct: merged.growth_pct,
          growth_auto: merged.growth_auto,
          open_hour: merged.open_hour,
          close_hour: merged.close_hour,
          min_shift_hours: merged.min_shift_hours,
          break_threshold_hours: merged.break_threshold_hours,
          break_minutes: merged.break_minutes,
        },
        { onConflict: "restaurant_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staffing-config"] }),
  });

  return {
    config,
    isLoading,
    save: save.mutateAsync,
    isSaving: save.isPending,
  };
}
