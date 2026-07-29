import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { StockTransfer } from "@/types";

/**
 * Transfers involving a venue (either end), newest first, with lines + item and
 * venue names resolved. Pass null for all venues.
 */
export function useTransfers(restaurantId: string | null) {
  return useQuery<StockTransfer[]>({
    queryKey: ["stock-transfers", restaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("stock_transfers")
        .select(
          `*,
           from_restaurant:restaurants!from_restaurant_id(id, name),
           to_restaurant:restaurants!to_restaurant_id(id, name),
           lines:stock_transfer_lines(*, food_cost_item:food_cost_items(id, name, unit))`
        )
        .order("sent_at", { ascending: false });
      if (restaurantId) {
        q = q.or(`from_restaurant_id.eq.${restaurantId},to_restaurant_id.eq.${restaurantId}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as StockTransfer[];
    },
  });
}
