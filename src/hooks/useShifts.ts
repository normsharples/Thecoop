import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { toISODate, weekDates } from "@/lib/roster";
import type { Shift } from "@/types";

export interface ShiftInput {
  id?: string;
  restaurant_id: string;
  employee_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  break_start?: string | null;
  position_id: string | null;
  note: string | null;
}

/**
 * Shifts for one store across one Monday-start week. Includes create / update /
 * delete and a copy-from-another-week helper for the builder.
 */
export function useShifts(restaurantId: string | null, weekStartISO: string) {
  const queryClient = useQueryClient();
  const days = weekDates(weekStartISO);
  const from = days[0];
  const to = days[6];

  const key = ["shifts", restaurantId, weekStartISO];

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .order("start_time");
      if (error) throw error;
      return data as Shift[];
    },
    enabled: !!restaurantId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["shifts"] });

  const save = useMutation({
    mutationFn: async (input: ShiftInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const row = {
        ...(input.id ? { id: input.id } : {}),
        restaurant_id: input.restaurant_id,
        employee_id: input.employee_id,
        date: input.date,
        start_time: input.start_time,
        end_time: input.end_time,
        unpaid_break_minutes: input.unpaid_break_minutes,
        break_start: input.break_start ?? null,
        position_id: input.position_id,
        note: input.note,
        ...(input.id ? {} : { created_by: userData?.user?.id ?? null }),
      };
      const { error } = await supabase.from("shifts").upsert(row);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Delete all OPEN (unassigned) shifts in the week — used by "Build from
  // sales" before regenerating the skeleton, so assigned shifts are preserved.
  const deleteOpenWeek = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("No store selected");
      const { error } = await supabase
        .from("shifts")
        .delete()
        .eq("restaurant_id", restaurantId)
        .gte("date", from)
        .lte("date", to)
        .is("employee_id", null);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Delete every shift in the week (assigned or open) — "Delete all shifts".
  const deleteAllWeek = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("No store selected");
      const { error } = await supabase
        .from("shifts")
        .delete()
        .eq("restaurant_id", restaurantId)
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Insert many shifts at once (used by "Build from sales").
  const bulkInsert = useMutation({
    mutationFn: async (rows: ShiftInput[]) => {
      if (!rows.length) return 0;
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id ?? null;
      const payload = rows.map((r) => ({
        restaurant_id: r.restaurant_id,
        employee_id: r.employee_id,
        date: r.date,
        start_time: r.start_time,
        end_time: r.end_time,
        unpaid_break_minutes: r.unpaid_break_minutes,
        break_start: r.break_start ?? null,
        position_id: r.position_id,
        note: r.note,
        created_by: uid,
      }));
      const { error } = await supabase.from("shifts").insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: invalidate,
  });

  // Bulk-set the assigned employee on many existing shifts at once (used by the
  // roster Auto-build). Only touches employee_id — every other field is left
  // as-is. employee_id may be null to clear a slot back to an open shift.
  const bulkAssign = useMutation({
    mutationFn: async (rows: { id: string; employee_id: string | null }[]) => {
      for (const r of rows) {
        const { error } = await supabase
          .from("shifts")
          .update({ employee_id: r.employee_id })
          .eq("id", r.id);
        if (error) throw error;
      }
      return rows.length;
    },
    onSuccess: invalidate,
  });

  const copyFromWeek = useMutation({
    mutationFn: async (sourceWeekISO: string) => {
      if (!restaurantId) throw new Error("No store selected");
      const srcDays = weekDates(sourceWeekISO);
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("date", srcDays[0])
        .lte("date", srcDays[6]);
      if (error) throw error;
      const src = (data as Shift[]) ?? [];
      if (!src.length) return 0;

      const offset = differenceInCalendarDays(
        parseISO(weekStartISO),
        parseISO(sourceWeekISO)
      );
      const { data: userData } = await supabase.auth.getUser();
      const rows = src.map((s) => ({
        restaurant_id: s.restaurant_id,
        employee_id: s.employee_id,
        date: toISODate(addDays(parseISO(s.date), offset)),
        start_time: s.start_time,
        end_time: s.end_time,
        unpaid_break_minutes: s.unpaid_break_minutes,
        break_start: s.break_start ?? null,
        position_id: s.position_id,
        note: s.note,
        created_by: userData?.user?.id ?? null,
      }));
      const { error: insErr } = await supabase.from("shifts").insert(rows);
      if (insErr) throw insErr;
      return rows.length;
    },
    onSuccess: invalidate,
  });

  return {
    shifts,
    isLoading,
    save: save.mutateAsync,
    isSaving: save.isPending,
    remove: remove.mutateAsync,
    copyFromWeek: copyFromWeek.mutateAsync,
    isCopying: copyFromWeek.isPending,
    bulkAssign: bulkAssign.mutateAsync,
    isAutoBuilding: bulkAssign.isPending,
    deleteOpenWeek: deleteOpenWeek.mutateAsync,
    bulkInsert: bulkInsert.mutateAsync,
    isGenerating: deleteOpenWeek.isPending || bulkInsert.isPending,
    deleteAllWeek: deleteAllWeek.mutateAsync,
    isDeletingAll: deleteAllWeek.isPending,
  };
}
