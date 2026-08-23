import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { SEED_TEMPLATES } from "@/lib/contractSeeds";
import type { ContractTemplate, ContractTemplateVersion } from "@/types";

export function useContractTemplates() {
  return useQuery({
    queryKey: ["contract-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_templates")
        .select("*")
        .order("kind")
        .order("name");
      if (error) throw error;
      return (data ?? []) as ContractTemplate[];
    },
  });
}

export function useTemplateVersions(templateId?: string | null) {
  return useQuery({
    queryKey: ["contract-template-versions", templateId],
    enabled: !!templateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_template_versions")
        .select("*")
        .eq("template_id", templateId!)
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContractTemplateVersion[];
    },
  });
}

export function useTemplateActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["contract-templates"] });

  const create = useMutation({
    mutationFn: async (t: Partial<ContractTemplate>) => {
      const { data, error } = await supabase
        .from("contract_templates")
        .insert({
          name: t.name ?? "Untitled template",
          kind: t.kind ?? "contract",
          employment_type: t.employment_type ?? null,
          restaurant_id: t.restaurant_id ?? null,
          body_html: t.body_html ?? "",
          is_seed_draft: t.is_seed_draft ?? false,
          active: t.active ?? true,
          updated_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ContractTemplate;
    },
    onSuccess: invalidate,
  });

  /**
   * Saving snapshots the OUTGOING body as a version row first, then bumps the
   * template. A signed contract records template_id + template_version, so an
   * old signature can always be traced to the exact wording it agreed to.
   */
  const save = useMutation({
    mutationFn: async ({
      template,
      patch,
    }: {
      template: ContractTemplate;
      patch: Partial<ContractTemplate>;
    }) => {
      const bodyChanged = patch.body_html != null && patch.body_html !== template.body_html;
      if (bodyChanged) {
        const { error: vErr } = await supabase.from("contract_template_versions").insert({
          template_id: template.id,
          version: template.version,
          name: template.name,
          body_html: template.body_html,
          created_by: user?.id ?? null,
        });
        if (vErr) throw vErr;
      }
      const { error } = await supabase
        .from("contract_templates")
        .update({
          ...patch,
          version: bodyChanged ? template.version + 1 : template.version,
          is_seed_draft: bodyChanged ? false : template.is_seed_draft,
          updated_by: user?.id ?? null,
        })
        .eq("id", template.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["contract-template-versions", vars.template.id] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contract_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** One-click "give me something to work with" — flagged as unreviewed drafts. */
  const seed = useMutation({
    mutationFn: async () => {
      const rows = SEED_TEMPLATES.map((t) => ({
        name: t.name,
        kind: t.kind,
        employment_type: t.employment_type,
        restaurant_id: null,
        body_html: t.body_html,
        is_seed_draft: true,
        active: true,
        updated_by: user?.id ?? null,
      }));
      const { error } = await supabase.from("contract_templates").insert(rows);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, save, remove, seed };
}
