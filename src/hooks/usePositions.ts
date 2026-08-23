import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Position } from "@/types";

/**
 * Areas / sub-areas. Positions may be global (restaurant_id null = All
 * locations) or venue-specific. Pass a `restaurantId` to scope the returned
 * lists to that venue (global + that venue's own); omit it to get everything
 * (used by the settings editor, which manages each scope explicitly).
 */
export function usePositions(restaurantId?: string | null) {
  const queryClient = useQueryClient();

  const { data: allPositions = [], isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data as Position[];
    },
  });

  // Scoped view: global (null) + this venue's own, when a venue is given.
  const positions = useMemo(
    () =>
      restaurantId
        ? allPositions.filter(
            (p) => p.restaurant_id == null || p.restaurant_id === restaurantId
          )
        : allPositions,
    [allPositions, restaurantId]
  );

  const upsert = useMutation({
    mutationFn: async (payload: Partial<Position> & { name: string }) => {
      const { error } = await supabase.from("positions").upsert({
        ...(payload.id ? { id: payload.id } : {}),
        name: payload.name,
        colour: payload.colour ?? null,
        sort_order: payload.sort_order ?? 0,
        active: payload.active ?? true,
        parent_id: payload.parent_id ?? null,
        restaurant_id: payload.restaurant_id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("positions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  return {
    positions,
    allPositions,
    activePositions: positions.filter((p) => p.active),
    isLoading,
    upsert: upsert.mutateAsync,
    isSaving: upsert.isPending,
    remove: remove.mutateAsync,
  };
}
