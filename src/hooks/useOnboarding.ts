import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type {
  EmployeeOnboarding,
  EmployeeSensitive,
  EmployeeDocument,
  Profile,
  CompanySettings,
} from "@/types";

export type OnboardingRow = EmployeeOnboarding & {
  employee?: Pick<
    Profile,
    | "id"
    | "full_name"
    | "role"
    | "home_restaurant_id"
    | "employment_type"
    | "is_rosterable"
    | "start_date"
    | "contact_email"
    | "phone"
  > | null;
};

const SELECT_WITH_EMPLOYEE = `
  *,
  employee:profiles!employee_onboarding_employee_id_fkey (
    id, full_name, role, home_restaurant_id, employment_type, is_rosterable,
    start_date, contact_email, phone
  )
`;

/** The signed-in person's own onboarding record — drives the gate. */
export function useMyOnboarding() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["onboarding", "me", user?.id],
    enabled: !!user?.id,
    // The gate reads this on every navigation; keep it warm but not stale forever.
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_onboarding")
        .select("*")
        .eq("employee_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as EmployeeOnboarding | null;
    },
  });
}

/** Everyone's onboarding state (admin pipeline). */
export function useOnboardingList() {
  return useQuery({
    queryKey: ["onboarding", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_onboarding")
        .select(SELECT_WITH_EMPLOYEE);
      if (error) throw error;
      const rows = (data ?? []) as OnboardingRow[];
      return rows.sort((a, b) =>
        (a.employee?.full_name ?? "").localeCompare(b.employee?.full_name ?? "")
      );
    },
  });
}

export function useOnboardingActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["onboarding"] });
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  /** Start (or restart) onboarding for one or more people. */
  const request = useMutation({
    mutationFn: async ({
      employeeIds,
      collectDetails,
      issueContract,
    }: {
      employeeIds: string[];
      collectDetails: boolean;
      issueContract: boolean;
    }) => {
      const rows = employeeIds.map((id) => ({
        employee_id: id,
        status: "pending",
        collect_details: collectDetails,
        issue_contract: issueContract,
        requested_by: user?.id ?? null,
        requested_at: new Date().toISOString(),
        current_step: 1,
        completed_at: null,
      }));
      const { error } = await supabase
        .from("employee_onboarding")
        .upsert(rows, { onConflict: "employee_id" });
      if (error) throw error;
      // Recompute flags now so anyone who already has details lands as complete.
      await Promise.all(
        employeeIds.map((id) => supabase.rpc("onboarding_recalc", { target: id }))
      );
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({
      employeeId,
      patch,
    }: {
      employeeId: string;
      patch: Partial<EmployeeOnboarding>;
    }) => {
      const { error } = await supabase
        .from("employee_onboarding")
        .update(patch)
        .eq("employee_id", employeeId);
      if (error) throw error;
      await supabase.rpc("onboarding_recalc", { target: employeeId });
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (employeeId: string) => {
      const { error } = await supabase
        .from("employee_onboarding")
        .delete()
        .eq("employee_id", employeeId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { request, update, remove };
}

/** Advance the wizard's remembered step (employee-side, via RPC). */
export function useTouchStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (step: number) => {
      const { error } = await supabase.rpc("onboarding_touch_step", { p_step: step });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding", "me"] }),
  });
}

// ── Sensitive (tax / super / bank) ──────────────────────────────────────────
// RLS restricts this to the employee themselves and superadmin. Never select it
// into a list view — one row at a time, on an explicit open.

export function useEmployeeSensitive(employeeId?: string | null) {
  return useQuery({
    queryKey: ["employee-sensitive", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_sensitive")
        .select("*")
        .eq("employee_id", employeeId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as EmployeeSensitive | null;
    },
  });
}

export function useSaveSensitive() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      employeeId,
      patch,
    }: {
      employeeId: string;
      patch: Partial<EmployeeSensitive>;
    }) => {
      const { error } = await supabase
        .from("employee_sensitive")
        .upsert(
          { employee_id: employeeId, ...patch, updated_by: user?.id ?? null },
          { onConflict: "employee_id" }
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["employee-sensitive", vars.employeeId] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
}

// ── Documents (RSA / food handler / visa) ───────────────────────────────────

export function useEmployeeDocuments(employeeId?: string | null) {
  return useQuery({
    queryKey: ["employee-documents", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_documents")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmployeeDocument[];
    },
  });
}

export function useDocumentActions() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const invalidate = (employeeId: string) =>
    qc.invalidateQueries({ queryKey: ["employee-documents", employeeId] });

  const upload = useMutation({
    mutationFn: async ({
      employeeId,
      file,
      kind,
      label,
      issuedOn,
      expiresOn,
    }: {
      employeeId: string;
      file: File | null;
      kind: EmployeeDocument["kind"];
      label?: string;
      issuedOn?: string | null;
      expiresOn?: string | null;
    }) => {
      let path: string | null = null;
      if (file) {
        // Path must start with the employee id — the storage policy checks it.
        const ext = file.name.split(".").pop() ?? "bin";
        path = `${employeeId}/${kind}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("employee-docs")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
      }
      const { error } = await supabase.from("employee_documents").insert({
        employee_id: employeeId,
        kind,
        label: label || null,
        file_path: path,
        issued_on: issuedOn || null,
        expires_on: expiresOn || null,
        uploaded_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => invalidate(vars.employeeId),
  });

  const remove = useMutation({
    mutationFn: async (doc: EmployeeDocument) => {
      if (doc.file_path) {
        await supabase.storage.from("employee-docs").remove([doc.file_path]);
      }
      const { error } = await supabase.from("employee_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: (_d, doc) => invalidate(doc.employee_id),
  });

  /** Private bucket — links must be signed. */
  const signedUrl = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("employee-docs")
      .createSignedUrl(path, 60 * 10);
    if (error) throw error;
    return data.signedUrl;
  };

  return { upload, remove, signedUrl };
}

// ── Company settings (contract tokens + employer signature) ─────────────────

const EMPTY_COMPANY: CompanySettings = {
  legal_name: "",
  trading_name: "",
  abn: "",
  address: "",
  signatory_name: "",
  signatory_title: "",
  signature_image: "",
};

export function useCompanySettings() {
  return useQuery({
    queryKey: ["app-settings", "company"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "company")
        .maybeSingle();
      if (error) throw error;
      return { ...EMPTY_COMPANY, ...((data?.value ?? {}) as Partial<CompanySettings>) };
    },
  });
}

export function useSaveCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: CompanySettings) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "company", value }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings", "company"] }),
  });
}

// ── Induction checklist ─────────────────────────────────────────────────────

export function useChecklistItems() {
  return useQuery({
    queryKey: ["onboarding-checklist-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_checklist_items")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as import("@/types").OnboardingChecklistItem[];
    },
  });
}

export function useEmployeeChecklist(employeeId?: string | null) {
  return useQuery({
    queryKey: ["employee-checklist", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_checklist")
        .select("*")
        .eq("employee_id", employeeId!);
      if (error) throw error;
      return (data ?? []) as import("@/types").EmployeeChecklistRow[];
    },
  });
}

export function useToggleChecklist() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      employeeId,
      itemId,
      done,
    }: {
      employeeId: string;
      itemId: string;
      done: boolean;
    }) => {
      const { error } = await supabase.from("employee_checklist").upsert(
        {
          employee_id: employeeId,
          item_id: itemId,
          done,
          done_by: done ? user?.id ?? null : null,
          done_at: done ? new Date().toISOString() : null,
        },
        { onConflict: "employee_id,item_id" }
      );
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["employee-checklist", vars.employeeId] }),
  });
}

/** One profile row by id (admin drawer). */
export function useEmployeeProfile(employeeId?: string | null) {
  return useQuery({
    queryKey: ["employee-profile", employeeId],
    enabled: !!employeeId,
    // The app-wide default is a 5-minute staleTime. That is wrong here: change
    // the award level in Team → Payroll, open the drawer, and you would be
    // looking at the old value while the contract check said "pay rate missing".
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", employeeId!)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

export function useSaveEmployeeProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, patch }: { employeeId: string; patch: Partial<Profile> }) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["employee-profile", vars.employeeId] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      // Employment terms are editable here now — Team → Payroll shows the same
      // columns and must not keep serving a stale copy.
      qc.invalidateQueries({ queryKey: ["payroll-members"] });
    },
  });
}

// ── Profile change approvals (tier-2 fields) ────────────────────────────────

export type ChangeRequestRow = import("@/types").ProfileChangeRequest & {
  employee?: Pick<Profile, "id" | "full_name"> | null;
};

export function usePendingChangeRequests() {
  return useQuery({
    queryKey: ["profile-change-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_change_requests")
        .select(`*, employee:profiles!profile_change_requests_employee_id_fkey (id, full_name)`)
        .eq("status", "pending")
        .order("requested_at");
      if (error) throw error;
      return (data ?? []) as ChangeRequestRow[];
    },
  });
}

export function useReviewChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id, approve, note,
    }: { id: string; approve: boolean; note?: string }) => {
      const { error } = await supabase.rpc("review_profile_change", {
        p_request_id: id,
        p_approve: approve,
        p_note: note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-change-requests"] });
      qc.invalidateQueries({ queryKey: ["employee-sensitive"] });
      qc.invalidateQueries({ queryKey: ["employee-profile"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
