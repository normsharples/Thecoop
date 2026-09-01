import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { weekDates } from "@/lib/roster";
import type { TimeEntry, TimesheetLeaveType } from "@/types";

export type TimesheetRow = TimeEntry & {
  employee?: {
    full_name: string;
    display_colour: string | null;
    date_of_birth: string | null;
    employment_type: string | null;
    pay_type: string | null;
    award_level: string | null;
    base_pay_rate: number | null;
    salary_annual: number | null;
  } | null;
};

const SELECT =
  "*, employee:profiles!time_entries_employee_id_fkey(full_name, display_colour, date_of_birth, employment_type, pay_type, award_level, base_pay_rate, salary_annual)";

/** Manager view of punched time for a set of stores across one week. */
export function useTimesheets(restaurantIds: string[], weekStartISO: string) {
  const qc = useQueryClient();
  const days = weekDates(weekStartISO);
  const from = days[0];
  const to = days[days.length - 1];
  const enabled = restaurantIds.length > 0;

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["timesheets", restaurantIds, weekStartISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select(SELECT)
        .in("restaurant_id", restaurantIds)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date")
        .order("clock_in");
      if (error) throw error;
      return (data ?? []) as unknown as TimesheetRow[];
    },
    enabled,
  });

  const invalidate = () =>
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]) === "timesheets" });

  // Edit raw punch times (re-runs the finalize trigger for a fresh verdict).
  const update = useMutation({
    mutationFn: async (p: { id: string; patch: Partial<TimeEntry> }) => {
      const { error } = await supabase.from("time_entries").update(p.patch).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const review = useMutation({
    mutationFn: async (p: { id: string; approve: boolean }) => {
      const { data: userData } = await supabase.auth.getUser();
      const reviewer = userData?.user?.id ?? null;
      const { error } = await supabase
        .from("time_entries")
        .update({
          approval_status: p.approve ? "approved" : "rejected",
          approved_by: reviewer,
          approved_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Leave is written through an RPC: it also creates/links the approved
  // leave_requests row, which RLS on a plain client insert wouldn't cover.
  const setLeave = useMutation({
    mutationFn: async (p: { id: string; leaveType: TimesheetLeaveType | null }) => {
      const { error } = await supabase.rpc("set_timesheet_leave", {
        p_entry_id: p.id,
        p_leave_type: p.leaveType,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: async (p: {
      restaurant_id: string;
      employee_id: string;
      work_date: string;
      clock_in: string;
      clock_out: string;
      break_start?: string | null;
      break_end?: string | null;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("time_entries").insert({
        ...p,
        source: "manual",
        created_by: userData?.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    entries,
    isLoading,
    update: update.mutateAsync,
    review: review.mutateAsync,
    setLeave: setLeave.mutateAsync,
    create: create.mutateAsync,
  };
}
