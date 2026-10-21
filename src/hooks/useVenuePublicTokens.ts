import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { VenuePublicToken } from "@/types";

/**
 * Manage the public share tokens for the Daily Store Sheet.
 * One token per venue — superadmin / area_manager only (enforced by RLS).
 */
export function useVenuePublicTokens(brandId: string | null) {
  const queryClient = useQueryClient();

  // Fetch tokens for all venues belonging to this brand
  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["venue-public-tokens", brandId],
    queryFn: async () => {
      if (!brandId) return [];

      // Get restaurants for this brand, then left-join their tokens
      const { data: restaurants, error: rErr } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("brand_id", brandId)
        .order("name");
      if (rErr) throw rErr;

      const restaurantIds = restaurants.map((r) => r.id);
      if (restaurantIds.length === 0) return [];

      const { data: tokenRows, error: tErr } = await supabase
        .from("venue_public_tokens")
        .select("*")
        .in("restaurant_id", restaurantIds);
      if (tErr) throw tErr;

      // Merge: every restaurant gets a row, token may be null
      const tokenMap = new Map(
        (tokenRows as VenuePublicToken[]).map((t) => [t.restaurant_id, t])
      );

      return restaurants.map((r) => ({
        restaurant_id: r.id as string,
        restaurant_name: r.name as string,
        token: tokenMap.get(r.id) ?? null,
      }));
    },
    enabled: !!brandId,
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ["venue-public-tokens", brandId],
    });
  }

  // Create or enable a token for a venue
  const createOrEnableMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      const { error } = await supabase
        .from("venue_public_tokens")
        .upsert(
          { restaurant_id: restaurantId, enabled: true },
          { onConflict: "restaurant_id" }
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Toggle enabled
  const toggleMutation = useMutation({
    mutationFn: async ({
      id,
      enabled,
    }: {
      id: string;
      enabled: boolean;
    }) => {
      const { error } = await supabase
        .from("venue_public_tokens")
        .update({ enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Regenerate token (delete + insert so a new uuid is assigned)
  const regenerateMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      // Delete existing
      const { error: dErr } = await supabase
        .from("venue_public_tokens")
        .delete()
        .eq("restaurant_id", restaurantId);
      if (dErr) throw dErr;

      // Insert fresh
      const { error: iErr } = await supabase
        .from("venue_public_tokens")
        .insert({ restaurant_id: restaurantId, enabled: true });
      if (iErr) throw iErr;
    },
    onSuccess: invalidate,
  });

  return {
    tokens,
    isLoading,
    createOrEnable: createOrEnableMutation.mutateAsync,
    toggle: toggleMutation.mutateAsync,
    regenerate: regenerateMutation.mutateAsync,
    isMutating:
      createOrEnableMutation.isPending ||
      toggleMutation.isPending ||
      regenerateMutation.isPending,
  };
}
