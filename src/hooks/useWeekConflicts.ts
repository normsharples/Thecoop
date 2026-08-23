import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { weekDates, toISODate, dayOfWeekMon0, timeToMinutes } from "@/lib/roster";
import type { AvailabilityRule, AvailabilityException, LeaveRequest } from "@/types";

export type Conflict = "leave" | "unavailable" | null;
export type ConflictFn = (
  employeeId: string | null,
  dateISO: string,
  shiftStart?: string,
  shiftEnd?: string
) => Conflict;

// Whole-day status for showing availability directly on the builder cells.
export type DayStatus =
  | { kind: "leave" }
  | { kind: "unavailable" }
  | { kind: "partial"; start: string; end: string }
  | null;
export type DayStatusFn = (employeeId: string | null, dateISO: string) => DayStatus;

/**
 * For a Monday-start week, resolves whether an employee is unavailable or on
 * approved leave on a given date — used to warn managers in the builder.
 * Roster managers can read everyone's availability/leave via RLS.
 */
export function useWeekConflicts(weekStartISO: string, enabled = true) {
  const days = weekDates(weekStartISO);
  const from = days[0];
  const to = days[6];

  const { data: rules = [] } = useQuery({
    queryKey: ["conflict-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("availability_rules").select("*");
      if (error) throw error;
      return data as AvailabilityRule[];
    },
    enabled,
  });

  const { data: exceptions = [] } = useQuery({
    queryKey: ["conflict-exceptions", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_exceptions")
        .select("*")
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;
      return data as AvailabilityException[];
    },
    enabled,
  });

  const { data: leave = [] } = useQuery({
    queryKey: ["conflict-leave", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("status", "approved")
        .lte("start_date", to)
        .gte("end_date", from);
      if (error) throw error;
      return data as LeaveRequest[];
    },
    enabled,
  });

  return useMemo(() => {
    const exMap = new Map<string, AvailabilityException>();
    for (const e of exceptions) exMap.set(`${e.employee_id}|${e.date}`, e);
    const ruleMap = new Map<string, AvailabilityRule>();
    for (const r of rules) ruleMap.set(`${r.employee_id}|${r.day_of_week}`, r);
    const leaveMap = new Map<string, Set<string>>();
    for (const l of leave) {
      let d = parseISO(l.start_date);
      const end = parseISO(l.end_date);
      const set = leaveMap.get(l.employee_id) ?? new Set<string>();
      while (d <= end) {
        set.add(toISODate(d));
        d = addDays(d, 1);
      }
      leaveMap.set(l.employee_id, set);
    }

    // Is the shift outside an "available only within" window?
    const outsideWindow = (
      start: string | null,
      end: string | null,
      shiftStart?: string,
      shiftEnd?: string
    ): boolean => {
      if (!start || !end || !shiftStart) return false; // no window / can't tell → assume OK
      const ws = timeToMinutes(start);
      const we = timeToMinutes(end);
      const ss = timeToMinutes(shiftStart);
      const se = shiftEnd ? timeToMinutes(shiftEnd) : ss;
      if (ss < ws) return true; // starts before their available window
      if (shiftEnd && se > ss && se > we) return true; // ends after (same-day shift)
      return false;
    };

    const conflictFor: ConflictFn = (employeeId, dateISO, shiftStart, shiftEnd) => {
      if (!employeeId) return null;
      if (leaveMap.get(employeeId)?.has(dateISO)) return "leave";

      const ex = exMap.get(`${employeeId}|${dateISO}`);
      if (ex) {
        if (!ex.is_available) return "unavailable";
        return outsideWindow(ex.start_time, ex.end_time, shiftStart, shiftEnd) ? "unavailable" : null;
      }

      const dow = dayOfWeekMon0(dateISO);
      const rule = ruleMap.get(`${employeeId}|${dow}`);
      if (!rule) return null;
      // Respect the rule's effective date range.
      if (rule.effective_from && dateISO < rule.effective_from) return null;
      if (rule.effective_until && dateISO > rule.effective_until) return null;
      if (!rule.is_available) return "unavailable";
      return outsideWindow(rule.start_time, rule.end_time, shiftStart, shiftEnd) ? "unavailable" : null;
    };

    const dayStatusFor: DayStatusFn = (employeeId, dateISO) => {
      if (!employeeId) return null;
      if (leaveMap.get(employeeId)?.has(dateISO)) return { kind: "leave" };
      const ex = exMap.get(`${employeeId}|${dateISO}`);
      if (ex) {
        if (!ex.is_available) return { kind: "unavailable" };
        if (ex.start_time && ex.end_time)
          return { kind: "partial", start: ex.start_time, end: ex.end_time };
        return null;
      }
      const dow = dayOfWeekMon0(dateISO);
      const rule = ruleMap.get(`${employeeId}|${dow}`);
      if (!rule) return null;
      if (rule.effective_from && dateISO < rule.effective_from) return null;
      if (rule.effective_until && dateISO > rule.effective_until) return null;
      if (!rule.is_available) return { kind: "unavailable" };
      if (rule.start_time && rule.end_time)
        return { kind: "partial", start: rule.start_time, end: rule.end_time };
      return null;
    };

    return { conflictFor, dayStatusFor };
  }, [rules, exceptions, leave]);
}
