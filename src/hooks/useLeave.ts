import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { LeaveRequest, LeaveType } from "@/types";

/**
 * Who a leave request can be sent to. Team members can't read other profiles
 * (042 RLS), so this comes from a SECURITY DEFINER function that returns only
 * superadmin ids and names.
 */
export function useLeaveApprovers() {
  return useQuery({
    queryKey: ["leave-approvers"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_leave_approvers");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string }[];
    },
  });
}

/** A team member's own leave requests (list + create + cancel while pending). */
export function useMyLeave(employeeId?: string) {
  const qc = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-leave", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data as LeaveRequest[];
    },
    enabled: !!employeeId,
  });

  const create = useMutation({
    mutationFn: async (p: {
      start_date: string;
      end_date: string;
      leave_type: LeaveType;
      note?: string | null;
      notify_user_id: string;
    }) => {
      const { error } = await supabase.from("leave_requests").insert({
        employee_id: employeeId,
        start_date: p.start_date,
        end_date: p.end_date,
        leave_type: p.leave_type,
        note: p.note ?? null,
        // A DB trigger notifies this person on insert.
        notify_user_id: p.notify_user_id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-leave"] }),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leave_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-leave"] }),
  });

  return { requests, isLoading, create: create.mutateAsync, cancel: cancel.mutateAsync };
}

/** Manager view: all leave requests with member names, approve / decline. */
export function useLeaveApprovals() {
  const qc = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["leave-approvals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*, employee:profiles!leave_requests_employee_id_fkey(full_name), notify_user:profiles!leave_requests_notify_user_id_fkey(full_name)")
        .order("status")
        .order("start_date");
      if (error) throw error;
      return data as unknown as (LeaveRequest & {
        employee?: { full_name: string } | null;
        notify_user?: { full_name: string } | null;
      })[];
    },
  });

  const review = useMutation({
    mutationFn: async (p: { id: string; status: "approved" | "declined" }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("leave_requests")
        .update({
          status: p.status,
          reviewed_by: userData?.user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-approvals"] }),
  });

  return { requests, isLoading, review: review.mutateAsync };
}
