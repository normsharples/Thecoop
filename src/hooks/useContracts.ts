import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  buildTokenValues, renderTemplate, pickTemplate, SIG_MARKER, withSignature,
} from "@/lib/contract";
import type {
  EmployeeContract, ContractTemplate, Profile, Restaurant, CompanySettings,
} from "@/types";

export function useEmployeeContracts(employeeId?: string | null) {
  return useQuery({
    queryKey: ["employee-contracts", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_contracts")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmployeeContract[];
    },
  });
}

/** The contract the signed-in person still has to sign, if any. */
export function useMyOpenContract() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-contract", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_contracts")
        .select("*")
        .eq("employee_id", user!.id)
        .in("status", ["issued", "viewed"])
        .order("issued_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as EmployeeContract | null;
    },
  });
}

export interface IssueArgs {
  profile: Profile;
  templates: ContractTemplate[];
  restaurant?: Restaurant | null;
  company: CompanySettings;
  kind?: "contract" | "variation";
  templateId?: string | null;   // explicit override of the automatic match
}

export interface IssuePreview {
  template: ContractTemplate;
  bodyHtml: string;
  tokens: Record<string, string>;
  missing: string[];
  unknown: string[];
}

/**
 * Render a contract for one employee WITHOUT saving it — so the admin can see
 * exactly what will be sent, and so missing fields block the send.
 */
export function previewContract(args: IssueArgs): IssuePreview {
  const template =
    (args.templateId && args.templates.find((t) => t.id === args.templateId)) ||
    pickTemplate(args.templates, {
      employmentType: args.profile.employment_type,
      restaurantId: args.profile.home_restaurant_id,
      kind: args.kind ?? "contract",
    });
  if (!template) {
    throw new Error(
      "No contract template matches this person's employment type and store. Create one in Team → Contracts."
    );
  }
  const tokens = buildTokenValues({
    profile: args.profile,
    restaurant: args.restaurant,
    company: args.company,
  });
  const r = renderTemplate(template.body_html, tokens, { signatureHtml: SIG_MARKER });
  const bodyHtml = r.html.includes(SIG_MARKER) ? r.html : r.html + SIG_MARKER;
  return { template, bodyHtml, tokens, missing: r.missing, unknown: r.unknown };
}

// NOTE: issuing now happens server-side in the `issue-contract` edge function
// (see useAutoIssueContract below). Rendering on the client would let a caller
// choose the contract body, and the employer signatory has to be resolved from
// employee_onboarding.requested_by, which the client cannot be trusted to do.

export function useSignContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contractId,
      name,
      signature,
    }: {
      contractId: string;
      name: string;
      signature: string | null;
    }) => {
      const { data, error } = await supabase.rpc("sign_contract", {
        p_contract_id: contractId,
        p_name: name,
        p_signature: signature,
      });
      if (error) throw error;
      return data as EmployeeContract;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-contract"] });
      qc.invalidateQueries({ queryKey: ["employee-contracts"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
}

export function useMarkViewed() {
  return useMutation({
    mutationFn: async (contractId: string) => {
      await supabase.rpc("mark_contract_viewed", { p_contract_id: contractId });
    },
  });
}

/**
 * Archive a signed contract to the private `contracts` bucket as a standalone
 * .html file (superadmin only — an artifact outside the database that can be
 * handed to an accountant or the Fair Work Ombudsman).
 */
export function useArchiveContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contract,
      company,
    }: {
      contract: EmployeeContract;
      company: CompanySettings;
    }) => {
      const html = renderSignedDocument(contract, company);
      const path = `${contract.employee_id}/${contract.id}.html`;
      const { error: upErr } = await supabase.storage
        .from("contracts")
        .upload(path, new Blob([html], { type: "text/html" }), { upsert: true });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from("employee_contracts")
        .update({ storage_path: path })
        .eq("id", contract.id);
      if (error) throw error;
      return path;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employee-contracts"] }),
  });
}

/** Body + signature panel, ready to display, print or archive. */
export function renderSignedDocument(
  contract: EmployeeContract,
  company: CompanySettings
): string {
  return withSignature(contract.body_html, {
    employeeName: contract.signature_name ?? (contract.tokens?.["employee.legal_name"] || null),
    employeeSignature: contract.signature_image,
    signedAt: contract.signed_at,
    employerName: contract.employer_signatory_name ?? company.signatory_name,
    employerTitle: contract.employer_signatory_title ?? company.signatory_title,
    // The row's own copy wins — it is what was on the document when signed.
    employerSignature: contract.employer_signature_image || company.signature_image || null,
    employerSignedAt: contract.employer_signed_at,
    ip: contract.signature_ip,
    contentHash: contract.content_hash,
  });
}

/**
 * Ask the server to issue the contract if — and only if — both halves are
 * ready: the admin has set the employment terms and the employee has finished
 * their own details. Safe to call speculatively; it returns
 * `{issued:false, reason}` and does nothing when it isn't time yet.
 *
 * Rendering happens in the edge function under the service role, so the body
 * can never be supplied by the caller, and the employer signature is whoever
 * started the onboarding rather than one fixed company signatory.
 */
export function useAutoIssueContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      employeeId?: string;
      kind?: "contract" | "variation";
      templateId?: string | null;
      force?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke("issue-contract", {
        body: {
          employee_id: args.employeeId,
          kind: args.kind ?? "contract",
          template_id: args.templateId ?? undefined,
          force: args.force ?? false,
        },
      });
      if (error) {
        let message = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const payload = await ctx.json();
            if (payload?.error) message = payload.error;
          } catch { /* keep the original */ }
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      return data as {
        issued: boolean;
        reason?: string;
        missing?: string[];
        blockers?: string[];
        detail?: string;
        contract_id?: string;
        signatory?: string;
      };
    },
    onSuccess: (res) => {
      if (res?.issued) {
        qc.invalidateQueries({ queryKey: ["my-contract"] });
        qc.invalidateQueries({ queryKey: ["employee-contracts"] });
        qc.invalidateQueries({ queryKey: ["onboarding"] });
      }
    },
  });
}

/** Plain-English reason the contract has not gone out yet. */
export const ISSUE_REASONS: Record<string, string> = {
  no_onboarding_record: "This person isn't set up for onboarding.",
  not_ready: "Waiting on the employment terms or the employee's own details.",
  no_template: "No contract template matches their employment type and store.",
  missing_fields: "Some fields the template needs are still empty.",
  setup_incomplete:
    "The database is missing migration 065 — apply it, then this will work.",
};

/** The specific reasons a contract has not been sent, straight from the DB. */
export function useIssueBlockers(employeeId?: string | null) {
  return useQuery({
    queryKey: ["contract-blockers", employeeId],
    enabled: !!employeeId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contract_issue_blockers", {
        target: employeeId!,
      });
      // Migration 066 not applied yet — don't break the page over it.
      if (error) return null;
      return (data ?? []) as string[];
    },
  });
}
