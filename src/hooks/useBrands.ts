import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Brand } from "@/types";

/**
 * All brands, ordered by name. Returns an empty list (rather than throwing)
 * if the brands table isn't present yet — so the app degrades gracefully
 * before migration 035 has been applied.
 */
export function useBrands() {
  return useQuery({
    queryKey: ["brands"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("*")
        .order("name");
      if (error) {
        // Table may not exist yet — treat as "no brands configured".
        return [] as Brand[];
      }
      return (data ?? []) as Brand[];
    },
  });
}
