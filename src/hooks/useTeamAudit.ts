import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { TeamAuditEntry } from "@/types";

/**
 * The Team modules' audit trail. Read-only everywhere — the table has no
 * insert policy, so entries only ever arrive via public.team_audit().
 */
export function useTeamAudit(opts?: {
  module?: TeamAuditEntry["module"];
  subjectId?: string | null;
  limit?: number;
}) {
  const { module, subjectId, limit = 50 } = opts ?? {};
  return useQuery({
    queryKey: ["team-audit", module ?? "all", subjectId ?? "all", limit],
    retry: false,
    queryFn: async () => {
      let q = supabase
        .from("team_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (module) q = q.eq("module", module);
      if (subjectId) q = q.eq("subject_id", subjectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TeamAuditEntry[];
    },
  });
}

/** "status_changed" → "Status changed". */
export function auditActionLabel(action: string): string {
  return action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
