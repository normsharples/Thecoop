import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RosterNote } from "@/types";

/**
 * One free-text roster note per week, per store. `weekStartDate` is the Monday
 * of the roster week (yyyy-MM-dd).
 */
export function useRosterNotes(restaurantId: string | null, weekStartDate: string) {
  const queryClient = useQueryClient();

  const { data: note = null, isLoading } = useQuery({
    queryKey: ["roster-note", restaurantId, weekStartDate],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from("roster_notes")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("week_start_date", weekStartDate)
        .maybeSingle();
      if (error) throw error;
      return (data as RosterNote | null) ?? null;
    },
    enabled: !!restaurantId,
  });

  const saveMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!restaurantId) throw new Error("No restaurant selected");
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("roster_notes").upsert(
        {
          restaurant_id: restaurantId,
          week_start_date: weekStartDate,
          note: text,
          updated_by: userData?.user?.id ?? null,
        },
        { onConflict: "restaurant_id,week_start_date" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["roster-note", restaurantId, weekStartDate],
      });
    },
  });

  return {
    note,
    isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}
