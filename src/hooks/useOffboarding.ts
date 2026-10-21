import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";
import type {
  ExitReason,
  ExitSurveyResponse,
  OffboardingChecklistRow,
  OffboardingRow,
  PendingExitSurvey,
  PulseAnswer,
} from "@/types";

// ============================================================================
// OFFBOARDING
// ----------------------------------------------------------------------------
// Everything reads public.offboarding_list — the view without private_notes —
// and every write goes through an RPC that checks the caller itself. The notes
// are fetched one row at a time by offboardingNotes(), which the database
// refuses unless you are a brand admin.
// ============================================================================

export const EXIT_REASON_LABEL: Record<ExitReason, string> = {
  resigned: "Resigned",
  terminated: "Terminated",
  abandoned: "Abandoned employment",
  end_of_contract: "End of contract",
};

export const EXIT_REASONS = Object.entries(EXIT_REASON_LABEL).map(([value, label]) => ({
  value: value as ExitReason,
  label,
}));

export function useOffboardings(restaurantIds?: string[]) {
  return useQuery({
    queryKey: ["offboardings", restaurantIds ?? "all"],
    retry: false,
    queryFn: async () => {
      let q = supabase
        .from("offboarding_list")
        .select("*")
        .is("superseded_at", null)
        .order("last_shift_date", { ascending: false });
      if (restaurantIds?.length) q = q.in("restaurant_id", restaurantIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OffboardingRow[];
    },
  });
}

export function useOffboardingChecklist(offboardingId?: string | null) {
  return useQuery({
    queryKey: ["offboarding-checklist", offboardingId],
    enabled: !!offboardingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offboarding_checklist")
        .select("*")
        .eq("offboarding_id", offboardingId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as OffboardingChecklistRow[];
    },
  });
}

/** Brand admin only — the database refuses everyone else. */
export function useOffboardingNotes(offboardingId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["offboarding-notes", offboardingId],
    enabled: !!offboardingId && enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("offboarding_notes", { p_id: offboardingId });
      if (error) throw error;
      return (data as string | null) ?? "";
    },
  });
}

export function useExitSurveyResponses(offboardingId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["exit-survey-responses", offboardingId],
    enabled: !!offboardingId && enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exit_survey_responses")
        .select("*")
        .eq("offboarding_id", offboardingId!)
        .order("submitted_at");
      if (error) throw error;
      return (data ?? []) as ExitSurveyResponse[];
    },
  });
}

export interface StartExitInput {
  employeeId: string;
  reason: ExitReason;
  lastShiftDate: string;
  eligibleForRehire: boolean;
  privateNotes?: string;
  exitSurvey: boolean;
}

export function useOffboardingActions() {
  const qc = useQueryClient();
  const invalidate = (id?: string) => {
    qc.invalidateQueries({ queryKey: ["offboardings"] });
    qc.invalidateQueries({ queryKey: ["team-audit"] });
    qc.invalidateQueries({ queryKey: ["shifts"] });
    qc.invalidateQueries({ queryKey: ["roster-week"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
    if (id) {
      qc.invalidateQueries({ queryKey: ["offboarding-checklist", id] });
      qc.invalidateQueries({ queryKey: ["offboarding-notes", id] });
    }
  };

  /**
   * One call: records the exit, opens up every shift after the last day, builds
   * the checklist and schedules revocation. Returns the number of shifts it
   * unassigned so the UI can say so instead of leaving it a surprise.
   */
  const start = useMutation({
    mutationFn: async (input: StartExitInput) => {
      const { data, error } = await supabase.rpc("offboarding_start", {
        p_employee_id: input.employeeId,
        p_reason: input.reason,
        p_last_shift_date: input.lastShiftDate,
        p_eligible_for_rehire: input.eligibleForRehire,
        p_private_notes: input.privateNotes?.trim() || null,
        p_exit_survey: input.exitSurvey,
      });
      if (error) throw error;
      const id = data as string;
      const { data: row } = await supabase
        .from("offboarding_list")
        .select("shifts_unassigned")
        .eq("id", id)
        .maybeSingle();
      return {
        id,
        shiftsUnassigned: (row as { shifts_unassigned: number } | null)?.shifts_unassigned ?? 0,
      };
    },
    onSuccess: (r) => invalidate(r.id),
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      reason,
      lastShiftDate,
      eligibleForRehire,
      exitSurvey,
    }: {
      id: string;
      reason?: ExitReason;
      lastShiftDate?: string;
      eligibleForRehire?: boolean;
      exitSurvey?: boolean;
    }) => {
      const { error } = await supabase.rpc("offboarding_update", {
        p_id: id,
        p_reason: reason ?? null,
        p_last_shift_date: lastShiftDate ?? null,
        p_eligible_for_rehire: eligibleForRehire ?? null,
        p_exit_survey: exitSurvey ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const setNotes = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase.rpc("offboarding_set_notes", {
        p_id: id,
        p_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const reinvite = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("offboarding_reinvite", { p_id: id });
      if (error) throw error;
      return data as string; // the new new_hires id
    },
    onSuccess: (_d, id) => {
      invalidate(id);
      qc.invalidateQueries({ queryKey: ["new-hires"] });
    },
  });

  return { start, update, setNotes, reinvite };
}

export function useToggleExitChecklist() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      rowId,
      offboardingId,
      done,
    }: {
      rowId: string;
      offboardingId: string;
      done: boolean;
    }) => {
      const { error } = await supabase
        .from("offboarding_checklist")
        .update({
          done,
          done_by: done ? user?.id ?? null : null,
          done_at: done ? new Date().toISOString() : null,
        })
        .eq("id", rowId);
      if (error) throw error;
      void offboardingId;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["offboarding-checklist", v.offboardingId] });
      qc.invalidateQueries({ queryKey: ["offboardings"] });
    },
  });
}

// ── The leaver's own side ───────────────────────────────────────────────────

/** The exit survey waiting for the signed-in person, if any. */
export function usePendingExitSurvey() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["exit-survey-for-me", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("exit_survey_for_me");
      if (error) return null;
      return (data as PendingExitSurvey | null) ?? null;
    },
  });
}

export function useExitSurveySubmit() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["exit-survey-for-me"] });

  const submit = useMutation({
    mutationFn: async ({
      offboardingId,
      answers,
    }: {
      offboardingId: string;
      answers: PulseAnswer[];
    }) => {
      const { error } = await supabase.rpc("exit_survey_submit", {
        p_offboarding: offboardingId,
        p_answers: answers,
      });
      if (error) throw error;
    },
    onSuccess: done,
  });

  const skip = useMutation({
    mutationFn: async (offboardingId: string) => {
      const { error } = await supabase.rpc("exit_survey_skip", {
        p_offboarding: offboardingId,
      });
      if (error) throw error;
    },
    onSuccess: done,
  });

  return { submit, skip };
}
