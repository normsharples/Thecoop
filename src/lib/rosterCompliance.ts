import { differenceInYears, parseISO } from "date-fns";
import { timeToMinutes, shiftHours, formatTime } from "@/lib/roster";

/**
 * Roster compliance rules for the builder.
 *
 * Everything here is PURE — no React, no Supabase — so it can be unit-tested
 * and reused (builder, print, future roster QA report). The hook that feeds it
 * live data is `useRosterIssues`.
 *
 * Rules are MA000003 (Restaurant Industry Award) shaped, but every threshold is
 * an option so they can be tuned without touching the logic.
 */

export type IssueSeverity = "error" | "warning" | "info";

export type IssueCode =
  | "overlap" // two shifts at the same venue overlap
  | "double_booked" // overlapping shifts at DIFFERENT venues
  | "rest" // < minimum break between the end of one shift and the start of the next
  | "no_break" // long enough to need an unpaid meal break, but none rostered
  | "long_shift" // beyond the ordinary-hours daily limit
  | "over_weekly" // beyond the weekly ordinary-hours limit (overtime)
  | "over_contract" // a part-timer rostered past their contracted hours
  | "minor_late" // under-18 rostered outside the allowed window
  | "public_holiday"; // informational — penalty rates apply

export const ISSUE_CODES: IssueCode[] = [
  "overlap",
  "double_booked",
  "rest",
  "no_break",
  "long_shift",
  "over_weekly",
  "over_contract",
  "minor_late",
  "public_holiday",
];

export const ISSUE_LABELS: Record<IssueCode, string> = {
  overlap: "Overlapping shifts",
  double_booked: "Double-booked",
  rest: "Short rest break",
  no_break: "Missing meal break",
  long_shift: "Long shift",
  over_weekly: "Overtime",
  over_contract: "Over contracted hours",
  minor_late: "Under-18 hours",
  public_holiday: "Public holiday",
};

/** Plain-English description of each check, for the settings editor. */
export const ISSUE_DESCRIPTIONS: Record<IssueCode, string> = {
  overlap: "Someone is on two shifts at this venue that run over each other.",
  double_booked: "Someone is on at another venue at the same time.",
  rest: "Too little time off between the end of one shift and the start of the next.",
  no_break: "A shift long enough to need an unpaid meal break doesn't have one.",
  long_shift: "A single shift runs past the ordinary-hours limit.",
  over_weekly: "Someone's hours for the week pass the ordinary-hours limit.",
  over_contract: "A part-timer is rostered past their contracted hours.",
  minor_late: "Someone under 18 is rostered outside the allowed window.",
  public_holiday: "A shift falls on a public holiday, so penalty rates apply.",
};

/** Which thresholds each check reads — drives what the editor shows per rule. */
export const ISSUE_OPTION_KEYS: Partial<Record<IssueCode, (keyof ComplianceOptions)[]>> = {
  rest: ["restHours"],
  no_break: ["breakAfterHours", "minBreakMinutes"],
  long_shift: ["maxShiftHours"],
  over_weekly: ["weeklyHours"],
  minor_late: ["minorMorningStart", "minorNightEnd"],
};

export interface RosterIssue {
  code: IssueCode;
  severity: IssueSeverity;
  employeeId: string | null;
  employeeName: string;
  /** Anchor date — used to jump to the shift from the issues panel. */
  date: string;
  /** Shifts involved. Only ids belonging to the roster being built are listed. */
  shiftIds: string[];
  message: string;
}

/** The shape the rules need — matches `Shift`, and cross-venue rows too. */
export interface ComplianceShift {
  id: string;
  restaurant_id: string;
  employee_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
}

export interface ComplianceMember {
  id: string;
  full_name: string;
  date_of_birth?: string | null;
  employment_type?: "casual" | "part_time" | "full_time" | null;
  contracted_hours?: number | null;
}

export interface ComplianceOptions {
  /** Minimum hours off between the end of one shift and the start of the next. */
  restHours: number;
  /** A shift longer than this (gross) needs an unpaid meal break. */
  breakAfterHours: number;
  /** Minimum unpaid break minutes once past `breakAfterHours`. */
  minBreakMinutes: number;
  /** Paid hours in a single shift beyond which overtime applies. */
  maxShiftHours: number;
  /** Paid hours in the week beyond which overtime applies. */
  weeklyHours: number;
  /** Under-18s should not be rostered to finish after this time… */
  minorNightEnd: string;
  /** …nor start before this time. */
  minorMorningStart: string;
}

export const DEFAULT_COMPLIANCE: ComplianceOptions = {
  restHours: 10,
  breakAfterHours: 5,
  minBreakMinutes: 30,
  maxShiftHours: 11,
  weeklyHours: 38,
  minorNightEnd: "22:00",
  minorMorningStart: "06:00",
};

// ── Rule configuration (editable in Settings → Roster Checks) ─────────────────

export interface RuleSetting {
  enabled: boolean;
  severity: IssueSeverity;
}

export type RuleConfig = Record<IssueCode, RuleSetting>;

export const DEFAULT_RULES: RuleConfig = {
  overlap: { enabled: true, severity: "error" },
  double_booked: { enabled: true, severity: "error" },
  rest: { enabled: true, severity: "warning" },
  no_break: { enabled: true, severity: "warning" },
  long_shift: { enabled: true, severity: "warning" },
  over_weekly: { enabled: true, severity: "warning" },
  over_contract: { enabled: true, severity: "warning" },
  minor_late: { enabled: true, severity: "warning" },
  public_holiday: { enabled: true, severity: "info" },
};

export interface RosterCheckConfig {
  options: ComplianceOptions;
  rules: RuleConfig;
}

/**
 * Fold a stored config (possibly partial, or written by an older build) over a
 * set of defaults. Unknown keys are ignored and missing ones fall back, so a
 * new check added later is on by default rather than silently missing.
 */
export function mergeRosterCheckConfig(
  stored: unknown,
  defaults: RosterCheckConfig
): RosterCheckConfig {
  const src = (stored ?? {}) as Partial<RosterCheckConfig>;
  const options: ComplianceOptions = { ...defaults.options };
  const storedOptions = (src.options ?? {}) as Partial<ComplianceOptions>;
  for (const key of Object.keys(options) as (keyof ComplianceOptions)[]) {
    const v = storedOptions[key];
    if (typeof v === typeof options[key] && v !== undefined && v !== null) {
      // @ts-expect-error — key-wise assignment across a union of value types.
      options[key] = v;
    }
  }

  const rules = {} as RuleConfig;
  const storedRules = (src.rules ?? {}) as Partial<RuleConfig>;
  for (const code of ISSUE_CODES) {
    const base = defaults.rules[code] ?? DEFAULT_RULES[code];
    const got = storedRules[code];
    rules[code] = {
      enabled: typeof got?.enabled === "boolean" ? got.enabled : base.enabled,
      severity:
        got?.severity === "error" || got?.severity === "warning" || got?.severity === "info"
          ? got.severity
          : base.severity,
    };
  }
  return { options, rules };
}

// ── Absolute-time helpers ──────────────────────────────────────────────────────
// Shifts are stored as a date + wall-clock times, so comparing two shifts means
// projecting both onto one continuous minute axis. Overnight shifts (end <=
// start) roll into the following day.

const MINUTES_PER_DAY = 1440;

/** Days since the epoch for a yyyy-MM-dd string (timezone-independent). */
export function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

export interface Interval {
  start: number;
  end: number;
}

/** A shift's [start, end) on the absolute minute axis. */
export function shiftInterval(s: ComplianceShift): Interval {
  const base = dayNumber(s.date) * MINUTES_PER_DAY;
  const start = base + timeToMinutes(s.start_time);
  let end = base + timeToMinutes(s.end_time);
  if (end <= start) end += MINUTES_PER_DAY; // finishes after midnight
  return { start, end };
}

/** Paid hours of a shift (break deducted). */
export function paidHours(s: ComplianceShift): number {
  return shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes);
}

/** Gross (clock-in to clock-out) hours of a shift. */
export function grossHours(s: ComplianceShift): number {
  const { start, end } = shiftInterval(s);
  return (end - start) / 60;
}

/** Age in whole years on a given date, or null when the DOB is unknown. */
export function ageOn(dob: string | null | undefined, isoDate: string): number | null {
  if (!dob) return null;
  return differenceInYears(parseISO(isoDate), parseISO(dob));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const hoursText = (n: number) => `${round1(n)} h`;

// ── Weekly-hours banding (drives the Wkly hrs column colour) ───────────────────

export type HoursBand = "empty" | "under" | "ok" | "near" | "over";

/**
 * The hours ceiling that matters for one person: a part-timer's contracted
 * hours (anything past them is overtime under MA000003), otherwise the weekly
 * ordinary-hours limit.
 */
export function hoursCeiling(
  member: ComplianceMember,
  weeklyHours = DEFAULT_COMPLIANCE.weeklyHours
): number {
  const contracted = member.contracted_hours ?? 0;
  if (member.employment_type === "part_time" && contracted > 0) return contracted;
  if (member.employment_type === "full_time" && contracted > 0)
    return Math.min(contracted, weeklyHours);
  return weeklyHours;
}

/**
 * Where this week's hours sit against that ceiling:
 *   empty — nothing rostered
 *   under — a contracted person short of their hours (they are owed work)
 *   ok    — comfortably inside
 *   near  — within 10% of the ceiling
 *   over  — past it (overtime)
 */
export function weeklyHoursBand(
  hours: number,
  member: ComplianceMember,
  weeklyHours = DEFAULT_COMPLIANCE.weeklyHours
): HoursBand {
  if (hours <= 0) return "empty";
  const ceiling = hoursCeiling(member, weeklyHours);
  if (ceiling <= 0) return "ok";
  if (hours > ceiling + 0.01) return "over";
  if (hours >= ceiling * 0.9) return "near";
  const contracted = member.employment_type !== "casual" && (member.contracted_hours ?? 0) > 0;
  if (contracted && hours < ceiling * 0.9) return "under";
  return "ok";
}

/** Hex colours matching `varianceColor`'s palette, for the hours column. */
export function hoursBandColor(band: HoursBand): string {
  switch (band) {
    case "over":
      return "#ef4444";
    case "near":
      return "#eab308";
    case "under":
      return "#3b82f6";
    case "ok":
      return "#22c55e";
    default:
      return "#94a3b8";
  }
}

export function hoursBandTitle(
  band: HoursBand,
  hours: number,
  member: ComplianceMember,
  weeklyHours = DEFAULT_COMPLIANCE.weeklyHours
): string {
  const ceiling = hoursCeiling(member, weeklyHours);
  switch (band) {
    case "over":
      return `${hoursText(hours)} — ${hoursText(hours - ceiling)} over the ${hoursText(
        ceiling
      )} limit, overtime applies`;
    case "near":
      return `${hoursText(hours)} — close to the ${hoursText(ceiling)} limit`;
    case "under":
      return `${hoursText(hours)} — ${hoursText(ceiling - hours)} short of contracted hours`;
    case "ok":
      return `${hoursText(hours)} of ${hoursText(ceiling)}`;
    default:
      return "Nothing rostered this week";
  }
}

// ── The rule engine ────────────────────────────────────────────────────────────

export interface ComplianceInput {
  /** Shifts of the roster being built. Issues always reference these. */
  shifts: ComplianceShift[];
  /** Same-week shifts at OTHER venues — for double-booking and rest checks. */
  otherShifts?: ComplianceShift[];
  employees: ComplianceMember[];
  /** Venue id → name, so a double-booking can say where. */
  venueNameById?: Map<string, string>;
  /** yyyy-MM-dd → holiday name, already filtered to this venue's state. */
  holidayNameByDate?: Map<string, string>;
  options?: Partial<ComplianceOptions>;
  /** Per-check on/off and severity, from Settings → Roster Checks. */
  rules?: RuleConfig;
}

/**
 * Every rostering problem worth a manager's attention this week.
 *
 * Cross-venue shifts are folded in because the award limits (rest, weekly
 * hours) apply per employee per employer, not per site — someone closing
 * Geelong West and opening Torquay is the exact case that needs catching.
 */
export function detectRosterIssues(input: ComplianceInput): RosterIssue[] {
  const opt = { ...DEFAULT_COMPLIANCE, ...(input.options ?? {}) };
  const empById = new Map(input.employees.map((e) => [e.id, e]));
  const ownIds = new Set(input.shifts.map((s) => s.id));
  const venueName = (id: string) => input.venueNameById?.get(id) ?? "another venue";
  const issues: RosterIssue[] = [];

  const nameOf = (id: string) => empById.get(id)?.full_name ?? "Unknown";

  // Only the shifts of this roster can be "the problem" — a pair made entirely
  // of other-venue shifts belongs to that venue's roster, not this one.
  const touchesOwn = (...ids: string[]) => ids.some((id) => ownIds.has(id));
  const ownOnly = (...ids: string[]) => ids.filter((id) => ownIds.has(id));

  // ── Per-shift rules ──────────────────────────────────────────────────────────
  for (const s of input.shifts) {
    if (s.employee_id) {
      const emp = empById.get(s.employee_id);
      const gross = grossHours(s);
      const paid = paidHours(s);

      if (gross > opt.breakAfterHours && (s.unpaid_break_minutes ?? 0) < opt.minBreakMinutes) {
        issues.push({
          code: "no_break",
          severity: "warning",
          employeeId: s.employee_id,
          employeeName: nameOf(s.employee_id),
          date: s.date,
          shiftIds: [s.id],
          message:
            (s.unpaid_break_minutes ?? 0) > 0
              ? `${hoursText(gross)} shift with only a ${s.unpaid_break_minutes} min break — ${
                  opt.minBreakMinutes
                } min is required past ${opt.breakAfterHours} h`
              : `${hoursText(gross)} shift with no unpaid break — ${
                  opt.minBreakMinutes
                } min is required past ${opt.breakAfterHours} h`,
        });
      }

      if (paid > opt.maxShiftHours + 0.01) {
        issues.push({
          code: "long_shift",
          severity: "warning",
          employeeId: s.employee_id,
          employeeName: nameOf(s.employee_id),
          date: s.date,
          shiftIds: [s.id],
          message: `${hoursText(paid)} shift — past the ${hoursText(
            opt.maxShiftHours
          )} ordinary-hours limit, overtime applies`,
        });
      }

      const age = ageOn(emp?.date_of_birth, s.date);
      if (age != null && age < 18) {
        const { start, end } = shiftInterval(s);
        const dayBase = dayNumber(s.date) * MINUTES_PER_DAY;
        const latest = dayBase + timeToMinutes(opt.minorNightEnd);
        const earliest = dayBase + timeToMinutes(opt.minorMorningStart);
        if (end > latest || start < earliest) {
          issues.push({
            code: "minor_late",
            severity: "warning",
            employeeId: s.employee_id,
            employeeName: nameOf(s.employee_id),
            date: s.date,
            shiftIds: [s.id],
            message: `${nameOf(s.employee_id)} is ${age} — rostered ${formatTime(
              s.start_time
            )}–${formatTime(s.end_time)}, outside ${formatTime(
              opt.minorMorningStart
            )}–${formatTime(opt.minorNightEnd)}`,
          });
        }
      }
    }

    const holiday = input.holidayNameByDate?.get(s.date);
    if (holiday) {
      issues.push({
        code: "public_holiday",
        severity: "info",
        employeeId: s.employee_id,
        employeeName: s.employee_id ? nameOf(s.employee_id) : "Open shift",
        date: s.date,
        shiftIds: [s.id],
        message: `${holiday} — public holiday penalty rates apply`,
      });
    }
  }

  // ── Per-employee sequence rules (own + other venues) ─────────────────────────
  const byEmployee = new Map<string, ComplianceShift[]>();
  for (const s of [...input.shifts, ...(input.otherShifts ?? [])]) {
    if (!s.employee_id) continue;
    const list = byEmployee.get(s.employee_id) ?? [];
    list.push(s);
    byEmployee.set(s.employee_id, list);
  }

  for (const [empId, list] of byEmployee) {
    const emp = empById.get(empId);
    const sorted = [...list].sort(
      (a, b) => shiftInterval(a).start - shiftInterval(b).start
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const p = shiftInterval(prev);
      const c = shiftInterval(cur);
      if (!touchesOwn(prev.id, cur.id)) continue;

      if (c.start < p.end) {
        const crossVenue = prev.restaurant_id !== cur.restaurant_id;
        issues.push({
          code: crossVenue ? "double_booked" : "overlap",
          severity: "error",
          employeeId: empId,
          employeeName: nameOf(empId),
          date: cur.date,
          shiftIds: ownOnly(prev.id, cur.id),
          message: crossVenue
            ? `Also on at ${venueName(
                ownIds.has(cur.id) ? prev.restaurant_id : cur.restaurant_id
              )} — ${formatTime(prev.start_time)}–${formatTime(
                prev.end_time
              )} clashes with ${formatTime(cur.start_time)}–${formatTime(cur.end_time)}`
            : `Two shifts overlap — ${formatTime(prev.start_time)}–${formatTime(
                prev.end_time
              )} and ${formatTime(cur.start_time)}–${formatTime(cur.end_time)}`,
        });
        continue; // an overlap makes the rest-break check meaningless
      }

      const restH = (c.start - p.end) / 60;
      if (restH < opt.restHours) {
        const crossVenue = prev.restaurant_id !== cur.restaurant_id;
        issues.push({
          code: "rest",
          severity: "warning",
          employeeId: empId,
          employeeName: nameOf(empId),
          date: cur.date,
          shiftIds: ownOnly(prev.id, cur.id),
          message: `Only ${hoursText(restH)} off before this shift${
            crossVenue ? ` (previous shift at ${venueName(prev.restaurant_id)})` : ""
          } — ${opt.restHours} h is the minimum`,
        });
      }
    }

    // Weekly totals — combined across venues, since the limit is per employer.
    const total = sorted.reduce((sum, s) => sum + paidHours(s), 0);
    const anchor = sorted.find((s) => ownIds.has(s.id))?.date ?? sorted[0]?.date ?? "";
    const own = ownOnly(...sorted.map((s) => s.id));
    if (!own.length) continue;

    if (total > opt.weeklyHours + 0.01) {
      issues.push({
        code: "over_weekly",
        severity: "warning",
        employeeId: empId,
        employeeName: nameOf(empId),
        date: anchor,
        shiftIds: own,
        message: `${hoursText(total)} this week — ${hoursText(
          total - opt.weeklyHours
        )} past the ${hoursText(opt.weeklyHours)} ordinary limit`,
      });
    } else if (
      emp?.employment_type === "part_time" &&
      (emp.contracted_hours ?? 0) > 0 &&
      total > (emp.contracted_hours ?? 0) + 0.01
    ) {
      const contracted = emp.contracted_hours ?? 0;
      issues.push({
        code: "over_contract",
        severity: "warning",
        employeeId: empId,
        employeeName: nameOf(empId),
        date: anchor,
        shiftIds: own,
        message: `${hoursText(total)} rostered against ${hoursText(
          contracted
        )} contracted — the extra ${hoursText(total - contracted)} is overtime`,
      });
    }
  }

  // Apply the configured on/off + severity BEFORE sorting, so a check promoted
  // to "must fix" actually sorts to the top.
  const rules = input.rules;
  const configured = rules
    ? issues
        .filter((i) => rules[i.code]?.enabled !== false)
        .map((i) => ({ ...i, severity: rules[i.code]?.severity ?? i.severity }))
    : issues;

  const severityRank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return configured.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.date.localeCompare(b.date) ||
      a.employeeName.localeCompare(b.employeeName)
  );
}

/** Group issues by the shifts they touch, for chip-level badges. */
export function issuesByShift(issues: RosterIssue[]): Map<string, RosterIssue[]> {
  const map = new Map<string, RosterIssue[]>();
  for (const issue of issues) {
    for (const id of issue.shiftIds) {
      const list = map.get(id) ?? [];
      list.push(issue);
      map.set(id, list);
    }
  }
  return map;
}

/** Group issues by employee, for row-level badges. */
export function issuesByEmployee(issues: RosterIssue[]): Map<string, RosterIssue[]> {
  const map = new Map<string, RosterIssue[]>();
  for (const issue of issues) {
    if (!issue.employeeId) continue;
    const list = map.get(issue.employeeId) ?? [];
    list.push(issue);
    map.set(issue.employeeId, list);
  }
  return map;
}

/** The worst severity in a list, or null when it's empty. */
export function worstSeverity(issues: RosterIssue[] | undefined): IssueSeverity | null {
  if (!issues?.length) return null;
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "info";
}
