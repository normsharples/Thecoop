import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

/**
 * All rosterable team members (profiles flagged is_rosterable). Roster managers
 * can read these via the profiles_select_roster_manager RLS policy.
 */
export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_rosterable", true)
        .order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });
}
