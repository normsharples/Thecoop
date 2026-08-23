import { startOfWeek, addDays, format, parseISO } from "date-fns";

// ── Week helpers (Monday-start, matching roster_notes / roster_weeks) ──────────

/** Monday of the week containing `date`. */
export function mondayOf(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

/** ISO yyyy-MM-dd for a Date. */
export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** The Monday (as yyyy-MM-dd) of the week containing an ISO date string. */
export function weekStartOf(isoDate: string): string {
  return toISODate(mondayOf(parseISO(isoDate)));
}

/** The 7 dates (Mon…Sun) of a week given its Monday as yyyy-MM-dd. */
export function weekDates(weekStartISO: string): string[] {
  const monday = parseISO(weekStartISO);
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(monday, i)));
}

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** 0 = Monday … 6 = Sunday for an ISO date. */
export function dayOfWeekMon0(isoDate: string): number {
  // JS getDay: 0 = Sunday. Convert to Monday-0.
  const js = parseISO(isoDate).getDay();
  return (js + 6) % 7;
}

// ── Time helpers ───────────────────────────────────────────────────────────────

/** "HH:MM[:SS]" → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/** minutes since midnight → "HH:MM". */
export function minutesToTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Display a stored time value as "9:00 am" style. */
export function formatTime(t: string): string {
  const mins = timeToMinutes(t);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

/**
 * Paid hours for a shift. Handles shifts that finish after midnight
 * (end <= start ⇒ treated as the next day). Subtracts the unpaid break.
 */
export function shiftHours(
  startTime: string,
  endTime: string,
  unpaidBreakMinutes = 0
): number {
  let start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 1440; // overnight
  const worked = end - start - (unpaidBreakMinutes || 0);
  return Math.max(0, worked) / 60;
}

// ── Required-hours engine (same rule as the Roster dashboard) ──────────────────
// Required = max(projected_sales ÷ SPMH target, minimum roster hours).

export function requiredHours(
  projectedSales: number | null,
  spmhTarget: number | null,
  minHours: number | null
): number {
  const floor = minHours ?? 0;
  if (!spmhTarget || spmhTarget <= 0 || projectedSales == null) return floor;
  return Math.max(projectedSales / spmhTarget, floor);
}

/** Green ≤ required, amber ≤ +10%, red beyond. */
export function varianceColor(rostered: number, required: number): string {
  if (required <= 0) return "#94a3b8";
  if (rostered <= required) return "#22c55e";
  if (rostered <= required * 1.1) return "#eab308";
  return "#ef4444";
}
