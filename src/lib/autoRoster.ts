import type { Shift, Profile, StationTraining, ProficiencyLevel } from "@/types";
import type { ConflictFn } from "@/hooks/useWeekConflicts";

// Higher = more proficient. Auto-build prefers advanced, then intermediate,
// then basic.
const LEVEL_RANK: Record<ProficiencyLevel, number> = {
  advanced: 3,
  intermediate: 2,
  basic: 1,
};

export interface AutoAssignInput {
  /** Every shift slot in the week (their times + positions define the demand). */
  shifts: Shift[];
  /** Rosterable team members that could be assigned. */
  employees: Profile[];
  /** All station-training rows (who is trained on what, and how well). */
  training: StationTraining[];
  /** Availability/leave checker for the week (from useWeekConflicts). */
  conflictFor: ConflictFn;
  /** The venue being built — used to prefer its home-store staff on ties. */
  venueId: string;
}

export interface AutoAssignResult {
  /** One entry per input shift. employeeId null = left open (nobody eligible). */
  assignments: { shiftId: string; employeeId: string | null }[];
  filled: number;
  leftOpen: number;
}

// "HH:MM" / "HH:MM:SS" → minutes since midnight.
function toMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

// A shift's [start, end) in minutes, with end pushed past midnight for overnight
// shifts so overlap maths stays correct.
function interval(s: Shift): { start: number; end: number } {
  const start = toMin(s.start_time);
  let end = toMin(s.end_time);
  if (end <= start) end += 1440;
  return { start, end };
}

// Paid minutes of a shift (used only to spread hours on ties).
function paidMinutes(s: Shift): number {
  const { start, end } = interval(s);
  return Math.max(0, end - start - (s.unpaid_break_minutes || 0));
}

/**
 * Fill the OPEN (unassigned) shift slots for a week, leaving any shift that
 * already has someone on it untouched.
 *
 * A person is eligible for a shift only when they are (a) trained on that
 * shift's station/position, and (b) available (not on leave, not marked
 * unavailable, and within any part-day availability window). Among eligible
 * people, the most proficient wins (advanced → intermediate → basic); ties go
 * to home-store staff first, then to whoever has the fewest hours so far this
 * week (to spread the load), then alphabetically. If nobody is eligible the
 * slot is left open.
 *
 * A shift with no position is treated as having no training requirement — any
 * available person may take it (proficiency rank 0 for everyone).
 *
 * Pure and deterministic. Already-assigned shifts are treated as fixed: their
 * people are pre-booked (so we never double-book them into an overlapping open
 * shift) and their hours count toward the load-spreading tiebreak. Only the
 * open shifts appear in the returned assignments; processing them in
 * chronological order lets earlier ones claim the scarcest skilled people.
 */
export function autoAssignWeek(input: AutoAssignInput): AutoAssignResult {
  const { shifts, employees, training, conflictFor, venueId } = input;

  // (employee_id|position_id) → level, for O(1) training lookups.
  const trainMap = new Map<string, ProficiencyLevel>();
  for (const t of training) trainMap.set(`${t.employee_id}|${t.position_id}`, t.level);

  // Running per-employee state built up as we assign.
  const busy = new Map<string, { start: number; end: number }[]>(); // by date-key below
  const minutesByEmp = new Map<string, number>();
  const busyKey = (empId: string, date: string) => `${empId}|${date}`;

  // Seed the busy map + hours from shifts that are ALREADY assigned — these stay
  // put, but block their person from an overlapping open shift and count toward
  // the fewest-hours tiebreak.
  for (const s of shifts) {
    if (!s.employee_id) continue;
    const key = busyKey(s.employee_id, s.date);
    const list = busy.get(key) ?? [];
    list.push(interval(s));
    busy.set(key, list);
    minutesByEmp.set(
      s.employee_id,
      (minutesByEmp.get(s.employee_id) ?? 0) + paidMinutes(s)
    );
  }

  // Only the open (unassigned) shifts get filled. Deterministic processing
  // order: chronological, then a stable id tiebreak.
  const ordered = shifts.filter((s) => !s.employee_id).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.start_time !== b.start_time) return a.start_time < b.start_time ? -1 : 1;
    if (a.end_time !== b.end_time) return a.end_time < b.end_time ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const assignments: { shiftId: string; employeeId: string | null }[] = [];
  let filled = 0;

  for (const shift of ordered) {
    const posId = shift.position_id;
    const iv = interval(shift);

    const levelOf = (empId: string): ProficiencyLevel | null =>
      posId ? trainMap.get(`${empId}|${posId}`) ?? null : null;

    const eligible = employees.filter((emp) => {
      // Trained on this station (skipped when the shift has no position).
      if (posId && !levelOf(emp.id)) return false;
      // Available that day / within any availability window.
      if (conflictFor(emp.id, shift.date, shift.start_time, shift.end_time) !== null)
        return false;
      // Not already on an overlapping shift the same day.
      const existing = busy.get(busyKey(emp.id, shift.date)) ?? [];
      if (existing.some((e) => iv.start < e.end && e.start < iv.end)) return false;
      return true;
    });

    eligible.sort((a, b) => {
      // 1. Proficiency (advanced first). No-position shifts → everyone rank 0.
      const la = posId ? LEVEL_RANK[levelOf(a.id)!] : 0;
      const lb = posId ? LEVEL_RANK[levelOf(b.id)!] : 0;
      if (la !== lb) return lb - la;
      // 2. Home-store staff first.
      const ha = a.home_restaurant_id === venueId ? 0 : 1;
      const hb = b.home_restaurant_id === venueId ? 0 : 1;
      if (ha !== hb) return ha - hb;
      // 3. Fewest hours assigned so far (spread the load).
      const ma = minutesByEmp.get(a.id) ?? 0;
      const mb = minutesByEmp.get(b.id) ?? 0;
      if (ma !== mb) return ma - mb;
      // 4. Stable alphabetical fallback.
      return a.full_name.localeCompare(b.full_name);
    });

    const chosen = eligible[0] ?? null;
    if (chosen) {
      const key = busyKey(chosen.id, shift.date);
      const list = busy.get(key) ?? [];
      list.push(iv);
      busy.set(key, list);
      minutesByEmp.set(chosen.id, (minutesByEmp.get(chosen.id) ?? 0) + paidMinutes(shift));
      filled++;
    }
    assignments.push({ shiftId: shift.id, employeeId: chosen ? chosen.id : null });
  }

  return { assignments, filled, leftOpen: assignments.length - filled };
}
