import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseISO, subDays, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { mondayOf, toISODate } from "@/lib/roster";
import type { StaffingConfig } from "@/types";

export interface DayProjection {
  hours: number[]; // projected $ per hour (length 24), summing to `total`
  total: number; // the entered daily projection (0 if none)
  hasProjection: boolean; // a projection was entered for this date
  shapeDate: string | null; // reference date whose hourly split was used
  estimated: boolean; // true = no same-weekday shape, used the week's avg shape
  evenSpread: boolean; // true = no history at all, split evenly
}

interface ShapeRow {
  weekday: number; // 0=Sun..6=Sat (JS getDay)
  business_date: string;
  hour: number;
  amount: number | string;
}

/**
 * Sales projection, Norm's model (rev 22 Aug):
 *   • DAY TOTAL = the figure entered in Projections (daily_projections) for that
 *     date — the source of truth. No figure → the day is skipped (no shifts).
 *   • HOURLY SHAPE = the sales-by-hour split of the most recent COMPLETED
 *     same-weekday (from the last full week, walking back week-by-week if that
 *     weekday has no data), scaled so the hours sum exactly to the day total.
 *   • No growth factor — the entered total already reflects the forecast.
 */
export function useSalesProjection(
  restaurantId: string | null,
  weekDates: string[],
  config: StaffingConfig | null
) {
  const openHour = config?.open_hour ?? 10;
  const closeHour = config?.close_hour ?? 21;

  // Reference window = the last full completed week and up to 12 weeks before it
  // (so a missing weekday can walk back to an earlier week).
  const refWindow = useMemo(() => {
    const thisMonday = mondayOf(new Date());
    const refSunday = subDays(thisMonday, 1); // Sunday of last full week
    const from = subDays(refSunday, 7 * 12 - 1);
    return {
      from: toISODate(from),
      to: toISODate(refSunday),
      refMondayLabel: format(subDays(refSunday, 6), "d MMM"),
    };
  }, []);

  // Entered daily projections for the roster week.
  const { data: projByDate, isLoading: loadingProj } = useQuery({
    queryKey: ["proj-daily", restaurantId, weekDates],
    queryFn: async () => {
      const m = new Map<string, number>();
      if (!restaurantId || !weekDates.length) return m;
      const { data, error } = await supabase
        .from("daily_projections")
        .select("date, projected_sales")
        .eq("restaurant_id", restaurantId)
        .in("date", weekDates);
      if (error) throw error;
      for (const r of (data ?? []) as { date: string; projected_sales: number }[]) {
        m.set(r.date, r.projected_sales ?? 0);
      }
      return m;
    },
    enabled: !!restaurantId && weekDates.length > 0,
  });

  // Reference hourly shape per weekday, aggregated server-side (≤7×24 rows, so
  // no 1000-row API truncation dropping whole days).
  const { data: shapeRows, isLoading: loadingRef } = useQuery({
    queryKey: ["proj-refshape", restaurantId, refWindow.to],
    queryFn: async () => {
      if (!restaurantId) return [] as ShapeRow[];
      const { data, error } = await supabase.rpc("roster_weekday_hourly_shapes", {
        p_restaurant_id: restaurantId,
        p_before: refWindow.to,
      });
      if (error) throw error;
      return (data ?? []) as ShapeRow[];
    },
    enabled: !!restaurantId,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const proj = projByDate ?? new Map<string, number>();
    const rows = shapeRows ?? [];

    // Assemble per-weekday hourly arrays from the aggregated rows.
    const rawByWd = new Map<number, { date: string; hours: number[] }>();
    for (const r of rows) {
      let e = rawByWd.get(r.weekday);
      if (!e) {
        e = { date: r.business_date, hours: new Array(24).fill(0) };
        rawByWd.set(r.weekday, e);
      }
      e.hours[r.hour] += Number(r.amount ?? 0);
    }

    // Normalise each weekday to fractions of its day total.
    const shapeByWeekday = new Map<number, { date: string; frac: number[] }>();
    for (const [wd, e] of rawByWd) {
      const sum = e.hours.reduce((a, v) => a + v, 0);
      if (sum > 0) shapeByWeekday.set(wd, { date: e.date, frac: e.hours.map((v) => v / sum) });
    }

    // Average of every available weekday shape — used only if a specific weekday
    // has no history of its own (better than a flat spread).
    let avgFrac: number[] | null = null;
    const valid = [...shapeByWeekday.values()];
    if (valid.length) {
      const acc = new Array(24).fill(0);
      for (const s of valid) for (let h = 0; h < 24; h++) acc[h] += s.frac[h];
      const tot = acc.reduce((a, b) => a + b, 0);
      avgFrac = tot > 0 ? acc.map((v) => v / tot) : null;
    }

    const openCount = Math.max(1, closeHour - openHour);
    const projectedByDate = new Map<string, number[]>();
    const detailByDate = new Map<string, DayProjection>();

    for (const d of weekDates) {
      const total = proj.get(d) ?? 0;
      const hasProjection = proj.has(d) && total > 0;
      const wd = parseISO(d).getDay();
      const shape = shapeByWeekday.get(wd) ?? null;

      let hours: number[];
      let estimated = false;
      let evenSpread = false;
      let shapeDate: string | null = null;

      if (!hasProjection) {
        hours = new Array(24).fill(0);
      } else if (shape) {
        hours = shape.frac.map((f) => f * total);
        shapeDate = shape.date;
      } else if (avgFrac) {
        // No history for this weekday → shape from the week's average curve.
        hours = avgFrac.map((f) => f * total);
        estimated = true;
      } else {
        // No hourly history at all → spread evenly across open hours.
        hours = new Array(24).fill(0);
        for (let h = openHour; h < closeHour; h++) hours[h] = total / openCount;
        evenSpread = true;
      }

      projectedByDate.set(d, hours);
      detailByDate.set(d, { hours, total, hasProjection, shapeDate, estimated, evenSpread });
    }

    return {
      projectedByDate,
      detailByDate,
      refWeekLabel: refWindow.refMondayLabel,
      isLoading: loadingProj || loadingRef,
    };
  }, [projByDate, shapeRows, weekDates, openHour, closeHour, refWindow, loadingProj, loadingRef]);
}
