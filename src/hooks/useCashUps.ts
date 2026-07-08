import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { CashUp, CashOutItem } from "@/types";

// Australian note/coin denominations, values in cents to avoid float rounding
// errors when summing (e.g. 0.05 + 0.2 + 0.1 in JS floating point).
export const DENOMINATIONS = [
  { key: "10000", label: "$100", cents: 10000, type: "note" as const },
  { key: "5000", label: "$50", cents: 5000, type: "note" as const },
  { key: "2000", label: "$20", cents: 2000, type: "note" as const },
  { key: "1000", label: "$10", cents: 1000, type: "note" as const },
  { key: "500", label: "$5", cents: 500, type: "note" as const },
  { key: "200", label: "$2", cents: 200, type: "coin" as const },
  { key: "100", label: "$1", cents: 100, type: "coin" as const },
  { key: "50", label: "50c", cents: 50, type: "coin" as const },
  { key: "20", label: "20c", cents: 20, type: "coin" as const },
  { key: "10", label: "10c", cents: 10, type: "coin" as const },
  { key: "5", label: "5c", cents: 5, type: "coin" as const },
];

export function tillTotalFromCounts(counts: Record<string, number>): number {
  const cents = DENOMINATIONS.reduce(
    (sum, d) => sum + (counts[d.key] ?? 0) * d.cents,
    0
  );
  return cents / 100;
}

export function useCashUps(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const { data: cashUps = [], isLoading } = useQuery({
    queryKey: ["cash-ups", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("cash_ups")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("cash_up_date", { ascending: false });
      if (error) throw error;
      return data as CashUp[];
    },
    enabled: !!restaurantId,
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: {
      restaurant_id: string;
      cash_up_date: string;
      denomination_counts: Record<string, number>;
      amount_deposited: number;
      pos_expected_deposit: number;
      cash_outs: CashOutItem[];
      notes: string | null;
    }) => {
      const { error } = await supabase.from("cash_ups").upsert(
        {
          restaurant_id: payload.restaurant_id,
          cash_up_date: payload.cash_up_date,
          till_count: tillTotalFromCounts(payload.denomination_counts),
          denomination_counts: payload.denomination_counts,
          amount_deposited: payload.amount_deposited,
          pos_expected_deposit: payload.pos_expected_deposit,
          cash_outs: payload.cash_outs,
          notes: payload.notes,
          recorded_by: profile?.id ?? null,
        },
        { onConflict: "restaurant_id,cash_up_date" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-ups", restaurantId] });
    },
  });

  return {
    cashUps,
    isLoading,
    upsert: upsertMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
  };
}
