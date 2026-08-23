import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { mondayOf, toISODate } from "@/lib/roster";
import type { Shift, ShiftSwap } from "@/types";

export type SwapShift = Shift & {
  position?: { name: string; colour: string | null } | null;
  restaurant?: { name: string } | null;
};
export type SwapRow = ShiftSwap & {
  shift?: SwapShift | null;
  offered?: { full_name: string } | null;
  claimed?: { full_name: string } | null;
};

const SWAP_SELECT =
  "*, shift:shifts(*, position:positions(name,colour), restaurant:restaurants(name)), " +
  "offered:profiles!shift_swaps_offered_by_fkey(full_name), " +
  "claimed:profiles!shift_swaps_claimed_by_fkey(full_name)";

/** Team-member swap flows: offer your shift, claim an open one, track/cancel. */
export function useSwaps(employeeId?: string) {
  const qc = useQueryClient();
  const from = toISODate(mondayOf(new Date()));

  // My upcoming shifts (candidates to offer for swap).
  const { data: myShifts = [] } = useQuery({
    queryKey: ["swap-my-shifts", employeeId, from],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*, position:positions(name,colour), restaurant:restaurants(name)")
        .eq("employee_id", employeeId!)
        .gte("date", from)
        .order("date")
        .order("start_time");
      if (error) throw error;
      return data as SwapShift[];
    },
    enabled: !!employeeId,
  });

  // Swaps I'm involved in (offered or claimed).
  const { data: mySwaps = [] } = useQuery({
    queryKey: ["swap-mine", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_swaps")
        .select(SWAP_SELECT)
        .or(`offered_by.eq.${employeeId},claimed_by.eq.${employeeId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SwapRow[];
    },
    enabled: !!employeeId,
  });

  // Open swaps offered by other people that I could pick up.
  const { data: openSwaps = [] } = useQuery({
    queryKey: ["swap-open", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_swaps")
        .select(SWAP_SELECT)
        .eq("status", "offered")
        .neq("offered_by", employeeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SwapRow[];
    },
    enabled: !!employeeId,
  });

  const invalidate = () =>
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("swap-") });

  const offer = useMutation({
    mutationFn: async (p: { shiftId: string; note?: string | null }) => {
      const { error } = await supabase.from("shift_swaps").insert({
        shift_id: p.shiftId,
        offered_by: employeeId,
        status: "offered",
        note: p.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const claim = useMutation({
    mutationFn: async (swapId: string) => {
      const { error } = await supabase
        .from("shift_swaps")
        .update({ claimed_by: employeeId, status: "claimed" })
        .eq("id", swapId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: async (swapId: string) => {
      const { error } = await supabase.from("shift_swaps").delete().eq("id", swapId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const offeredShiftIds = new Set(
    mySwaps
      .filter((s) => ["offered", "claimed", "approved"].includes(s.status))
      .map((s) => s.shift_id)
  );

  return {
    myShifts,
    mySwaps,
    openSwaps,
    offeredShiftIds,
    offer: offer.mutateAsync,
    claim: claim.mutateAsync,
    cancel: cancel.mutateAsync,
  };
}

/** Manager view: approve/decline claimed swaps (reassigns the shift). */
export function useSwapApprovals() {
  const qc = useQueryClient();

  const { data: swaps = [], isLoading } = useQuery({
    queryKey: ["swap-approvals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_swaps")
        .select(SWAP_SELECT)
        .order("status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SwapRow[];
    },
  });

  const review = useMutation({
    mutationFn: async (p: { swap: SwapRow; approve: boolean }) => {
      const { data: userData } = await supabase.auth.getUser();
      const reviewer = userData?.user?.id ?? null;
      if (p.approve) {
        if (!p.swap.claimed_by) throw new Error("No one has claimed this swap yet");
        // Reassign the shift to the claimer, then mark the swap approved.
        const { error: shiftErr } = await supabase
          .from("shifts")
          .update({ employee_id: p.swap.claimed_by })
          .eq("id", p.swap.shift_id);
        if (shiftErr) throw shiftErr;
      }
      const { error } = await supabase
        .from("shift_swaps")
        .update({
          status: p.approve ? "approved" : "declined",
          reviewed_by: reviewer,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", p.swap.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("swap-") });
      qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });

  return { swaps, isLoading, review: review.mutateAsync };
}
