import { parseISO, getDay, addDays, format, differenceInYears } from "date-fns";
import type { TimeEntry } from "@/types";

// ============================================================================
// MA000003 Fast Food Award classifier
// ----------------------------------------------------------------------------
// Splits approved worked minutes into penalty categories (used by the T3 gross
// engine). Classification needs only: public holidays, timezone, OT thresholds
// and the evening/night windows. Penalty % + junior % are carried in the config
// for T3. Figures below match migration 053's app_settings 'award' seed
// (effective 1 July 2026); the operator can tune them there.
//
// SIMPLIFICATION (documented, to validate vs Deputy before trusting gross):
// overtime is computed at the week/day level and reported separately — it is
// NOT yet re-attributed out of the penalty buckets. Time-of-day splitting
// assumes no daylight-saving change mid-shift (negligible for fast food hours).
// ============================================================================

export type PenaltyCategory =
  | "ordinary"
  | "evening"
  | "night"
  | "saturday"
  | "sunday"
  | "public_holiday";

export const CATEGORY_LABELS: Record<PenaltyCategory, string> = {
  ordinary: "Ordinary",
  evening: "Evening",
  night: "Night",
  saturday: "Saturday",
  sunday: "Sunday",
  public_holiday: "Public holiday",
};

export const CATEGORY_ORDER: PenaltyCategory[] = [
  "ordinary",
  "evening",
  "night",
  "saturday",
  "sunday",
  "public_holiday",
];

export interface PenaltySet {
  ordinary: number;
  evening: number;
  night: number;
  saturday: number;
  sunday_l1: number;
  sunday: number;
  public_holiday: number;
  ot_first2: number;
  ot_after: number;
}

export type AwardLevel = "1" | "2" | "3" | "3+";

export const LEVEL_LABELS: Record<AwardLevel, string> = {
  "1": "Level 1",
  "2": "Level 2",
  "3": "Level 3",
  "3+": "Level 3 (2+ staff)",
};

export interface AwardConfig {
  code: string;
  tz: string;
  ot_daily_hours: number;
  ot_weekly_hours: number;
  evening_start: string; // "22:00"
  morning_end: string; // "06:00"
  junior_pct: Record<string, number>;
  levels: Record<string, number>; // adult permanent base $/hr per level
  penalties: { permanent: PenaltySet; casual: PenaltySet };
}

export const DEFAULT_AWARD: AwardConfig = {
  code: "MA000003",
  tz: "Australia/Melbourne",
  ot_daily_hours: 11,
  ot_weekly_hours: 38,
  evening_start: "22:00",
  morning_end: "06:00",
  junior_pct: { "15": 40, "16": 50, "17": 60, "18": 70, "19": 80, "20": 90, "21": 100 },
  levels: { "1": 27.81, "2": 29.45, "3": 29.91, "3+": 30.27 },
  penalties: {
    permanent: {
      ordinary: 100, evening: 110, night: 115, saturday: 125,
      sunday_l1: 125, sunday: 150, public_holiday: 225, ot_first2: 150, ot_after: 200,
    },
    casual: {
      ordinary: 125, evening: 135, night: 140, saturday: 150,
      sunday_l1: 150, sunday: 175, public_holiday: 250, ot_first2: 175, ot_after: 225,
    },
  },
};

// ── Junior rate percentage (of the adult rate) at a given date ────────────────
export function juniorPercent(
  dob: string | null | undefined,
  onDate: string,
  cfg: AwardConfig = DEFAULT_AWARD
): number | null {
  if (!dob) return null;
  const age = differenceInYears(parseISO(onDate), parseISO(dob));
  const jp = cfg.junior_pct;
  if (age <= 15) return jp["15"] ?? 40;
  if (age >= 21) return jp["21"] ?? 100;
  return jp[String(age)] ?? 100;
}

// ── Adult permanent base rate for a level ─────────────────────────────────────
export function adultRate(
  level: string | null | undefined,
  cfg: AwardConfig = DEFAULT_AWARD
): number | null {
  if (!level) return null;
  return cfg.levels[level] ?? null;
}

export interface EffectiveRate {
  rate: number | null;       // $/hr base (permanent, before penalties/loading)
  adult: number | null;      // adult level rate
  juniorPct: number | null;  // null = adult / unknown DOB
  isOverride: boolean;       // a manual base_pay_rate was set
}

/**
 * Derived base hourly rate = adult level rate × junior % (from DOB), unless a
 * manual base_pay_rate override is set. This is the PERMANENT base before award
 * penalties and casual loading (those come from the penalty %).
 */
export function effectiveHourlyRate(
  member: { award_level?: string | null; date_of_birth?: string | null; base_pay_rate?: number | null },
  onDate: string,
  cfg: AwardConfig = DEFAULT_AWARD
): EffectiveRate {
  const adult = adultRate(member.award_level, cfg);
  const juniorPct = member.date_of_birth ? juniorPercent(member.date_of_birth, onDate, cfg) : null;
  if (member.base_pay_rate != null) {
    return { rate: member.base_pay_rate, adult, juniorPct, isOverride: true };
  }
  const derived = adult == null ? null : adult * ((juniorPct ?? 100) / 100);
  return { rate: derived == null ? null : Math.round(derived * 100) / 100, adult, juniorPct, isOverride: false };
}

/**
 * Penalty percentage applied to one category for one member — the casual set
 * already carries the 25% loading, and Level 1 permanents get the lower Sunday
 * rate. Shared by the gross engine and the Pulse hourly labour cost so the two
 * can never drift apart.
 */
export function penaltyPctFor(
  member: { employment_type?: string | null; award_level?: string | null },
  category: PenaltyCategory,
  cfg: AwardConfig = DEFAULT_AWARD
): number {
  const pen = member.employment_type === "casual" ? cfg.penalties.casual : cfg.penalties.permanent;
  switch (category) {
    case "ordinary": return pen.ordinary;
    case "evening": return pen.evening;
    case "night": return pen.night;
    case "saturday": return pen.saturday;
    case "sunday": return member.award_level === "1" ? pen.sunday_l1 : pen.sunday;
    case "public_holiday": return pen.public_holiday;
  }
}

/**
 * Penalty category for a whole clock hour on a date. The award windows
 * (22:00 evening, 06:00 morning) fall on hour boundaries, so an hour never
 * straddles two categories.
 */
export function categoryForHour(
  dateISO: string,
  hour: number,
  isPublicHoliday: boolean,
  cfg: AwardConfig = DEFAULT_AWARD
): PenaltyCategory {
  if (isPublicHoliday) return "public_holiday";
  const dow = getDay(parseISO(dateISO));
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  const mod = hour * 60;
  if (mod >= hmToMin(cfg.evening_start)) return "evening";
  if (mod < hmToMin(cfg.morning_end)) return "night";
  return "ordinary";
}

// ── Local wall-clock parts for an instant, in the venue timezone ──────────────
function localParts(iso: string, tz: string): { date: string; mod: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hh = Number(get("hour"));
  if (hh === 24) hh = 0;
  const mod = hh * 60 + Number(get("minute"));
  return { date, mod };
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":");
  return Number(h) * 60 + Number(m);
}

/** The worked (paid) intervals of an entry, excluding the unpaid break. */
function workedIntervals(entry: TimeEntry): [string, string][] {
  if (!entry.clock_out) return [];
  if (entry.break_start && entry.break_end) {
    return [
      [entry.clock_in, entry.break_start],
      [entry.break_end, entry.clock_out],
    ];
  }
  return [[entry.clock_in, entry.clock_out]];
}

/** Minutes per penalty category for a single completed entry. */
export function classifyEntry(
  entry: TimeEntry,
  holidays: Set<string>,
  cfg: AwardConfig = DEFAULT_AWARD
): Record<PenaltyCategory, number> {
  const acc: Record<PenaltyCategory, number> = {
    ordinary: 0, evening: 0, night: 0, saturday: 0, sunday: 0, public_holiday: 0,
  };
  const eveningStart = hmToMin(cfg.evening_start);
  const morningEnd = hmToMin(cfg.morning_end);

  const category = (date: string, mod: number): PenaltyCategory => {
    if (holidays.has(date)) return "public_holiday";
    const dow = getDay(parseISO(date)); // 0 Sun … 6 Sat
    if (dow === 0) return "sunday";
    if (dow === 6) return "saturday";
    if (mod >= eveningStart) return "evening";
    if (mod < morningEnd) return "night";
    return "ordinary";
  };

  for (const [startISO, endISO] of workedIntervals(entry)) {
    const mins = Math.max(
      0,
      Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60000)
    );
    let { date, mod } = localParts(startISO, cfg.tz);
    for (let i = 0; i < mins; i++) {
      acc[category(date, mod)] += 1;
      mod += 1;
      if (mod >= 1440) {
        mod = 0;
        date = format(addDays(parseISO(date), 1), "yyyy-MM-dd");
      }
    }
  }
  return acc;
}

export interface EmployeeWeekAward {
  employeeId: string;
  categories: Record<PenaltyCategory, number>; // minutes
  totalMin: number;
  otMin: number; // informational (max of daily-based and weekly-based)
  entryCount: number;
}

// ── Gross pay (T3) ────────────────────────────────────────────────────────────
export interface GrossMember {
  award_level?: string | null;
  date_of_birth?: string | null;
  base_pay_rate?: number | null;
  employment_type?: string | null;
  pay_type?: string | null;
  salary_annual?: number | null;
}

export type GrossLineKey = PenaltyCategory | "ot_first2" | "ot_after";

export interface GrossLine {
  key: GrossLineKey;
  hours: number;
  pct: number;
  rate: number;
  amount: number;
}

export interface GrossResult {
  ok: boolean;
  salaried: boolean;
  base: number | null;
  juniorPct: number | null;
  isCasual: boolean;
  totalHours: number;
  otHours: number;
  lines: GrossLine[];
  gross: number;
  superableBase: number;
  superAmount: number;
  warnings: string[];
}

export const GROSS_LINE_LABELS: Record<GrossLineKey, string> = {
  ...CATEGORY_LABELS,
  ot_first2: "Overtime (first 2h)",
  ot_after: "Overtime (after 2h)",
};

/**
 * Gross pay for one employee-week from the classified buckets.
 *
 * Model (documented; validate vs Deputy before relying on it):
 *  - base = permanent adult rate × junior % (or the manual override).
 *  - each category's hours are paid at base × its penalty % (casual set already
 *    includes the 25% loading; permanent set otherwise).
 *  - overtime hours are pulled out of the LOWEST-penalty buckets first
 *    (ordinary → evening → night), leaving weekend/public-holiday hours at their
 *    higher penalty, and paid at OT rates (first 2h, then after).
 *  - super is applied to ordinary-time earnings (gross excluding overtime),
 *    matching OTE treatment.
 *  - salaried: gross = salary_annual / 52, no penalties.
 */
export function computeGross(
  agg: EmployeeWeekAward,
  member: GrossMember,
  superRatePct: number,
  onDate: string,
  cfg: AwardConfig = DEFAULT_AWARD
): GrossResult {
  const totalHours = agg.totalMin / 60;

  if (member.pay_type === "salary") {
    const gross = (member.salary_annual ?? 0) / 52;
    return {
      ok: member.salary_annual != null,
      salaried: true,
      base: null,
      juniorPct: null,
      isCasual: false,
      totalHours,
      otHours: 0,
      lines: [],
      gross,
      superableBase: gross,
      superAmount: (gross * superRatePct) / 100,
      warnings: member.salary_annual == null ? ["No annual salary set"] : [],
    };
  }

  const eff = effectiveHourlyRate(member, onDate, cfg);
  const base = eff.rate;
  const isCasual = member.employment_type === "casual";
  const pen = isCasual ? cfg.penalties.casual : cfg.penalties.permanent;

  const warnings: string[] = [];
  if (base == null) warnings.push("No rate — set an award level or override");
  if (!member.date_of_birth) warnings.push("No DOB — treated as adult");
  if (!member.employment_type) warnings.push("No employment type — treated as permanent");

  // Pull overtime out of the lowest-penalty buckets first.
  const catMin: Record<PenaltyCategory, number> = { ...agg.categories };
  let ot = agg.otMin;
  let otPulled = 0;
  for (const c of ["ordinary", "evening", "night"] as PenaltyCategory[]) {
    const take = Math.min(ot, catMin[c]);
    catMin[c] -= take;
    ot -= take;
    otPulled += take;
    if (ot <= 0) break;
  }
  const otFirst2Min = Math.min(otPulled, 120);
  const otAfterMin = otPulled - otFirst2Min;

  // One source of truth for the penalty % (see penaltyPctFor above).
  const pctFor = (c: PenaltyCategory): number => penaltyPctFor(member, c, cfg);

  const lines: GrossLine[] = [];
  if (base != null) {
    for (const c of CATEGORY_ORDER) {
      const hours = catMin[c] / 60;
      if (hours > 0) {
        const pct = pctFor(c);
        const rate = (base * pct) / 100;
        lines.push({ key: c, hours, pct, rate, amount: rate * hours });
      }
    }
    if (otFirst2Min > 0) {
      const rate = (base * pen.ot_first2) / 100;
      lines.push({ key: "ot_first2", hours: otFirst2Min / 60, pct: pen.ot_first2, rate, amount: (rate * otFirst2Min) / 60 });
    }
    if (otAfterMin > 0) {
      const rate = (base * pen.ot_after) / 100;
      lines.push({ key: "ot_after", hours: otAfterMin / 60, pct: pen.ot_after, rate, amount: (rate * otAfterMin) / 60 });
    }
  }

  const gross = lines.reduce((s, l) => s + l.amount, 0);
  const otPay = lines
    .filter((l) => l.key === "ot_first2" || l.key === "ot_after")
    .reduce((s, l) => s + l.amount, 0);
  const superableBase = gross - otPay;

  return {
    ok: base != null,
    salaried: false,
    base,
    juniorPct: eff.juniorPct,
    isCasual,
    totalHours,
    otHours: otPulled / 60,
    lines,
    gross,
    superableBase,
    superAmount: (superableBase * superRatePct) / 100,
    warnings,
  };
}

/**
 * Aggregate a week of entries per employee. `holidaysFor` returns the holiday
 * date-set applicable to a given entry (its store's state).
 */
export function aggregateWeek(
  entries: TimeEntry[],
  holidaysFor: (entry: TimeEntry) => Set<string>,
  cfg: AwardConfig = DEFAULT_AWARD
): Map<string, EmployeeWeekAward> {
  const byEmp = new Map<string, EmployeeWeekAward>();
  const dailyByEmp = new Map<string, Map<string, number>>();

  for (const e of entries) {
    if (!e.clock_out || e.approval_status === "rejected") continue;
    const cats = classifyEntry(e, holidaysFor(e), cfg);
    const total = Object.values(cats).reduce((a, b) => a + b, 0);

    let agg = byEmp.get(e.employee_id);
    if (!agg) {
      agg = {
        employeeId: e.employee_id,
        categories: { ordinary: 0, evening: 0, night: 0, saturday: 0, sunday: 0, public_holiday: 0 },
        totalMin: 0,
        otMin: 0,
        entryCount: 0,
      };
      byEmp.set(e.employee_id, agg);
    }
    (Object.keys(cats) as PenaltyCategory[]).forEach((k) => (agg!.categories[k] += cats[k]));
    agg.totalMin += total;
    agg.entryCount += 1;

    let dm = dailyByEmp.get(e.employee_id);
    if (!dm) {
      dm = new Map();
      dailyByEmp.set(e.employee_id, dm);
    }
    dm.set(e.work_date, (dm.get(e.work_date) ?? 0) + total);
  }

  // Overtime: greater of daily-threshold and weekly-threshold overtime.
  for (const [empId, agg] of byEmp) {
    const dm = dailyByEmp.get(empId)!;
    let dailyOT = 0;
    for (const dayMin of dm.values()) {
      dailyOT += Math.max(0, dayMin - cfg.ot_daily_hours * 60);
    }
    const weeklyOT = Math.max(0, agg.totalMin - cfg.ot_weekly_hours * 60);
    agg.otMin = Math.max(dailyOT, weeklyOT);
  }

  return byEmp;
}
