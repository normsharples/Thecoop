import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  BrandCertificateRequirement,
  BrandChecklistItem,
  BrandExitQuestion,
  BrandPolicyDocument,
  BrandTrainingModule,
} from "@/types";

// ============================================================================
// BRAND TEAM TEMPLATES  (Settings → Brands → Team)
// ----------------------------------------------------------------------------
// Everything configurable about the three Team modules lives per brand: policy
// documents, the induction and exit checklists, which certificates are asked
// for, the training list and the exit survey's questions. One generic hook
// serves all of them because they share the same shape — a brand-scoped,
// sortable, deactivatable list — and writing six near-identical hooks would
// just be six places to fix the next bug.
// ============================================================================

export type TeamTemplateTable =
  | "brand_policy_documents"
  | "brand_onboarding_checklist_items"
  | "brand_certificate_requirements"
  | "brand_training_modules"
  | "brand_exit_checklist_items"
  | "brand_exit_questions";

/** Sort column differs per table only in its secondary key. */
const SECOND_SORT: Record<TeamTemplateTable, string> = {
  brand_policy_documents: "title",
  brand_onboarding_checklist_items: "label",
  brand_certificate_requirements: "label",
  brand_training_modules: "name",
  brand_exit_checklist_items: "label",
  brand_exit_questions: "text",
};

function useTemplateList<T>(table: TeamTemplateTable, brandId?: string | null) {
  return useQuery({
    queryKey: ["team-template", table, brandId ?? "none"],
    enabled: !!brandId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("brand_id", brandId!)
        .order("sort_order")
        .order(SECOND_SORT[table]);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export function useTeamTemplateActions(table: TeamTemplateTable) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["team-template", table] });

  const create = useMutation({
    mutationFn: async (row: Record<string, unknown>) => {
      const { error } = await supabase.from(table).insert(row);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from(table).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export const usePolicyDocuments = (brandId?: string | null) =>
  useTemplateList<BrandPolicyDocument>("brand_policy_documents", brandId);

export const useOnboardingChecklistTemplate = (brandId?: string | null) =>
  useTemplateList<BrandChecklistItem>("brand_onboarding_checklist_items", brandId);

export const useCertificateRequirements = (brandId?: string | null) =>
  useTemplateList<BrandCertificateRequirement>("brand_certificate_requirements", brandId);

export const useTrainingModules = (brandId?: string | null) =>
  useTemplateList<BrandTrainingModule>("brand_training_modules", brandId);

export const useExitChecklistTemplate = (brandId?: string | null) =>
  useTemplateList<BrandChecklistItem>("brand_exit_checklist_items", brandId);

export const useExitQuestions = (brandId?: string | null) =>
  useTemplateList<BrandExitQuestion>("brand_exit_questions", brandId);

/** The brand's payroll onboarding URL — the only non-list setting here. */
export function useSavePayrollUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ brandId, url }: { brandId: string; url: string }) => {
      const { error } = await supabase
        .from("brands")
        .update({ payroll_onboarding_url: url.trim() || null })
        .eq("id", brandId);
      if (error) {
        if (/payroll_onboarding_url/.test(error.message)) {
          throw new Error("Run migration 094_team_onboarding.sql in Supabase first.");
        }
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }),
  });
}
