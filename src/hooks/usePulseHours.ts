import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAwardConfig, usePublicHolidays } from "@/hooks/useAward";
import { useEmployees } from "@/hooks/useEmployees";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  categoryForHour,
  effectiveHourlyRate,
  penaltyPctFor,
  type AwardConfig,
} from "@/lib/award";
import { timeToMinutes } from "@/lib/roster";
import type { Profile, Shift, TimeEntry } from "@/types";

/**
 * The Pulse engine — one trading day, hour by hour, live.
 *
 * Every column comes from a different place, so they are listed here once:
 *
 *   Projected sales  daily_projections (the figure typed into Projections) split
 *                    across hours by the most recent same-weekday sales curve —
 *                    the same model the roster builder forecasts with
 *                    (`roster_weekday_hourly_shapes`, migration 062).
 *   Gross sales      sales_transactions "Total" (incl. GST + surcharge-free), the
 *                    figure the tills add up to.
 *   Net sales        the same sales ex-GST (the feed's Net Amount column).
 *   Delivery sales   delivery_orders (migration 068) — written by the hourly
 *                    delivery scraper. Missing table / no scraper yet = zeroes.
 *   Labour           ACTUAL for hours that have finished (time_entries punches),
 *                    ROSTERED for the rest of the day (shifts). Costed at the
 *                    MA000003 rate for the employee and the hour's penalty
 *                    category, so a Sunday evening hour costs what it really costs.
 *   SPMH             net sales ÷ labour hours for that hour.
 *
 * Multi-venue: every figure is the sum across the venues in scope, and SPMH is
 * combined sales ÷ combined hours (not an average of averages).
 */

// Delivery orders are treated as a SLICE of net sales (the POS sees them), so
// the chart splits the Net bar into in-store + delivery rather than stacking
// them on top. If your delivery scraper ever pulls orders that never hit the
// POS, flip this to false: delivery then adds to net instead of dividing it.
export const DELIVERY_IS_INSIDE_NET = true;

export interface PulseHour {
  hour: number;
  label: string;
  projected: number;
  grossSales: number; // incl. GST — what the till rang up
  netSales: number;
  inStore: number; // netSales − delivery (or netSales when delivery is separate)
  delivery: number;
  /** Net sales − projected for the hour. Null while the hour is still to come. */
  variance: number | null;
  variancePct: number | null;
  labourCost: number;
  labourHours: number;
  spmh: number | null;
  labourSource: "actual" | "rostered";
  /** The hour hasn't happened yet (only ever true for today / future dates). */
  isFuture: boolean;
  /** The hour is in progress right now — its sales are still filling up. */
  isCurrent: boolean;
}

export interface PulseTotals {
  projected: number;
  grossSales: number;
  netSales: number;
  delivery: number;
  variance: number;
  variancePct: number | null;
  labourCost: number;
  labourHours: number;
  spmh: number | null;
  labourPct: number | null; // labour cost as % of net sales
}

export interface PulseData {
  hours: PulseHour[];
  totals: PulseTotals;
  /** Totals for hours that have actually happened — the honest "so far" read. */
  soFar: PulseTotals;
  /** The whole day's projection, including any hours outside the visible window. */
  projectedDay: number;
  labourBasis: "actual" | "rostered" | "mixed";
  hasProjection: boolean;
  projectionEstimated: boolean;
  deliveryTableMissing: boolean;
  isToday: boolean;
  nowHour: number | null;
  isLoading: boolean;
  isFetching: boolean;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/** 0–23 → "12am", "9am", "5pm". */
export function hourLabel(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${period}`;
}

/** Wall-clock date + minute-of-day for an instant, in the venue timezone. */
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
  let hh = Number(get("hour"));
  if (hh === 24) hh = 0;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    mod: hh * 60 + Number(get("minute")),
  };
}

/** Minutes of [aStart, aEnd) that fall inside [bStart, bEnd). */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** The unpaid break window of a shift, in minutes-of-day (null = no break). */
function breakWindow(shift: Shift, start: number, end: number): [number, number] | null {
  const mins = shift.unpaid_break_minutes ?? 0;
  if (mins <= 0) return null;
  if (shift.break_start) {
    const b = timeToMinutes(shift.break_start);
    const bStart = b < start ? b + 1440 : b;
    return [bStart, bStart + mins];
  }
  // No explicit break time — the roster centres it, so we do too.
  const mid = (start + end) / 2;
  return [mid - mins / 2, mid + mins / 2];
}

type PayMember = Pick<
  Profile,
  "award_level" | "date_of_birth" | "base_pay_rate" | "employment_type" | "pay_type" | "salary_annual"
>;

/** $/hr for a member in a given hour, penalties included. Null = no rate set. */
function hourlyCostRate(
  member: PayMember | null,
  dateISO: string,
  hour: number,
  isHoliday: boolean,
  cfg: AwardConfig
): number | null {
  if (!member) return null;
  const base = effectiveHourlyRate(member, dateISO, cfg).rate;
  if (base == null) return null;
  const pct = penaltyPctFor(member, categoryForHour(dateISO, hour, isHoliday, cfg), cfg);
  return (base * pct) / 100;
}

// ── Row shapes coming back from Supabase ──────────────────────────────────────

interface TxRow {
  restaurant_id: string;
  hour: number;
  amount: number | null;
  net_amount: number | null;
}

interface DeliveryRow {
  restaurant_id: string;
  hour: number;
  amount: number | null;
  net_amount: number | null;
  status: string | null;
}

interface ShapeRow {
  weekday: number; // 0=Sun … 6=Sat (JS getDay)
  business_date: string;
  hour: number;
  amount: number | string;
}

type EntryRow = TimeEntry & { employee?: PayMember | null };

const ENTRY_SELECT =
  "*, employee:profiles!time_entries_employee_id_fkey(award_level, date_of_birth, base_pay_rate, employment_type, pay_type, salary_annual)";

// ── The hook ──────────────────────────────────────────────────────────────────

export function usePulseHours(
  dateISO: string,
  restaurantIds: string[],
  opts: { fullDay?: boolean } = {}
): PulseData {
  const fullDay = opts.fullDay ?? false;
  const cfg = useAwardConfig();
  const tz = cfg.tz || "Australia/Melbourne";
  const enabled = restaurantIds.length > 0;
  const idKey = [...restaurantIds].sort().join(",");

  // Where "now" sits in venue-local time — decides actual-vs-rostered and which
  // hours are still to come.
  const now = localParts(new Date().toISOString(), tz);
  const isToday = now.date === dateISO;
  const isPast = dateISO < now.date;
  const nowHour = isToday ? Math.floor(now.mod / 60) : null;

  // 1 ── Net sales (the hourly Kounta feed).
  const sales = useQuery({
    queryKey: ["pulse-sales", dateISO, idKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_transactions")
        .select("restaurant_id, hour, amount, net_amount")
        .eq("business_date", dateISO)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return (data ?? []) as TxRow[];
    },
    enabled,
    staleTime: 30_000,
  });

  // 2 ── Delivery orders. The table may not exist yet (migration 068 unapplied)
  //      and the scraper may not be written — neither should break the report.
  const delivery = useQuery({
    queryKey: ["pulse-delivery", dateISO, idKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_orders")
        .select("restaurant_id, hour, amount, net_amount, status")
        .eq("business_date", dateISO)
        .in("restaurant_id", restaurantIds);
      if (error) {
        const missing =
          error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
        if (missing) return { rows: [] as DeliveryRow[], missing: true };
        throw error;
      }
      return { rows: (data ?? []) as DeliveryRow[], missing: false };
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  // 3 ── The day's entered projection, per venue.
  const projections = useQuery({
    queryKey: ["pulse-projection", dateISO, idKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_projections")
        .select("restaurant_id, projected_sales")
        .eq("date", dateISO)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return (data ?? []) as { restaurant_id: string; projected_sales: number }[];
    },
    enabled,
  });

  // 4 ── Hourly shape per venue: the most recent same-weekday curve, aggregated
  //      server-side (≤7×24 rows, so nothing is lost to the 1000-row cap).
  const shapeBefore = format(subDays(parseISO(dateISO), 1), "yyyy-MM-dd");
  const shapeQueries = useQueries({
    queries: restaurantIds.map((id) => ({
      queryKey: ["pulse-shape", id, shapeBefore],
      queryFn: async () => {
        const { data, error } = await supabase.rpc("roster_weekday_hourly_shapes", {
          p_restaurant_id: id,
          p_before: shapeBefore,
        });
        if (error) throw error;
        return { id, rows: (data ?? []) as ShapeRow[] };
      },
      staleTime: 10 * 60_000,
    })),
  });

  // 5 ── Rostered shifts for the day.
  const shifts = useQuery({
    queryKey: ["pulse-shifts", dateISO, idKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("date", dateISO)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
    enabled,
  });

  // 6 ── Actual punches for the day.
  const entries = useQuery({
    queryKey: ["pulse-entries", dateISO, idKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select(ENTRY_SELECT)
        .eq("work_date", dateISO)
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return (data ?? []) as unknown as EntryRow[];
    },
    enabled,
    staleTime: 30_000,
  });

  // 7 ── Trading window, so the table shows the whole day rather than only the
  //      hours that happen to have data in them yet.
  const staffing = useQuery({
    queryKey: ["pulse-staffing", idKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staffing_config")
        .select("restaurant_id, open_hour, close_hour")
        .in("restaurant_id", restaurantIds);
      if (error) throw error;
      return (data ?? []) as { restaurant_id: string; open_hour: number; close_hour: number }[];
    },
    enabled,
    staleTime: 10 * 60_000,
  });

  const { data: employees = [] } = useEmployees();
  const { data: restaurants = [] } = useRestaurants();
  const { data: holidays = [] } = usePublicHolidays(dateISO, dateISO);

  // A public holiday counts when it lands in a state one of the venues in scope
  // sits in.
  const isHoliday = useMemo(() => {
    const states = new Set<string>(
      restaurants
        .filter((r) => restaurantIds.includes(r.id))
        .map((r) => r.state)
        .filter((v): v is NonNullable<typeof v> => !!v)
    );
    return holidays.some((h) => h.date === dateISO && (states.size === 0 || states.has(h.state)));
  }, [holidays, restaurants, restaurantIds, dateISO]);

  const empById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  const shapesLoading = shapeQueries.some((q) => q.isLoading);
  const shapeData = shapeQueries.map((q) => q.data).filter(Boolean) as { id: string; rows: ShapeRow[] }[];
  // Changes whenever any per-venue shape query resolves, so the memo below
  // recomputes when the curves land (the id list alone never changes).
  const shapeStamp = shapeQueries.map((q) => q.dataUpdatedAt ?? 0).join(",");

  return useMemo(() => {
    const gross = new Array(24).fill(0) as number[];
    const net = new Array(24).fill(0) as number[];
    const del = new Array(24).fill(0) as number[];
    const proj = new Array(24).fill(0) as number[];
    const labCost = new Array(24).fill(0) as number[];
    const labHours = new Array(24).fill(0) as number[];
    const rosteredCost = new Array(24).fill(0) as number[];
    const rosteredHours = new Array(24).fill(0) as number[];
    const actualCost = new Array(24).fill(0) as number[];
    const actualHours = new Array(24).fill(0) as number[];

    // ── Net sales ─────────────────────────────────────────────────────────────
    // net_amount is the feed's ex-GST column; fall back to the gross Total only
    // when the feed didn't give one.
    for (const r of sales.data ?? []) {
      net[r.hour] += Number(r.net_amount ?? r.amount ?? 0);
      gross[r.hour] += Number(r.amount ?? r.net_amount ?? 0);
    }

    // ── Delivery ──────────────────────────────────────────────────────────────
    for (const r of delivery.data?.rows ?? []) {
      if (r.status && /cancel|refund/i.test(r.status)) continue;
      del[r.hour] += Number(r.net_amount ?? r.amount ?? 0);
      // Delivery only adds to gross when it lives outside the POS totals.
      if (!DELIVERY_IS_INSIDE_NET) gross[r.hour] += Number(r.amount ?? r.net_amount ?? 0);
    }

    // ── Projected sales: day total × same-weekday hourly shape, per venue ─────
    const weekday = parseISO(dateISO).getDay();
    let projectionEstimated = false;
    let hasProjection = false;
    const projByVenue = new Map<string, number>();
    for (const p of projections.data ?? []) {
      projByVenue.set(p.restaurant_id, Number(p.projected_sales ?? 0));
    }
    for (const [venueId, total] of projByVenue) {
      if (!(total > 0)) continue;
      hasProjection = true;
      const rows = shapeData.find((s) => s.id === venueId)?.rows ?? [];

      const forWeekday = new Array(24).fill(0) as number[];
      const allDays = new Array(24).fill(0) as number[];
      for (const r of rows) {
        const amt = Number(r.amount ?? 0);
        allDays[r.hour] += amt;
        if (r.weekday === weekday) forWeekday[r.hour] += amt;
      }
      const wdSum = forWeekday.reduce((a, b) => a + b, 0);
      const allSum = allDays.reduce((a, b) => a + b, 0);

      if (wdSum > 0) {
        for (let h = 0; h < 24; h++) proj[h] += (forWeekday[h] / wdSum) * total;
      } else if (allSum > 0) {
        // No history for this weekday — fall back to the average curve.
        projectionEstimated = true;
        for (let h = 0; h < 24; h++) proj[h] += (allDays[h] / allSum) * total;
      } else {
        // No hourly history at all — spread evenly over a default trading window.
        projectionEstimated = true;
        for (let h = 10; h < 21; h++) proj[h] += total / 11;
      }
    }

    // ── Rostered labour ───────────────────────────────────────────────────────
    for (const s of shifts.data ?? []) {
      let start = timeToMinutes(s.start_time);
      let end = timeToMinutes(s.end_time);
      if (end <= start) end += 1440; // finishes after midnight
      const brk = breakWindow(s, start, end);
      const member = s.employee_id ? empById.get(s.employee_id) ?? null : null;

      for (let h = 0; h < 24; h++) {
        const hStart = h * 60;
        const hEnd = hStart + 60;
        // Count both the same-day window and the after-midnight tail.
        let mins = overlap(start, end, hStart, hEnd) + overlap(start, end, hStart + 1440, hEnd + 1440);
        if (brk) {
          mins -= overlap(brk[0], brk[1], hStart, hEnd) + overlap(brk[0], brk[1], hStart + 1440, hEnd + 1440);
        }
        if (mins <= 0) continue;
        const hours = mins / 60;
        rosteredHours[h] += hours;
        const rate = hourlyCostRate(member, dateISO, h, isHoliday, cfg);
        if (rate != null) rosteredCost[h] += hours * rate;
      }
    }

    // ── Actual labour (punches) ───────────────────────────────────────────────
    const nowMod = now.mod;
    for (const e of entries.data ?? []) {
      if (e.approval_status === "rejected") continue;
      // An open punch on a past day is a data error, not live labour — skip it
      // rather than billing it through to midnight.
      if (!e.clock_out && !isToday) continue;
      const inParts = localParts(e.clock_in, tz);
      let start = inParts.mod;
      if (inParts.date < dateISO) start -= 1440; // clocked in before midnight

      // Still clocked in → count up to now (today) or to the end of the day.
      let end: number;
      if (e.clock_out) {
        const outParts = localParts(e.clock_out, tz);
        end = outParts.mod + (outParts.date > inParts.date ? 1440 : 0) + (inParts.date < dateISO ? -1440 : 0);
      } else {
        end = isToday ? nowMod : 1440;
      }
      if (end <= start) continue;

      let brk: [number, number] | null = null;
      if (e.break_start) {
        const bs = localParts(e.break_start, tz);
        const bStart = bs.mod + (inParts.date < dateISO ? -1440 : 0) + (bs.date > inParts.date ? 1440 : 0);
        const be = e.break_end ? localParts(e.break_end, tz) : null;
        const bEnd = be
          ? be.mod + (inParts.date < dateISO ? -1440 : 0) + (be.date > inParts.date ? 1440 : 0)
          : Math.min(end, isToday ? nowMod : 1440); // break still running
        if (bEnd > bStart) brk = [bStart, bEnd];
      }

      const member = e.employee ?? (empById.get(e.employee_id) as PayMember | undefined) ?? null;
      for (let h = 0; h < 24; h++) {
        const hStart = h * 60;
        const hEnd = hStart + 60;
        let mins = overlap(start, end, hStart, hEnd);
        if (brk) mins -= overlap(brk[0], brk[1], hStart, hEnd);
        if (mins <= 0) continue;
        const hours = mins / 60;
        actualHours[h] += hours;
        const rate = hourlyCostRate(member, dateISO, h, isHoliday, cfg);
        if (rate != null) actualCost[h] += hours * rate;
      }
    }

    // ── Blend: actual behind us, roster ahead of us ───────────────────────────
    // If nobody punched at all that day (clock-in not in use yet), the roster is
    // the only honest answer for the whole day.
    const anyActual = actualHours.some((h) => h > 0);
    let usedActual = false;
    let usedRostered = false;
    const sourceByHour: ("actual" | "rostered")[] = [];

    for (let h = 0; h < 24; h++) {
      const hourFinished = isPast || (isToday && nowHour != null && h < nowHour);
      const useActual = anyActual && hourFinished;
      sourceByHour[h] = useActual ? "actual" : "rostered";
      labHours[h] = useActual ? actualHours[h] : rosteredHours[h];
      labCost[h] = useActual ? actualCost[h] : rosteredCost[h];
      if (labHours[h] > 0) {
        if (useActual) usedActual = true;
        else usedRostered = true;
      }
    }

    // ── Which hours to show ───────────────────────────────────────────────────
    // The whole trading day, always: open→close from each venue's staffing
    // config (widest span in scope), then widened by any hour that actually has
    // something in it — sales before open, a late close, a shift that ran on.
    // So the projected curve is visible for the full day from first light, not
    // just up to the last hour with sales in it.
    let minH: number;
    let maxH: number;

    if (fullDay) {
      minH = 0;
      maxH = 23;
    } else {
      const cfgRows = staffing.data ?? [];
      minH = cfgRows.length ? Math.min(...cfgRows.map((r) => r.open_hour ?? 10)) : 10;
      maxH = cfgRows.length ? Math.max(...cfgRows.map((r) => (r.close_hour ?? 21) - 1)) : 20;
      for (let h = 0; h < 24; h++) {
        if (net[h] > 0 || gross[h] > 0 || del[h] > 0 || proj[h] > 0.5 || labHours[h] > 0) {
          if (h < minH) minH = h;
          if (h > maxH) maxH = h;
        }
      }
      if (maxH < minH) {
        minH = 10;
        maxH = 21;
      }
    }

    const hours: PulseHour[] = [];
    const elapsedThisHour = isToday ? (now.mod % 60) / 60 : 1;
    for (let h = minH; h <= maxH; h++) {
      const deliveryHour = del[h];
      const netHour = DELIVERY_IS_INSIDE_NET ? net[h] : net[h] + deliveryHour;
      const future = isToday && nowHour != null ? h > nowHour : dateISO > now.date;
      const current = isToday && nowHour === h;
      // The hour in progress is measured against the slice of its projection
      // that has actually elapsed — otherwise every hour reads red until it ends.
      const projSoFar = current ? proj[h] * elapsedThisHour : proj[h];
      const variance = future ? null : netHour - projSoFar;
      hours.push({
        hour: h,
        label: hourLabel(h),
        projected: proj[h],
        grossSales: gross[h],
        netSales: netHour,
        variance,
        variancePct: variance == null || projSoFar <= 0 ? null : (variance / projSoFar) * 100,
        inStore: DELIVERY_IS_INSIDE_NET ? Math.max(0, net[h] - deliveryHour) : net[h],
        delivery: deliveryHour,
        labourCost: labCost[h],
        labourHours: labHours[h],
        spmh: labHours[h] > 0 ? netHour / labHours[h] : null,
        labourSource: sourceByHour[h],
        isFuture: future,
        isCurrent: current,
      });
    }

    const sum = (rows: PulseHour[]): PulseTotals => {
      const t = rows.reduce(
        (a, r) => {
          a.projected += r.projected;
          a.grossSales += r.grossSales;
          a.netSales += r.netSales;
          a.delivery += r.delivery;
          a.labourCost += r.labourCost;
          a.labourHours += r.labourHours;
          return a;
        },
        { projected: 0, grossSales: 0, netSales: 0, delivery: 0, labourCost: 0, labourHours: 0 }
      );
      const variance = t.netSales - t.projected;
      return {
        ...t,
        variance,
        variancePct: t.projected > 0 ? (variance / t.projected) * 100 : null,
        spmh: t.labourHours > 0 ? t.netSales / t.labourHours : null,
        labourPct: t.netSales > 0 ? (t.labourCost / t.netSales) * 100 : null,
      };
    };

    // "So far" compares like with like: the hour in progress only counts the
    // slice of its projection that has actually elapsed, otherwise every hour
    // starts out looking catastrophically behind.
    const soFarRows = hours
      .filter((r) => !r.isFuture)
      .map((r) => (r.isCurrent ? { ...r, projected: r.projected * elapsedThisHour } : r));

    return {
      hours,
      totals: sum(hours),
      soFar: sum(soFarRows),
      projectedDay: proj.reduce((a, b) => a + b, 0),
      labourBasis: usedActual && usedRostered ? "mixed" : usedActual ? "actual" : "rostered",
      hasProjection,
      projectionEstimated,
      deliveryTableMissing: delivery.data?.missing ?? false,
      isToday,
      nowHour,
      isLoading:
        sales.isLoading ||
        delivery.isLoading ||
        projections.isLoading ||
        shifts.isLoading ||
        entries.isLoading ||
        staffing.isLoading ||
        shapesLoading,
      isFetching:
        sales.isFetching || delivery.isFetching || shifts.isFetching || entries.isFetching,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sales.data, sales.isLoading, sales.isFetching,
    delivery.data, delivery.isLoading, delivery.isFetching,
    projections.data, projections.isLoading,
    shifts.data, shifts.isLoading, shifts.isFetching,
    entries.data, entries.isLoading, entries.isFetching,
    shapesLoading, shapeStamp, staffing.data, staffing.isLoading, fullDay,
    empById, isHoliday, cfg, tz, dateISO, isToday, isPast, nowHour, now.date, now.mod,
  ]);
}
