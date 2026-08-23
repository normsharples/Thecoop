import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AvailabilityRule, AvailabilityException } from "@/types";

/**
 * A team member's recurring weekly availability + one-off date exceptions.
 * RLS lets a user manage their own; roster managers may read everyone's.
 */
export function useAvailability(employeeId?: string) {
  const qc = useQueryClient();

  const { data: rules = [] } = useQuery({
    queryKey: ["availability-rules", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_rules")
        .select("*")
        .eq("employee_id", employeeId!);
      if (error) throw error;
      return data as AvailabilityRule[];
    },
    enabled: !!employeeId,
  });

  const { data: exceptions = [] } = useQuery({
    queryKey: ["availability-exceptions", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_exceptions")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("date");
      if (error) throw error;
      return data as AvailabilityException[];
    },
    enabled: !!employeeId,
  });

  const setRule = useMutation({
    mutationFn: async (p: {
      day_of_week: number;
      is_available: boolean;
      start_time?: string | null;
      end_time?: string | null;
      effective_from?: string | null;
      effective_until?: string | null;
    }) => {
      const { error } = await supabase.from("availability_rules").upsert(
        {
          employee_id: employeeId,
          day_of_week: p.day_of_week,
          is_available: p.is_available,
          start_time: p.start_time ?? null,
          end_time: p.end_time ?? null,
          effective_from: p.effective_from ?? null,
          effective_until: p.effective_until ?? null,
        },
        { onConflict: "employee_id,day_of_week" }
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability-rules"] }),
  });

  const addException = useMutation({
    mutationFn: async (p: { date: string; is_available: boolean; reason?: string | null }) => {
      const { error } = await supabase.from("availability_exceptions").upsert(
        {
          employee_id: employeeId,
          date: p.date,
          is_available: p.is_available,
          reason: p.reason ?? null,
        },
        { onConflict: "employee_id,date" }
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability-exceptions"] }),
  });

  const removeException = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("availability_exceptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability-exceptions"] }),
  });

  return {
    rules,
    exceptions,
    setRule: setRule.mutateAsync,
    addException: addException.mutateAsync,
    removeException: removeException.mutateAsync,
  };
}
