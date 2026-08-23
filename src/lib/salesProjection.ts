// ============================================================================
// Hourly sales projection.
//
// Projects an hour-by-hour sales curve for a target date by blending the SAME
// WEEKDAY last year and the SAME WEEKDAY last week, then applying a growth
// factor. Missing sources are dropped and the remaining weight renormalised, so
// (while sales_transactions history is still short) a venue with only last-week
// data still projects sensibly.
// ============================================================================

export interface HourlyBlendWeights {
  lyWeight: number; // same weekday last year
  lwWeight: number; // same weekday last week
}

/**
 * Project one day's 24-hour sales curve.
 * `lyHours` / `lwHours` are length-24 arrays; use `null` for an hour with NO
 * historical data (distinct from a real $0), so it can be excluded from the
 * blend rather than dragging the average down.
 */
export function projectDayHours(
  lyHours: (number | null)[],
  lwHours: (number | null)[],
  weights: HourlyBlendWeights,
  growthFactor: number // 1.05 = +5%
): number[] {
  const out = new Array<number>(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const ly = lyHours[h] ?? null;
    const lw = lwHours[h] ?? null;
    const haveLy = ly != null;
    const haveLw = lw != null;
    if (!haveLy && !haveLw) {
      out[h] = 0;
      continue;
    }
    let wl = haveLy ? weights.lyWeight : 0;
    let wk = haveLw ? weights.lwWeight : 0;
    const denom = wl + wk;
    if (denom <= 0) {
      // Both weights zero but data exists — fall back to a plain mean.
      const vals = [haveLy ? ly! : null, haveLw ? lw! : null].filter(
        (v): v is number => v != null
      );
      out[h] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * growthFactor : 0;
      continue;
    }
    const base = ((haveLy ? ly! * wl : 0) + (haveLw ? lw! * wk : 0)) / denom;
    out[h] = Math.max(0, base * growthFactor);
  }
  return out;
}

const clampGrowth = (x: number) => Math.min(2, Math.max(0.5, x)); // -50%..+100%

/**
 * Growth multiplier applied to the blended base. When `auto`:
 *   1. year-on-year — recent window vs the same window last year (preferred);
 *   2. week-on-week — recent window vs the immediately-preceding window, used
 *      when there's no year-ago data yet;
 *   3. the manual % — when neither comparison has data.
 * Ratios are clamped to a sane band so a data glitch can't blow the roster out.
 */
export function growthFactor(opts: {
  auto: boolean;
  manualPct: number;
  recentTotal: number | null; // sum over a recent window
  yearAgoTotal: number | null; // same window last year (year-on-year)
  priorPeriodTotal?: number | null; // the window just before recent (week-on-week)
}): number {
  const manual = 1 + (opts.manualPct || 0) / 100;
  if (!opts.auto) return manual;
  if (opts.recentTotal != null && opts.yearAgoTotal != null && opts.yearAgoTotal > 0) {
    return clampGrowth(opts.recentTotal / opts.yearAgoTotal);
  }
  if (opts.recentTotal != null && opts.priorPeriodTotal != null && opts.priorPeriodTotal > 0) {
    return clampGrowth(opts.recentTotal / opts.priorPeriodTotal); // WoW fallback
  }
  return manual;
}
