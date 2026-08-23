import { timeToMinutes } from "@/lib/roster";
import { requiredByStation, type DemandParams } from "@/lib/staffing";
import type { Shift, StaffingConfig, StaffingMatrixRow } from "@/types";

/**
 * The day-view forecast graph: projected sales per hour against the labour
 * hours the day IDEALLY needs and the labour hours actually ROSTERED.
 *
 * Pure — no React, no Supabase. The sales curve comes from `useSalesProjection`
 * (entered daily projection × the same weekday's most recent hourly shape); the
 * ideal curve comes from the staffing matrix, the same engine "Build from
 * sales" uses, so the graph and the generator can never disagree.
 */

/** The staffing-engine params for a venue. Shared with "Build from sales". */
export function demandParamsFrom(config: StaffingConfig): DemandParams {
  return {
    openHour: config.open_hour,
    closeHour: config.close_hour,
    minShiftHours: config.min_shift_hours,
    breakThresholdHours: config.break_threshold_hours,
    breakMinutes: config.break_minutes,
    maxGapBridgeHours: 2,
  };
}

/** Overlap in minutes between [a1,a2) and [b1,b2). */
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * Where a shift's unpaid break sits, in minutes since midnight. Mirrors the day
 * timeline: a stored `break_start` wins, otherwise the break is centred.
 */
export function breakWindow(s: Shift): { start: number; length: number } | null {
  const st = timeToMinutes(s.start_time);
  let en = timeToMinutes(s.end_time);
  if (en <= st) en += 1440;
  const length = s.unpaid_break_minutes || 0;
  const shiftLen = en - st;
  if (length <= 0 || length >= shiftLen) return null;
  const stored = s.break_start != null ? timeToMinutes(s.break_start) : null;
  const normalised = stored != null ? (stored < st ? stored + 1440 : stored) : null;
  const centred = Math.round(st + shiftLen / 2 - length / 2);
  const start = Math.max(st, Math.min(en - length, normalised ?? centred));
  return { start, length };
}

/**
 * Paid labour hours falling inside each clock hour of the day.
 *
 * A shift running past midnight contributes only the part before midnight —
 * the tail belongs to the next day's graph, not this one.
 */
export function scheduledHoursByHour(shifts: Shift[]): number[] {
  const out = new Array<number>(24).fill(0);
  for (const s of shifts) {
    const st = timeToMinutes(s.start_time);
    let en = timeToMinutes(s.end_time);
    if (en <= st) en += 1440;
    const brk = breakWindow(s);
    for (let h = 0; h < 24; h++) {
      const from = h * 60;
      const to = from + 60;
      let mins = overlap(st, en, from, to);
      if (brk) mins -= overlap(brk.start, brk.start + brk.length, from, to);
      if (mins > 0) out[h] += mins / 60;
    }
  }
  return out;
}

/**
 * Labour hours the staffing matrix asks for in each clock hour. A station
 * needing N people for an hour is N labour hours.
 *
 * `positionIds` narrows to one area (and its sub-areas); null = every station,
 * including matrix rows not mapped to a roster position.
 */
export function idealHoursByHour(
  matrix: StaffingMatrixRow[],
  hourlySales: number[],
  params: DemandParams,
  positionIds: Set<string> | null
): number[] {
  const out = new Array<number>(24).fill(0);
  for (const g of requiredByStation(matrix, hourlySales, params)) {
    if (positionIds && (!g.position_id || !positionIds.has(g.position_id))) continue;
    for (let h = 0; h < 24; h++) out[h] += g.perHour[h];
  }
  return out;
}

/** 0–23 → "7am", "12pm", "5pm" — matching Sales by Hour. */
export function hourLabel(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${period}`;
}

export interface ForecastPoint {
  label: string;
  sales: number;
  ideal: number;
  scheduled: number;
  /** Set on the day graph — the clock hour this point covers. */
  hour?: number;
  /** Set on the week graph — the date this point covers. */
  date?: string;
}

export interface ForecastResult {
  points: ForecastPoint[];
  totals: { sales: number; ideal: number; scheduled: number };
  /** True when there is nothing at all to plot. */
  empty: boolean;
}

export interface ForecastInput {
  /** This day's shifts, already narrowed to the selected area. */
  shifts: Shift[];
  matrix: StaffingMatrixRow[];
  /** Projected $ per hour (length 24) from useSalesProjection. */
  hourlySales: number[];
  config: StaffingConfig | null;
  /** Area + sub-area ids to narrow the ideal curve to; null = all stations. */
  positionIds: Set<string> | null;
}

/**
 * Assemble the plot. The window starts at opening (or the first hour with
 * anything on it) and ends at close, padded an hour each side so the curves
 * visibly rise off and settle back to zero, as in the reference graph.
 */
export function buildForecast(input: ForecastInput): ForecastResult {
  const { shifts, matrix, hourlySales, config, positionIds } = input;
  const params = config ? demandParamsFrom(config) : null;

  const scheduled = scheduledHoursByHour(shifts);
  const ideal = params ? idealHoursByHour(matrix, hourlySales, params, positionIds) : new Array<number>(24).fill(0);

  const has = (h: number) =>
    (hourlySales[h] ?? 0) > 0 || ideal[h] > 0 || scheduled[h] > 0;
  let first = 24;
  let last = -1;
  for (let h = 0; h < 24; h++) {
    if (has(h)) {
      if (h < first) first = h;
      last = h;
    }
  }
  if (last < 0) {
    return { points: [], totals: { sales: 0, ideal: 0, scheduled: 0 }, empty: true };
  }

  const openHour = config?.open_hour ?? first;
  const closeHour = config?.close_hour ?? last + 1;
  const from = Math.max(0, Math.min(first, openHour) - 1);
  const to = Math.min(23, Math.max(last, closeHour - 1) + 1);

  const points: ForecastPoint[] = [];
  const totals = { sales: 0, ideal: 0, scheduled: 0 };
  for (let h = from; h <= to; h++) {
    const sales = hourlySales[h] ?? 0;
    points.push({ hour: h, label: hourLabel(h), sales, ideal: ideal[h], scheduled: scheduled[h] });
    totals.sales += sales;
    totals.ideal += ideal[h];
    totals.scheduled += scheduled[h];
  }
  return { points, totals, empty: false };
}

// ── Week graph ────────────────────────────────────────────────────────────────

export interface WeekForecastInput {
  /** The week's dates, Mon…Sun. */
  days: string[];
  /** Every shift in the week, already narrowed to the selected area. */
  shifts: Shift[];
  matrix: StaffingMatrixRow[];
  /** Projected $ per hour per date, from useSalesProjection. */
  projectedByDate: Map<string, number[]>;
  config: StaffingConfig | null;
  positionIds: Set<string> | null;
  /** Mon…Sun labels, so the caller owns the wording. */
  dayLabels: readonly string[];
}

/**
 * The same three measures as the day graph, rolled up per day across the week:
 * projected sales, the labour hours the staffing matrix asks for, and the hours
 * actually rostered. Each day is summed from the SAME per-hour engine the day
 * graph uses, so a week bar is always exactly its day graph's total.
 */
export function buildWeekForecast(input: WeekForecastInput): ForecastResult {
  const { days, shifts, matrix, projectedByDate, config, positionIds, dayLabels } = input;
  const params = config ? demandParamsFrom(config) : null;

  const points: ForecastPoint[] = [];
  const totals = { sales: 0, ideal: 0, scheduled: 0 };
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  days.forEach((date, i) => {
    const hourly = projectedByDate.get(date) ?? new Array<number>(24).fill(0);
    const dayShifts = shifts.filter((s) => s.date === date);
    const sales = sum(hourly);
    const ideal = params ? sum(idealHoursByHour(matrix, hourly, params, positionIds)) : 0;
    const scheduled = sum(scheduledHoursByHour(dayShifts));
    points.push({
      date,
      label: dayLabels[i] ?? date,
      sales,
      ideal,
      scheduled,
    });
    totals.sales += sales;
    totals.ideal += ideal;
    totals.scheduled += scheduled;
  });

  const empty = totals.sales === 0 && totals.ideal === 0 && totals.scheduled === 0;
  return { points, totals, empty };
}
