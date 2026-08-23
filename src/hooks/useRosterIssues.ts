import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { weekDates } from "@/lib/roster";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePublicHolidays } from "@/hooks/useAward";
import { useRosterCheckConfig } from "@/hooks/useRosterChecks";
import {
  detectRosterIssues,
  paidHours,
  issuesByEmployee as groupByEmployee,
  issuesByShift as groupByShift,
  type ComplianceOptions,
  type RosterIssue,
} from "@/lib/rosterCompliance";
import type { Profile, Shift } from "@/types";

/**
 * Same-week shifts at every OTHER venue, for the people on this roster.
 *
 * Award limits (rest between shifts, weekly ordinary hours) apply per employee
 * per employer — not per site — so someone closing one venue and opening
 * another the next morning has to be visible from inside either roster.
 *
 * One week across a handful of venues is a few hundred rows, comfortably under
 * the 1000-row REST cap. Do not widen this range without aggregating first.
 */
function useOtherVenueShifts(
  restaurantId: string | null,
  weekStartISO: string,
  enabled: boolean
) {
  const days = weekDates(weekStartISO);
  return useQuery({
    queryKey: ["roster-other-venue-shifts", restaurantId, weekStartISO],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("shifts")
        .select("id,restaurant_id,employee_id,date,start_time,end_time,unpaid_break_minutes")
        .neq("restaurant_id", restaurantId)
        .not("employee_id", "is", null)
        .gte("date", days[0])
        .lte("date", days[6]);
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
    enabled: enabled && !!restaurantId,
  });
}

export interface RosterIssuesResult {
  issues: RosterIssue[];
  byShift: Map<string, RosterIssue[]>;
  byEmployee: Map<string, RosterIssue[]>;
  counts: { error: number; warning: number; info: number };
  /** Errors + warnings — what the toolbar badge counts. */
  actionable: number;
  /** Paid hours each person has at OTHER venues this week. */
  otherHoursByEmployee: Map<string, number>;
  /** The thresholds in force — so the grid bands hours the same way. */
  options: ComplianceOptions;
}

/**
 * Every compliance problem in the week being built: double-bookings across
 * venues, short rest breaks, missing meal breaks, over-long shifts, overtime,
 * under-18 hours, and public-holiday cost notes.
 */
export function useRosterIssues(
  restaurantId: string | null,
  weekStartISO: string,
  shifts: Shift[],
  employees: Profile[]
): RosterIssuesResult {
  const days = weekDates(weekStartISO);
  const { data: restaurants = [] } = useRestaurants();
  const { data: otherShifts = [] } = useOtherVenueShifts(
    restaurantId,
    weekStartISO,
    employees.length > 0
  );
  const { data: holidays = [] } = usePublicHolidays(days[0], days[6]);
  const { config } = useRosterCheckConfig();

  return useMemo(() => {
    const venueNameById = new Map(restaurants.map((r) => [r.id, r.name]));
    const state = restaurants.find((r) => r.id === restaurantId)?.state ?? null;
    const holidayNameByDate = new Map(
      holidays.filter((h) => !state || h.state === state).map((h) => [h.date, h.name])
    );

    const issues = detectRosterIssues({
      shifts,
      otherShifts,
      employees,
      venueNameById,
      holidayNameByDate,
      options: config.options,
      rules: config.rules,
    });

    const counts = { error: 0, warning: 0, info: 0 };
    for (const i of issues) counts[i.severity] += 1;

    const otherHoursByEmployee = new Map<string, number>();
    for (const s of otherShifts) {
      if (!s.employee_id) continue;
      otherHoursByEmployee.set(
        s.employee_id,
        (otherHoursByEmployee.get(s.employee_id) ?? 0) + paidHours(s)
      );
    }

    return {
      issues,
      byShift: groupByShift(issues),
      byEmployee: groupByEmployee(issues),
      counts,
      actionable: counts.error + counts.warning,
      otherHoursByEmployee,
      options: config.options,
    };
  }, [shifts, otherShifts, employees, restaurants, holidays, restaurantId, config]);
}
