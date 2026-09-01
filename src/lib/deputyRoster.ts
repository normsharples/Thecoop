import { parseCSV, toObjects, findHeader } from "@/lib/csv";

export interface ArchiveRow {
  external_id: string | null;
  work_date: string;          // yyyy-MM-dd
  start_time: string;         // ISO
  end_time: string;           // ISO
  mealbreak_minutes: number;
  total_hours: number | null;
  cost: number | null;
  area_name: string | null;
  employee_name: string;
  comment: string | null;
  published: boolean | null;
  is_open_shift: boolean;
  raw: Record<string, string>;
}

export interface ParseResult {
  rows: ArchiveRow[];
  skipped: { line: number; reason: string; raw: Record<string, string> }[];
  headers: string[];
  mapped: Record<string, string | null>;
}

// Deputy's exporter and its Resource API disagree on casing/spacing, and the
// column set differs by export template — so accept every name we've seen.
const ALIASES = {
  id:        ["Id", "RosterId", "Roster Id", "Shift Id"],
  date:      ["Date", "Shift Date", "Work Date", "Start Date"],
  start:     ["StartTime", "Start Time", "Start", "Shift Start"],
  end:       ["EndTime", "End Time", "End", "Shift End"],
  meal:      ["Mealbreak", "Meal Break", "Break", "Meal Break Minutes", "Unpaid Break"],
  total:     ["TotalTime", "Total Time", "Total Hours", "Hours"],
  cost:      ["Cost", "Total Cost", "Wage Cost"],
  area:      ["OperationalUnitName", "Operational Unit", "Area", "Area Name", "Location Area"],
  employee:  ["EmployeeName", "Employee Name", "Employee", "Team Member", "Name"],
  comment:   ["Comment", "Notes", "Shift Notes"],
  published: ["Published"],
  open:      ["Open", "Open Shift", "Unassigned"],
};

const truthy = (v: string) => ["1", "true", "yes", "y", "t"].includes(v.trim().toLowerCase());

/**
 * Deputy exports times as either a unix timestamp, an ISO datetime, or a bare
 * clock time that only makes sense alongside the Date column. Handle all three
 * rather than assuming — the export template decides which you get.
 */
function toISO(value: string, dateISO: string): string | null {
  const v = value.trim();
  if (!v) return null;

  // Unix seconds (Deputy's API form).
  if (/^\d{9,11}$/.test(v)) return new Date(Number(v) * 1000).toISOString();
  // Unix milliseconds.
  if (/^\d{12,14}$/.test(v)) return new Date(Number(v)).toISOString();

  // Bare clock time: "9:00", "09:00:00", "5:30 PM".
  const clock = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
  if (clock && dateISO) {
    let h = Number(clock[1]);
    const m = Number(clock[2]);
    const ampm = clock[4]?.toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const d = new Date(`${dateISO}T00:00:00`);
    d.setHours(h, m, Number(clock[3] ?? 0), 0);
    return d.toISOString();
  }

  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toDateISO(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Australian day-first, which is what an AU Deputy account exports.
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{9,11}$/.test(s)) return new Date(Number(s) * 1000).toISOString().slice(0, 10);
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Mealbreak arrives as minutes, as "0:30", or as decimal hours. */
function toMinutes(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  const hm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const n = Number(s);
  if (Number.isNaN(n)) return 0;
  // A value under 8 is far more likely to be hours than minutes.
  return n > 0 && n < 8 && !Number.isInteger(n) ? Math.round(n * 60) : Math.round(n);
}

const num = (v: string): number | null => {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) || v.trim() === "" ? null : n;
};

export function parseDeputyRoster(text: string): ParseResult {
  const grid = parseCSV(text);
  const objects = toObjects(grid);
  const headers = grid[0]?.map((h) => h.trim()) ?? [];

  const col = Object.fromEntries(
    Object.entries(ALIASES).map(([k, a]) => [k, findHeader(headers, a)])
  ) as Record<keyof typeof ALIASES, string | null>;

  const rows: ArchiveRow[] = [];
  const skipped: ParseResult["skipped"] = [];

  objects.forEach((o, i) => {
    const line = i + 2; // 1-indexed, plus the header row
    const rawDate = col.date ? o[col.date] : "";
    const work_date = toDateISO(rawDate ?? "");
    if (!work_date) {
      skipped.push({ line, reason: "No usable date", raw: o });
      return;
    }

    const start_time = col.start ? toISO(o[col.start], work_date) : null;
    const end_time = col.end ? toISO(o[col.end], work_date) : null;
    if (!start_time || !end_time) {
      skipped.push({ line, reason: "Missing start or finish time", raw: o });
      return;
    }

    const employee_name = (col.employee ? o[col.employee] : "").trim();
    const is_open_shift = col.open ? truthy(o[col.open]) : employee_name === "";
    if (!employee_name && !is_open_shift) {
      skipped.push({ line, reason: "No team member on the row", raw: o });
      return;
    }

    rows.push({
      external_id: col.id ? o[col.id] || null : null,
      work_date,
      // A finish at or before the start rolls past midnight.
      start_time,
      end_time:
        new Date(end_time) <= new Date(start_time)
          ? new Date(new Date(end_time).getTime() + 24 * 3600 * 1000).toISOString()
          : end_time,
      mealbreak_minutes: col.meal ? toMinutes(o[col.meal]) : 0,
      total_hours: col.total ? num(o[col.total]) : null,
      cost: col.cost ? num(o[col.cost]) : null,
      area_name: col.area ? o[col.area] || null : null,
      employee_name: employee_name || "(open shift)",
      comment: col.comment ? o[col.comment] || null : null,
      published: col.published ? truthy(o[col.published]) : null,
      is_open_shift,
      raw: o,
    });
  });

  return { rows, skipped, headers, mapped: col };
}
