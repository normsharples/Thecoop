import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "./usePermissions";
import { useSelectedBrand } from "./useSelectedBrand";
import type { Restaurant } from "@/types";

export function useRestaurants() {
  const { isSuperadmin, assignedRestaurants } = usePermissions();
  const { selectedBrandId } = useSelectedBrand();

  return useQuery({
    queryKey: ["restaurants", isSuperadmin, assignedRestaurants, selectedBrandId],
    queryFn: async () => {
      let query = supabase
        .from("restaurants")
        .select("*")
        .eq("status", "active")
        .order("name");

      if (!isSuperadmin && assignedRestaurants.length > 0) {
        query = query.in("id", assignedRestaurants);
      }

      // When a brand is selected, scope every venue list to that brand.
      if (selectedBrandId) {
        query = query.eq("brand_id", selectedBrandId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Restaurant[];
    },
  });
}
