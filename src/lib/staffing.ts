// ============================================================================
// Staffing demand model + shift generation.
//
// The staffing matrix ("sales vs required staff") says, for each hour's
// projected sales, which station SLOTS must be filled. This turns that into a
// set of shifts: one shift per person, each at least `minShiftHours` long, with
// an unpaid break added to shifts longer than `breakThresholdHours`.
// ============================================================================

import type { StaffingMatrixRow } from "@/types";

export interface DemandParams {
  openHour: number; // local hour the venue opens
  closeHour: number; // local hour it closes (exclusive)
  minShiftHours: number;
  breakThresholdHours: number;
  breakMinutes: number;
  // Merge gaps up to this many hours within a station's coverage so a brief
  // slow hour doesn't spawn an extra (overlapping) shift. 0 = split on any gap.
  maxGapBridgeHours: number;
}

// Duplicate slots on the same station stack into a per-hour COUNT. Group by the
// mapped position when set, else by station name.
function groupKey(row: { position_id: string | null; station_name: string }): string {
  return row.position_id ? `pos:${row.position_id}` : `name:${row.station_name.toLowerCase()}`;
}

export interface StationGroup {
  key: string;
  station_name: string;
  position_id: string | null;
  perHour: number[]; // required headcount for this station by hour (length 24)
}

/**
 * For a day's hourly sales, how many people each station needs each hour.
 * A slot counts for an hour when that hour's sales ≥ the slot's threshold.
 */
export function requiredByStation(
  matrix: StaffingMatrixRow[],
  hourlySales: number[],
  params: DemandParams
): StationGroup[] {
  const active = matrix.filter((r) => r.active);
  const groups = new Map<string, StationGroup>();
  for (const r of active) {
    const key = groupKey(r);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        station_name: r.station_name,
        position_id: r.position_id,
        perHour: new Array<number>(24).fill(0),
      });
    }
  }
  for (let h = params.openHour; h < params.closeHour; h++) {
    const sales = hourlySales[h] ?? 0;
    if (sales <= 0) continue;
    for (const r of active) {
      if (sales >= r.threshold_sales) groups.get(groupKey(r))!.perHour[h] += 1;
    }
  }
  return [...groups.values()];
}

export interface GenShift {
  station_name: string;
  position_id: string | null;
  startHour: number; // integer hour
  endHour: number; // integer hour (exclusive)
  breakMinutes: number;
}

/**
 * Cover a station's per-hour headcount curve with shifts, via layered
 * decomposition: layer k is a shift for every maximal run of hours needing ≥ k
 * people. Each shift is then padded up to the minimum length (extending later
 * first, then earlier, within opening hours) and given a break if it runs long.
 */
export function generateStationShifts(
  group: StationGroup,
  params: DemandParams
): GenShift[] {
  const { perHour } = group;
  const maxCount = perHour.reduce((m, v) => (v > m ? v : m), 0);
  const shifts: GenShift[] = [];
  const maxGap = Math.max(0, Math.floor(params.maxGapBridgeHours ?? 0));
  for (let layer = 1; layer <= maxCount; layer++) {
    let h = params.openHour;
    while (h < params.closeHour) {
      if (perHour[h] >= layer) {
        const runStart = h;
        // Extend the run across dips of up to `maxGap` hours, so a brief slow
        // hour mid-service doesn't create a second overlapping shift.
        let runEnd = h + 1; // exclusive; last qualifying hour + 1
        let gap = 0;
        for (let k = h + 1; k < params.closeHour; k++) {
          if (perHour[k] >= layer) {
            runEnd = k + 1;
            gap = 0;
          } else {
            gap++;
            if (gap > maxGap) break;
          }
        }

        // Pad to the minimum shift length.
        let s = runStart;
        let e = runEnd;
        if (e - s < params.minShiftHours) {
          const extendEnd = Math.min(params.closeHour - e, params.minShiftHours - (e - s));
          e += extendEnd;
          const stillShort = params.minShiftHours - (e - s);
          if (stillShort > 0) s = Math.max(params.openHour, s - stillShort);
        }

        const gross = e - s;
        const breakMinutes = gross > params.breakThresholdHours ? params.breakMinutes : 0;
        shifts.push({
          station_name: group.station_name,
          position_id: group.position_id,
          startHour: s,
          endHour: e,
          breakMinutes,
        });
        h = runEnd; // resume scanning after the original run
      } else {
        h++;
      }
    }
  }
  return shifts;
}

/** All generated shifts for a day, across every station. */
export function generateDayShifts(
  matrix: StaffingMatrixRow[],
  hourlySales: number[],
  params: DemandParams
): GenShift[] {
  return requiredByStation(matrix, hourlySales, params).flatMap((g) =>
    generateStationShifts(g, params)
  );
}

// ── Which stations does a given hourly-sales figure require? (live tester) ────
export function stationsForSales(
  matrix: StaffingMatrixRow[],
  sales: number
): string[] {
  return matrix
    .filter((r) => r.active && sales >= r.threshold_sales)
    .sort((a, b) => a.slot_order - b.slot_order)
    .map((r) => r.station_name);
}

// ── Default templates seeded from Norm's "Sales vs required staff" sheet ──────
export interface StaffingTemplateRow {
  station_name: string;
  threshold_sales: number;
}

export const STAFFING_TEMPLATES: Record<string, StaffingTemplateRow[]> = {
  "Geelong West": [
    { station_name: "Kitchen Hand", threshold_sales: 100 },
    { station_name: "POS", threshold_sales: 100 },
    { station_name: "PASS", threshold_sales: 300 },
    { station_name: "FRYER", threshold_sales: 800 },
    { station_name: "SALAD", threshold_sales: 1200 },
    { station_name: "CHICKEN", threshold_sales: 1900 },
    { station_name: "PRESENT", threshold_sales: 2600 },
    { station_name: "FRYER", threshold_sales: 3300 },
  ],
  Torquay: [
    { station_name: "Kitchen Hand", threshold_sales: 100 },
    { station_name: "POS", threshold_sales: 100 },
    { station_name: "PASS", threshold_sales: 300 },
    { station_name: "FRYER", threshold_sales: 700 },
    { station_name: "SALAD", threshold_sales: 1200 },
    { station_name: "CHICKEN", threshold_sales: 1900 },
    { station_name: "PRESENT", threshold_sales: 2600 },
    { station_name: "FRYER", threshold_sales: 3300 },
  ],
};
