import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { StationTraining, ProficiencyLevel } from "@/types";

/**
 * Station-training records: which stations (positions) each team member is
 * trained on, and their proficiency (basic / intermediate / advanced).
 * Managers manage everyone's; a team member can read their own (RLS).
 *
 * Used by the Training matrix (Settings → Team → Training) and by the roster
 * Auto-build, which only assigns a person to a shift whose position they are
 * trained on.
 */
export function useStationTraining() {
  const qc = useQueryClient();

  const { data: training = [], isLoading } = useQuery({
    queryKey: ["station-training"],
    queryFn: async () => {
      const { data, error } = await supabase.from("station_training").select("*");
      if (error) throw error;
      return data as StationTraining[];
    },
  });

  const setLevel = useMutation({
    mutationFn: async (p: {
      employee_id: string;
      position_id: string;
      level: ProficiencyLevel;
    }) => {
      const { error } = await supabase.from("station_training").upsert(
        {
          employee_id: p.employee_id,
          position_id: p.position_id,
          level: p.level,
        },
        { onConflict: "employee_id,position_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["station-training"] }),
  });

  const clearLevel = useMutation({
    mutationFn: async (p: { employee_id: string; position_id: string }) => {
      const { error } = await supabase
        .from("station_training")
        .delete()
        .eq("employee_id", p.employee_id)
        .eq("position_id", p.position_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["station-training"] }),
  });

  return {
    training,
    isLoading,
    setLevel: setLevel.mutateAsync,
    clearLevel: clearLevel.mutateAsync,
    isSaving: setLevel.isPending || clearLevel.isPending,
  };
}
