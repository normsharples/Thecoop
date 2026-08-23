import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { StaffingMatrixRow } from "@/types";

/**
 * The "sales vs required staff" matrix for one venue. Each row is a required
 * slot that switches on at its sales threshold. Roster managers edit it.
 */
export function useStaffingMatrix(restaurantId: string | null) {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["staffing-matrix", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("staffing_matrix")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("slot_order")
        .order("threshold_sales");
      if (error) throw error;
      return data as StaffingMatrixRow[];
    },
    enabled: !!restaurantId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["staffing-matrix"] });

  const upsert = useMutation({
    mutationFn: async (
      row: Partial<StaffingMatrixRow> & { restaurant_id: string; station_name: string }
    ) => {
      const { error } = await supabase.from("staffing_matrix").upsert({
        ...(row.id ? { id: row.id } : {}),
        restaurant_id: row.restaurant_id,
        station_name: row.station_name,
        position_id: row.position_id ?? null,
        threshold_sales: row.threshold_sales ?? 0,
        slot_order: row.slot_order ?? 0,
        active: row.active ?? true,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staffing_matrix").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Replace the whole matrix for a venue (used by "Load default template").
  const replaceAll = useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      rows: { station_name: string; threshold_sales: number; position_id?: string | null }[];
    }) => {
      const del = await supabase
        .from("staffing_matrix")
        .delete()
        .eq("restaurant_id", payload.restaurant_id);
      if (del.error) throw del.error;
      if (payload.rows.length) {
        const ins = payload.rows.map((r, i) => ({
          restaurant_id: payload.restaurant_id,
          station_name: r.station_name,
          threshold_sales: r.threshold_sales,
          position_id: r.position_id ?? null,
          slot_order: i,
          active: true,
        }));
        const { error } = await supabase.from("staffing_matrix").insert(ins);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  return {
    rows,
    isLoading,
    upsert: upsert.mutateAsync,
    remove: remove.mutateAsync,
    replaceAll: replaceAll.mutateAsync,
    isSaving: upsert.isPending || replaceAll.isPending,
  };
}
