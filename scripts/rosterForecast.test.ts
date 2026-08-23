/**
 * Unit tests for the day-view forecast maths (src/lib/rosterForecast.ts).
 * Run with ./scripts/run-tests.sh
 */
import {
  scheduledHoursByHour,
  idealHoursByHour,
  breakWindow,
  buildForecast,
  buildWeekForecast,
  hourLabel,
  demandParamsFrom,
} from "@/lib/rosterForecast";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else fails.push(`${name}${extra ? " — " + extra : ""}`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const shift = (
  start_time: string,
  end_time: string,
  unpaid_break_minutes = 0,
  break_start: string | null = null,
  position_id: string | null = null
) =>
  ({
    id: `s-${start_time}-${end_time}`,
    restaurant_id: "GW",
    employee_id: "e1",
    date: "2026-08-24",
    start_time,
    end_time,
    unpaid_break_minutes,
    break_start,
    position_id,
    note: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  }) as never;

const config = {
  restaurant_id: "GW",
  ly_weight: 0,
  lw_weight: 0,
  growth_pct: 0,
  growth_auto: false,
  open_hour: 10,
  close_hour: 21,
  min_shift_hours: 3,
  break_threshold_hours: 5,
  break_minutes: 30,
  created_at: "",
  updated_at: "",
} as never;

const row = (
  station_name: string,
  threshold_sales: number,
  position_id: string | null = null,
  slot_order = 0
) =>
  ({
    id: `${station_name}-${threshold_sales}`,
    restaurant_id: "GW",
    station_name,
    position_id,
    threshold_sales,
    slot_order,
    active: true,
    created_at: "",
    updated_at: "",
  }) as never;

// ── scheduled hours per clock hour ────────────────────────────────────────────
{
  const h = scheduledHoursByHour([shift("09:00", "17:00")]);
  check("full hours are 1.0 each", near(h[9], 1) && near(h[16], 1));
  check("hours outside the shift are 0", near(h[8], 0) && near(h[17], 0));
  check("8 h shift totals 8", near(h.reduce((a, b) => a + b, 0), 8));
}
{
  const h = scheduledHoursByHour([shift("09:30", "11:00")]);
  check("part hours are fractional", near(h[9], 0.5) && near(h[10], 1));
  check("1.5 h shift totals 1.5", near(h.reduce((a, b) => a + b, 0), 1.5));
}
{
  // 9–17 with a 30 min break defaults to centred: 12:45–13:15.
  const s = shift("09:00", "17:00", 30);
  const w = breakWindow(s);
  check("break centres by default", !!w && w.start === 12 * 60 + 45, String(w?.start));
  const h = scheduledHoursByHour([s]);
  check("break is deducted from the total", near(h.reduce((a, b) => a + b, 0), 7.5));
  check("break splits across its two hours", near(h[12], 0.75) && near(h[13], 0.75));
}
{
  const s = shift("09:00", "17:00", 30, "15:00");
  const w = breakWindow(s);
  check("a stored break_start wins", !!w && w.start === 15 * 60);
  const h = scheduledHoursByHour([s]);
  check("stored break lands in its own hour", near(h[15], 0.5));
}
{
  const h = scheduledHoursByHour([shift("22:00", "02:00")]);
  check("overnight keeps the pre-midnight part", near(h[22], 1) && near(h[23], 1));
  check("overnight tail belongs to the next day", near(h.reduce((a, b) => a + b, 0), 2));
}
{
  const h = scheduledHoursByHour([shift("17:00", "21:00"), shift("18:00", "21:00")]);
  check("two people on at once stack", near(h[18], 2) && near(h[17], 1));
}

// ── ideal hours per clock hour ────────────────────────────────────────────────
{
  const params = demandParamsFrom(config);
  const matrix = [row("Front", 0), row("Front", 800), row("Grill", 400, "pos-grill")];
  const sales = new Array(24).fill(0);
  sales[11] = 300; // Front only
  sales[12] = 500; // Front + Grill
  sales[18] = 900; // Front ×2 + Grill
  const all = idealHoursByHour(matrix, sales, params, null);
  check("one slot below every other threshold", near(all[11], 1), String(all[11]));
  check("a second station joins at its threshold", near(all[12], 2), String(all[12]));
  check("duplicate station rows stack", near(all[18], 3), String(all[18]));
  check("closed hours need nobody", near(all[9], 0) && near(all[22], 0));

  const grillOnly = idealHoursByHour(matrix, sales, params, new Set(["pos-grill"]));
  check("area filter keeps only its stations", near(grillOnly[18], 1) && near(grillOnly[11], 0));

  const unmapped = idealHoursByHour(matrix, sales, params, new Set(["pos-other"]));
  check("unmapped stations are excluded by an area filter", near(unmapped[18], 0));
}

// ── assembling the plot ───────────────────────────────────────────────────────
{
  const sales = new Array(24).fill(0);
  for (let h = 10; h < 21; h++) sales[h] = 200;
  const res = buildForecast({
    shifts: [shift("11:00", "19:00", 30)],
    matrix: [row("Front", 0)],
    hourlySales: sales,
    config,
    positionIds: null,
  });
  check("window pads an hour either side of opening", res.points[0].hour === 9);
  check("window pads an hour past close", res.points[res.points.length - 1].hour === 21);
  check("sales total matches the projection", near(res.totals.sales, 200 * 11));
  check("ideal totals the open hours", near(res.totals.ideal, 11));
  check("rostered total is break-adjusted", near(res.totals.scheduled, 7.5));
  check("not flagged empty", !res.empty);
  check("labels read as clock hours", res.points[0].label === "9am");
}
{
  const res = buildForecast({
    shifts: [],
    matrix: [],
    hourlySales: new Array(24).fill(0),
    config,
    positionIds: null,
  });
  check("nothing to plot is flagged empty", res.empty && res.points.length === 0);
}
{
  // No projection, but shifts exist — the rostered line should still draw.
  const res = buildForecast({
    shifts: [shift("11:00", "15:00")],
    matrix: [],
    hourlySales: new Array(24).fill(0),
    config,
    positionIds: null,
  });
  check("rostered hours plot without a projection", !res.empty && near(res.totals.scheduled, 4));
}

// ── week graph ────────────────────────────────────────────────────────────────
const WEEK = [
  "2026-08-24", "2026-08-25", "2026-08-26",
  "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30",
];
const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const dayShift = (date: string, start: string, end: string, brk = 0) =>
  ({
    id: `${date}-${start}`,
    restaurant_id: "GW",
    employee_id: "e1",
    date,
    start_time: start,
    end_time: end,
    unpaid_break_minutes: brk,
    break_start: null,
    position_id: null,
    note: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  }) as never;

{
  const hourly = new Array(24).fill(0);
  for (let h = 10; h < 21; h++) hourly[h] = 100; // $1,100/day
  const projectedByDate = new Map(WEEK.map((d) => [d, hourly]));
  const res = buildWeekForecast({
    days: WEEK,
    shifts: [dayShift("2026-08-24", "11:00", "19:00", 30), dayShift("2026-08-26", "12:00", "16:00")],
    matrix: [row("Front", 0)],
    projectedByDate,
    config,
    positionIds: null,
    dayLabels: LABELS,
  });
  check("one point per day", res.points.length === 7);
  check("labels are weekdays", res.points[0].label === "Mon" && res.points[6].label === "Sun");
  check("points carry their date", res.points[0].date === "2026-08-24");
  check("week sales total", near(res.totals.sales, 1100 * 7));
  check("week ideal total", near(res.totals.ideal, 11 * 7));
  check("week rostered total", near(res.totals.scheduled, 7.5 + 4));
  check("rostered lands on the right days", near(res.points[0].scheduled, 7.5) && near(res.points[2].scheduled, 4));
  check("days with no shifts are zero", near(res.points[1].scheduled, 0));
  check("week is not flagged empty", !res.empty);
}
{
  // A week bar must equal that day's own graph total — same engine, both ways.
  const hourly = new Array(24).fill(0);
  for (let h = 10; h < 21; h++) hourly[h] = 150;
  const shiftsOnDay = [dayShift("2026-08-24", "11:00", "19:00", 30)];
  const week = buildWeekForecast({
    days: WEEK,
    shifts: shiftsOnDay,
    matrix: [row("Front", 0), row("Front", 100)],
    projectedByDate: new Map([["2026-08-24", hourly]]),
    config,
    positionIds: null,
    dayLabels: LABELS,
  });
  const day = buildForecast({
    shifts: shiftsOnDay,
    matrix: [row("Front", 0), row("Front", 100)],
    hourlySales: hourly,
    config,
    positionIds: null,
  });
  check("week bar equals the day graph total (sales)", near(week.points[0].sales, day.totals.sales));
  check("week bar equals the day graph total (ideal)", near(week.points[0].ideal, day.totals.ideal));
  check("week bar equals the day graph total (rostered)", near(week.points[0].scheduled, day.totals.scheduled));
}
{
  const res = buildWeekForecast({
    days: WEEK,
    shifts: [],
    matrix: [],
    projectedByDate: new Map(),
    config,
    positionIds: null,
    dayLabels: LABELS,
  });
  check("an empty week is flagged empty", res.empty);
}

check("hour labels", hourLabel(0) === "12am" && hourLabel(12) === "12pm" && hourLabel(17) === "5pm");

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("  FAIL: " + f);
process.exit(fails.length ? 1 : 0);
