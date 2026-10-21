import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";
import { useActiveBrand } from "./useActiveBrand";
import type {
  PulseAnswer,
  PulseBenchmarkRow,
  PulseCycle,
  PulseOpenSurvey,
  PulseQuestion,
  PulseQuestionAverage,
  PulseResponseRate,
  PulseRecurrence,
  PulseRunnerQuestion,
  PulseSurvey,
  PulseTrendRow,
} from "@/types";

// ============================================================================
// PULSE SURVEYS
// ----------------------------------------------------------------------------
// Two halves that never meet. The question bank and the surveys are ordinary
// tables read through RLS; every *result* comes back from an aggregate RPC that
// applies the 5-response anonymity floor in the database. Nothing in this file
// selects from pulse_responses, because nothing can — the table has no read
// policy at all (migration 093).
// ============================================================================

export const RECURRENCE_LABEL: Record<PulseRecurrence, string> = {
  none: "One-off",
  weekly: "Every week",
  fortnightly: "Every fortnight",
  monthly: "Every month",
};

/** 1–5 with faces, so nobody has to decode a number. */
export const SCALE_FACES = [
  { value: 1, emoji: "😞", label: "Bad" },
  { value: 2, emoji: "🙁", label: "Not great" },
  { value: 3, emoji: "😐", label: "OK" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😄", label: "Great" },
] as const;

// ── Question bank ───────────────────────────────────────────────────────────

export function usePulseQuestions(brandId?: string | null) {
  return useQuery({
    queryKey: ["pulse-questions", brandId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("pulse_questions").select("*").order("sort_order");
      if (brandId) q = q.eq("brand_id", brandId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PulseQuestion[];
    },
  });
}

export function usePulseQuestionActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pulse-questions"] });
    qc.invalidateQueries({ queryKey: ["team-audit"] });
  };

  const create = useMutation({
    mutationFn: async (input: {
      brandId: string;
      text: string;
      type: PulseQuestion["type"];
      sortOrder?: number;
    }) => {
      const { error } = await supabase.from("pulse_questions").insert({
        brand_id: input.brandId,
        text: input.text.trim(),
        type: input.type,
        sort_order: input.sortOrder ?? 0,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /**
   * Saves through the RPC, not a plain update: when the wording of a question
   * that already has answers changes, the database writes a new version and
   * keeps the old one, so no response is ever re-labelled after the fact.
   */
  const save = useMutation({
    mutationFn: async (input: {
      id: string;
      text: string;
      isActive?: boolean;
      sortOrder?: number;
    }) => {
      const { data, error } = await supabase.rpc("pulse_save_question", {
        p_question_id: input.id,
        p_text: input.text.trim(),
        p_is_active: input.isActive ?? null,
        p_sort_order: input.sortOrder ?? null,
      });
      if (error) throw error;
      return { newId: data as string | null, versioned: data !== input.id };
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: async (ordered: { id: string; sort_order: number }[]) => {
      for (const row of ordered) {
        const { error } = await supabase
          .from("pulse_questions")
          .update({ sort_order: row.sort_order })
          .eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pulse_questions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, save, reorder, remove };
}

// ── Surveys ─────────────────────────────────────────────────────────────────

export type SurveyWithQuestions = PulseSurvey & { question_ids: string[] };

export function usePulseSurveys(brandId?: string | null) {
  return useQuery({
    queryKey: ["pulse-surveys", brandId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("pulse_surveys")
        .select("*, pulse_survey_questions(question_id, sort_order)")
        .order("opens_at", { ascending: false });
      if (brandId) q = q.eq("brand_id", brandId);
      const { data, error } = await q;
      if (error) throw error;
      type Raw = PulseSurvey & {
        pulse_survey_questions: { question_id: string; sort_order: number }[] | null;
      };
      return ((data ?? []) as Raw[]).map((s) => ({
        ...s,
        question_ids: (s.pulse_survey_questions ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((r) => r.question_id),
      })) as SurveyWithQuestions[];
    },
  });
}

export interface SurveyInput {
  id?: string;
  brand_id: string;
  title: string;
  opens_at: string;
  closes_at: string;
  recurrence: PulseRecurrence;
  target: "all_venues" | "selected";
  target_venue_ids: string[];
  question_ids: string[];
}

export function usePulseSurveyActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pulse-surveys"] });
    qc.invalidateQueries({ queryKey: ["pulse-open-for-me"] });
    qc.invalidateQueries({ queryKey: ["team-audit"] });
  };

  const save = useMutation({
    mutationFn: async (input: SurveyInput) => {
      const row = {
        brand_id: input.brand_id,
        title: input.title.trim(),
        opens_at: input.opens_at,
        closes_at: input.closes_at,
        recurrence: input.recurrence,
        target: input.target,
        target_venue_ids: input.target === "selected" ? input.target_venue_ids : [],
      };

      let surveyId = input.id;
      if (surveyId) {
        const { error } = await supabase.from("pulse_surveys").update(row).eq("id", surveyId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("pulse_surveys")
          .insert({ ...row, created_by: user?.id ?? null })
          .select("id")
          .single();
        if (error) throw error;
        surveyId = (data as { id: string }).id;
      }

      // Replace the question set wholesale — it is a small list and the join
      // table has no other state worth preserving.
      const { error: delErr } = await supabase
        .from("pulse_survey_questions")
        .delete()
        .eq("survey_id", surveyId);
      if (delErr) throw delErr;

      if (input.question_ids.length) {
        const { error: insErr } = await supabase.from("pulse_survey_questions").insert(
          input.question_ids.map((qid, i) => ({
            survey_id: surveyId,
            question_id: qid,
            sort_order: (i + 1) * 10,
          }))
        );
        if (insErr) throw insErr;
      }

      return surveyId as string;
    },
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PulseSurvey["status"] }) => {
      const { error } = await supabase.from("pulse_surveys").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pulse_surveys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { save, setStatus, remove };
}

/** Which cycle a survey is in right now, and whether it is accepting answers. */
export function usePulseCycle(surveyId?: string | null) {
  return useQuery({
    queryKey: ["pulse-cycle", surveyId],
    enabled: !!surveyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_cycle", { p_survey: surveyId });
      if (error) throw error;
      return ((data ?? []) as PulseCycle[])[0] ?? null;
    },
  });
}

// ── Staff side ──────────────────────────────────────────────────────────────

/**
 * Open check-ins the signed-in person has not answered this cycle. Drives the
 * dashboard banner and the Team nav badge, so it refetches on focus — someone
 * finishing on their phone should see the banner go on the desktop too.
 */
export function usePulseOpenForMe() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pulse-open-for-me", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_open_for_me");
      // Before migration 093 is applied the function does not exist — behave
      // as "nothing open" rather than throwing on every page load.
      if (error) return [] as PulseOpenSurvey[];
      return (data ?? []) as PulseOpenSurvey[];
    },
  });
}

export function usePulseRunnerQuestions(surveyId?: string | null) {
  return useQuery({
    queryKey: ["pulse-runner-questions", surveyId],
    enabled: !!surveyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_questions_for_survey", {
        p_survey: surveyId,
      });
      if (error) throw error;
      return (data ?? []) as PulseRunnerQuestion[];
    },
  });
}

export function usePulseSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ surveyId, answers }: { surveyId: string; answers: PulseAnswer[] }) => {
      const { error } = await supabase.rpc("pulse_submit", {
        p_survey: surveyId,
        p_answers: answers,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pulse-open-for-me"] });
      qc.invalidateQueries({ queryKey: ["pulse-results"] });
    },
  });
}

// ── Results (all server-aggregated and floor-enforced) ──────────────────────

export function usePulseResponseRate(
  surveyId?: string | null,
  cycleStart?: string | null,
  venueId?: string | null
) {
  return useQuery({
    queryKey: ["pulse-results", "rate", surveyId, cycleStart, venueId],
    enabled: !!surveyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_response_rate", {
        p_survey: surveyId,
        p_cycle_start: cycleStart ?? null,
        p_venue: venueId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as PulseResponseRate[];
    },
  });
}

export function usePulseQuestionAverages(
  surveyId?: string | null,
  cycleStart?: string | null,
  venueId?: string | null
) {
  return useQuery({
    queryKey: ["pulse-results", "averages", surveyId, cycleStart, venueId],
    enabled: !!surveyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_question_averages", {
        p_survey: surveyId,
        p_cycle_start: cycleStart ?? null,
        p_venue: venueId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as PulseQuestionAverage[];
    },
  });
}

export function usePulseTrend(
  surveyId?: string | null,
  venueId?: string | null,
  cycles = 12
) {
  return useQuery({
    queryKey: ["pulse-results", "trend", surveyId, venueId, cycles],
    enabled: !!surveyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_trend", {
        p_survey: surveyId,
        p_venue: venueId ?? null,
        p_cycles: cycles,
      });
      if (error) throw error;
      return (data ?? []) as PulseTrendRow[];
    },
  });
}

export function usePulseComments(
  surveyId?: string | null,
  cycleStart?: string | null,
  venueId?: string | null
) {
  return useQuery({
    queryKey: ["pulse-results", "comments", surveyId, cycleStart, venueId],
    enabled: !!surveyId,
    // Shuffled server-side on every call; no point caching an order.
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_comments", {
        p_survey: surveyId,
        p_cycle_start: cycleStart ?? null,
        p_venue: venueId ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as { comment: string }[]).map((r) => r.comment);
    },
  });
}

export function usePulseBenchmark(surveyId?: string | null, cycleStart?: string | null) {
  return useQuery({
    queryKey: ["pulse-results", "benchmark", surveyId, cycleStart],
    enabled: !!surveyId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pulse_benchmark", {
        p_survey: surveyId,
        p_cycle_start: cycleStart ?? null,
      });
      if (error) throw error;
      return (data ?? []) as PulseBenchmarkRow[];
    },
  });
}

/**
 * The survey the brand in view should report on by default: the one that is
 * open, else the most recent to have closed.
 */
export function useDefaultPulseSurvey() {
  const { brand } = useActiveBrand();
  const { data: surveys = [], isLoading } = usePulseSurveys(brand?.id ?? null);
  const open = surveys.find((s) => s.status === "open");
  return { survey: open ?? surveys[0] ?? null, surveys, isLoading };
}
