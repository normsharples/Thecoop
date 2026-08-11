import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RosterRefreshRequest } from "@/types";

/**
 * On-demand roster refresh. The web app can't reach the local Deputy scraper
 * directly, so instead it inserts a 'pending' request row that the scraper
 * (sync.mjs --watch) polls, runs, and marks 'done'/'error'. We poll the latest
 * request for this store+week to reflect progress in the UI.
 */
export function useRosterRefresh(restaurantId: string | null, weekStart: string) {
  const queryClient = useQueryClient();

  const { data: latest = null } = useQuery({
    queryKey: ["roster-refresh", restaurantId, weekStart],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from("roster_refresh_requests")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("week_start", weekStart)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as RosterRefreshRequest | null) ?? null;
    },
    enabled: !!restaurantId,
    // Poll while a request is in flight so the button reflects progress.
    refetchInterval: (query) => {
      const row = query.state.data as RosterRefreshRequest | null;
      return row && (row.status === "pending" || row.status === "running")
        ? 5000
        : false;
    },
  });

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("No restaurant selected");
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("roster_refresh_requests").insert({
        restaurant_id: restaurantId,
        week_start: weekStart,
        status: "pending",
        requested_by: userData?.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["roster-refresh", restaurantId, weekStart],
      });
    },
  });

  const isInFlight =
    latest?.status === "pending" || latest?.status === "running";

  return {
    latest,
    isInFlight,
    requestRefresh: requestMutation.mutateAsync,
    isRequesting: requestMutation.isPending,
  };
}
