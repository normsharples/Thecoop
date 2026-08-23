import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RosterWeek } from "@/types";

/**
 * The draft/published state for one store + week. Absence of a row means the
 * week has never been published (treated as draft). Publishing upserts the row.
 */
export function useRosterWeek(restaurantId: string | null, weekStartISO: string) {
  const queryClient = useQueryClient();
  const key = ["roster-week", restaurantId, weekStartISO];

  const { data: week = null, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from("roster_weeks")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("week_start", weekStartISO)
        .maybeSingle();
      if (error) throw error;
      return (data as RosterWeek | null) ?? null;
    },
    enabled: !!restaurantId,
  });

  const setStatus = useMutation({
    mutationFn: async (status: "draft" | "published") => {
      if (!restaurantId) throw new Error("No store selected");
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("roster_weeks").upsert(
        {
          restaurant_id: restaurantId,
          week_start: weekStartISO,
          status,
          published_at: status === "published" ? new Date().toISOString() : null,
          published_by: status === "published" ? userData?.user?.id ?? null : null,
        },
        { onConflict: "restaurant_id,week_start" }
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roster-week"] }),
  });

  return {
    week,
    status: week?.status ?? "draft",
    isPublished: week?.status === "published",
    isLoading,
    publish: () => setStatus.mutateAsync("published"),
    unpublish: () => setStatus.mutateAsync("draft"),
    isUpdating: setStatus.isPending,
  };
}
