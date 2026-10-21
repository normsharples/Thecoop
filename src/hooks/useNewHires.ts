import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";
import type {
  CertificateComplianceRow,
  NewHire,
  NewHireCertificate,
  NewHireChecklistRow,
  NewHireIntake,
  NewHirePolicySignoff,
  NewHireStatus,
  NewHireTrainingRow,
  RosterBlockedEmployee,
} from "@/types";

// ============================================================================
// ONBOARDING — manager side
// ----------------------------------------------------------------------------
// The hire's own side of this lives in useNewHireIntake() at the bottom: it is
// unauthenticated and talks only to token RPCs, so it deliberately shares no
// query keys with anything here.
// ============================================================================

export const HIRE_STATUS_LABEL: Record<NewHireStatus, string> = {
  invited: "Invited",
  in_progress: "In progress",
  ready: "Ready to roster",
  active: "Active",
};

/** Where the status sits on the "can they work yet" line. */
export const HIRE_STATUS_TONE: Record<NewHireStatus, "muted" | "warning" | "success"> = {
  invited: "muted",
  in_progress: "warning",
  ready: "success",
  active: "success",
};

export function useNewHires(restaurantIds?: string[]) {
  return useQuery({
    queryKey: ["new-hires", restaurantIds ?? "all"],
    retry: false,
    queryFn: async () => {
      let q = supabase.from("new_hires").select("*").order("created_at", { ascending: false });
      if (restaurantIds?.length) q = q.in("restaurant_id", restaurantIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as NewHire[];
    },
  });
}

export function useNewHire(id?: string | null) {
  return useQuery({
    queryKey: ["new-hire", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("new_hires").select("*").eq("id", id!).single();
      if (error) throw error;
      return data as NewHire;
    },
  });
}

export interface NewHireInput {
  brand_id: string;
  restaurant_id: string;
  full_name: string;
  mobile: string;
  role: NewHire["role"];
  position_title?: string | null;
  start_date?: string | null;
}

export function useNewHireActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidate = (id?: string) => {
    qc.invalidateQueries({ queryKey: ["new-hires"] });
    qc.invalidateQueries({ queryKey: ["roster-blocked"] });
    qc.invalidateQueries({ queryKey: ["team-audit"] });
    qc.invalidateQueries({ queryKey: ["certificate-compliance"] });
    if (id) qc.invalidateQueries({ queryKey: ["new-hire", id] });
  };

  /** Creates the hire and returns the row, including the invite token. */
  const create = useMutation({
    mutationFn: async (input: NewHireInput) => {
      const { data, error } = await supabase
        .from("new_hires")
        .insert({
          brand_id: input.brand_id,
          restaurant_id: input.restaurant_id,
          full_name: input.full_name.trim(),
          mobile: input.mobile.trim(),
          role: input.role,
          position_title: input.position_title?.trim() || null,
          start_date: input.start_date || null,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as NewHire;
    },
    onSuccess: () => invalidate(),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NewHire> }) => {
      const { error } = await supabase.from("new_hires").update(patch).eq("id", id);
      if (error) throw error;
      await supabase.rpc("new_hire_recalc", { p_id: id });
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const reissueInvite = useMutation({
    mutationFn: async ({ id, days = 30 }: { id: string; days?: number }) => {
      const { data, error } = await supabase.rpc("new_hire_reissue_invite", {
        p_id: id,
        p_days: days,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const linkProfile = useMutation({
    mutationFn: async ({ id, profileId }: { id: string; profileId: string }) => {
      const { error } = await supabase.rpc("new_hire_link_profile", {
        p_id: id,
        p_profile_id: profileId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => invalidate(v.id),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("new_hires").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  return { create, update, reissueInvite, linkProfile, remove };
}

// ── The hire's paperwork, as the manager sees it ────────────────────────────

export function useNewHireCertificates(hireId?: string | null) {
  return useQuery({
    queryKey: ["new-hire-certificates", hireId],
    enabled: !!hireId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("new_hire_certificates")
        .select("*")
        .eq("new_hire_id", hireId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as NewHireCertificate[];
    },
  });
}

export function useNewHireSignoffs(hireId?: string | null) {
  return useQuery({
    queryKey: ["new-hire-signoffs", hireId],
    enabled: !!hireId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("new_hire_policy_signoffs")
        .select("*")
        .eq("new_hire_id", hireId!)
        .order("signed_at");
      if (error) throw error;
      return (data ?? []) as NewHirePolicySignoff[];
    },
  });
}

export function useNewHireChecklist(hireId?: string | null) {
  return useQuery({
    queryKey: ["new-hire-checklist", hireId],
    enabled: !!hireId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("new_hire_checklist")
        .select("*")
        .eq("new_hire_id", hireId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as NewHireChecklistRow[];
    },
  });
}

export function useNewHireTraining(hireId?: string | null) {
  return useQuery({
    queryKey: ["new-hire-training", hireId],
    enabled: !!hireId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("new_hire_training")
        .select("*")
        .eq("new_hire_id", hireId!)
        .order("assigned_at");
      if (error) throw error;
      return (data ?? []) as NewHireTrainingRow[];
    },
  });
}

export function useToggleHireChecklist() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      rowId,
      hireId,
      done,
    }: {
      rowId: string;
      hireId: string;
      done: boolean;
    }) => {
      const { error } = await supabase
        .from("new_hire_checklist")
        .update({
          done,
          done_by: done ? user?.id ?? null : null,
          done_at: done ? new Date().toISOString() : null,
        })
        .eq("id", rowId);
      if (error) throw error;
      void hireId;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["new-hire-checklist", v.hireId] });
      qc.invalidateQueries({ queryKey: ["new-hire", v.hireId] });
      qc.invalidateQueries({ queryKey: ["new-hires"] });
      qc.invalidateQueries({ queryKey: ["roster-blocked"] });
    },
  });
}

export function useToggleHireTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rowId,
      hireId,
      complete,
    }: {
      rowId: string;
      hireId: string;
      complete: boolean;
    }) => {
      const { error } = await supabase
        .from("new_hire_training")
        .update({
          status: complete ? "complete" : "assigned",
          completed_at: complete ? new Date().toISOString() : null,
        })
        .eq("id", rowId);
      if (error) throw error;
      void hireId;
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ["new-hire-training", v.hireId] }),
  });
}

/** Signed URL for a private certificate scan — links expire in ten minutes. */
export async function newHireDocUrl(path: string) {
  const { data, error } = await supabase.storage
    .from("new-hire-docs")
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

// ── Roster blocking ─────────────────────────────────────────────────────────

/**
 * Who cannot be rostered at this venue yet, and why. The roster builder shows
 * the reasons rather than just refusing; the same rule is enforced by a trigger
 * on shifts, so this is for explaining, not for gatekeeping.
 */
export function useRosterBlocked(restaurantId?: string | null) {
  return useQuery({
    queryKey: ["roster-blocked", restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("roster_blocked_at", {
        p_restaurant: restaurantId,
      });
      if (error) return [] as RosterBlockedEmployee[];
      return (data ?? []) as RosterBlockedEmployee[];
    },
  });
}

// ── Certificate compliance ──────────────────────────────────────────────────

export function useCertificateCompliance(restaurantIds?: string[]) {
  return useQuery({
    queryKey: ["certificate-compliance", restaurantIds ?? "all"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_certificate_compliance")
        .select("*")
        .order("expires_on");
      if (error) throw error;
      const rows = (data ?? []) as CertificateComplianceRow[];
      if (!restaurantIds?.length) return rows;
      return rows.filter((r) => r.restaurant_id && restaurantIds.includes(r.restaurant_id));
    },
  });
}

// ============================================================================
// THE HIRE'S SIDE  (token only — no session, no RLS reads)
// ============================================================================

export function useNewHireIntake(token?: string | null) {
  return useQuery({
    queryKey: ["new-hire-intake", token],
    enabled: !!token,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("new_hire_fetch", { p_token: token });
      if (error) throw error;
      return data as NewHireIntake;
    },
  });
}

export function useNewHireIntakeActions(token?: string | null) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["new-hire-intake", token] });

  const saveDetails = useMutation({
    mutationFn: async ({
      patch,
      step,
    }: {
      patch: Record<string, string | null>;
      step?: number;
    }) => {
      const { error } = await supabase.rpc("new_hire_save_details", {
        p_token: token,
        p_patch: patch,
        p_step: step ?? null,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const addCertificate = useMutation({
    mutationFn: async ({
      kind,
      label,
      file,
      issuedOn,
      expiresOn,
    }: {
      kind: string;
      label?: string;
      file?: File | null;
      issuedOn?: string | null;
      expiresOn?: string | null;
    }) => {
      let path: string | null = null;
      if (file) {
        // The storage policy checks that the first path segment is an open
        // invite token, so the path shape matters.
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        path = `${token}/${kind}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("new-hire-docs")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
      }
      const { error } = await supabase.rpc("new_hire_add_certificate", {
        p_token: token,
        p_kind: kind,
        p_label: label || null,
        p_file_path: path,
        p_issued_on: issuedOn || null,
        p_expires_on: expiresOn || null,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const removeCertificate = useMutation({
    mutationFn: async (certId: string) => {
      const { error } = await supabase.rpc("new_hire_remove_certificate", {
        p_token: token,
        p_cert_id: certId,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const signPolicy = useMutation({
    mutationFn: async ({ documentId, typedName }: { documentId: string; typedName: string }) => {
      const { error } = await supabase.rpc("new_hire_sign_policy", {
        p_token: token,
        p_document_id: documentId,
        p_typed_name: typedName,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const confirmPayroll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("new_hire_confirm_payroll", { p_token: token });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("new_hire_submit", { p_token: token });
      if (error) throw error;
      return data as { ok: boolean; missing?: string[] };
    },
    onSuccess: refresh,
  });

  return {
    saveDetails,
    addCertificate,
    removeCertificate,
    signPolicy,
    confirmPayroll,
    submit,
  };
}
