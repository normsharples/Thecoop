import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "./usePermissions";
import type { Restaurant } from "@/types";

export function useRestaurants() {
  const { isSuperadmin, assignedRestaurants } = usePermissions();

  return useQuery({
    queryKey: ["restaurants", isSuperadmin, assignedRestaurants],
    queryFn: async () => {
      let query = supabase
        .from("restaurants")
        .select("*")
        .eq("status", "active")
        .order("name");

      if (!isSuperadmin && assignedRestaurants.length > 0) {
        query = query.in("id", assignedRestaurants);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Restaurant[];
    },
  });
}
