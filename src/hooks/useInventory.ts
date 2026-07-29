import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { InventoryLevel, InventoryMovement, FoodCostItem } from "@/types";

export interface InventoryLevelRow extends InventoryLevel {
  food_cost_item: FoodCostItem;
}

/**
 * Live on-hand + value per item for a venue (or all venues when null).
 * Reads the trigger-maintained inventory_levels cache and joins the item catalogue.
 */
export function useInventoryLevels(restaurantId: string | null) {
  return useQuery<InventoryLevelRow[]>({
    queryKey: ["inventory-levels", restaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("inventory_levels")
        .select("*, food_cost_item:food_cost_items(*)");
      if (restaurantId) q = q.eq("restaurant_id", restaurantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InventoryLevelRow[];
    },
  });
}

/**
 * Recent ledger movements for a venue (optionally a single item), newest first.
 */
export function useInventoryMovements(
  restaurantId: string | null,
  foodCostItemId?: string,
  limit = 200
) {
  return useQuery<InventoryMovement[]>({
    queryKey: ["inventory-movements", restaurantId ?? "all", foodCostItemId ?? "all", limit],
    queryFn: async () => {
      let q = supabase
        .from("inventory_movements")
        .select("*, food_cost_item:food_cost_items(*)")
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (restaurantId) q = q.eq("restaurant_id", restaurantId);
      if (foodCostItemId) q = q.eq("food_cost_item_id", foodCostItemId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InventoryMovement[];
    },
  });
}
