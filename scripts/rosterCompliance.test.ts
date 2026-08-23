/**
 * Unit tests for the roster compliance engine (src/lib/rosterCompliance.ts).
 *
 * The repo has no test runner — `scripts/run-tests.sh` stages this file and the
 * modules it needs into a temp folder (rewriting the "@/" alias) and runs it
 * with Node's built-in type stripping:
 *
 *   ./scripts/run-tests.sh
 */
import {
  detectRosterIssues,
  weeklyHoursBand,
  hoursCeiling,
  shiftInterval,
  dayNumber,
  mergeRosterCheckConfig,
  DEFAULT_COMPLIANCE,
  DEFAULT_RULES,
  ISSUE_CODES,
} from "@/lib/rosterCompliance";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else fails.push(`${name}${extra ? " — " + extra : ""}`);
}

const S = (
  id: string,
  employee_id: string | null,
  date: string,
  start_time: string,
  end_time: string,
  unpaid_break_minutes = 0,
  restaurant_id = "GW"
) => ({ id, restaurant_id, employee_id, date, start_time, end_time, unpaid_break_minutes });

const casual = { id: "e1", full_name: "Katie", employment_type: "casual" as const };
const pt = {
  id: "e2",
  full_name: "Nick",
  employment_type: "part_time" as const,
  contracted_hours: 20,
};
const minor = { id: "e3", full_name: "Jason", date_of_birth: "2010-05-01" };

// ── absolute time axis ────────────────────────────────────────────────────────
check("dayNumber is sequential", dayNumber("2026-08-25") - dayNumber("2026-08-24") === 1);
{
  const iv = shiftInterval(S("x", "e1", "2026-08-24", "17:00", "01:00"));
  check("overnight shift rolls past midnight", iv.end - iv.start === 8 * 60, String(iv.end - iv.start));
}

// ── overlap (same venue) ──────────────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    shifts: [
      S("a", "e1", "2026-08-24", "09:00", "15:00"),
      S("b", "e1", "2026-08-24", "14:00", "20:00"),
    ],
    employees: [casual],
  });
  check("overlap detected", issues.some((i) => i.code === "overlap" && i.severity === "error"));
  check("overlap not reported as double_booked", !issues.some((i) => i.code === "double_booked"));
}

// ── double booking across venues ──────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e1", "2026-08-24", "09:00", "17:00")],
    otherShifts: [S("z", "e1", "2026-08-24", "16:00", "22:00", 0, "TQ")],
    employees: [casual],
    venueNameById: new Map([["TQ", "Torquay"]]),
  });
  const d = issues.find((i) => i.code === "double_booked");
  check("cross-venue clash detected", !!d);
  check("names the other venue", !!d && d.message.includes("Torquay"), d?.message);
  check("only references this roster's shift", !!d && d.shiftIds.length === 1 && d.shiftIds[0] === "a");
}

// ── rest break ────────────────────────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    // close 22:00 Mon, open 08:00 Tue = 10 h exactly → fine
    shifts: [
      S("a", "e1", "2026-08-24", "14:00", "22:00"),
      S("b", "e1", "2026-08-25", "08:00", "14:00"),
    ],
    employees: [casual],
  });
  check("exactly 10 h rest is allowed", !issues.some((i) => i.code === "rest"));
}
{
  const issues = detectRosterIssues({
    shifts: [
      S("a", "e1", "2026-08-24", "14:00", "22:30"),
      S("b", "e1", "2026-08-25", "08:00", "14:00"),
    ],
    employees: [casual],
  });
  check("9.5 h rest flagged (clopening)", issues.some((i) => i.code === "rest"));
}
{
  // A pair made entirely of other-venue shifts is that roster's problem, not ours.
  const issues = detectRosterIssues({
    shifts: [],
    otherShifts: [
      S("y", "e1", "2026-08-24", "14:00", "23:00", 0, "TQ"),
      S("z", "e1", "2026-08-25", "08:00", "14:00", 0, "TQ"),
    ],
    employees: [casual],
  });
  check("other-venue-only pair is ignored", issues.length === 0, JSON.stringify(issues));
}

// ── meal break ────────────────────────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e1", "2026-08-24", "10:00", "16:30")],
    employees: [casual],
  });
  check("6.5 h with no break flagged", issues.some((i) => i.code === "no_break"));
}
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e1", "2026-08-24", "10:00", "16:30", 30)],
    employees: [casual],
  });
  check("6.5 h with a 30 min break is fine", !issues.some((i) => i.code === "no_break"));
}
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e1", "2026-08-24", "10:00", "14:30")],
    employees: [casual],
  });
  check("4.5 h needs no break", !issues.some((i) => i.code === "no_break"));
}

// ── long shift + weekly overtime ──────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e1", "2026-08-24", "08:00", "20:30", 30)],
    employees: [casual],
  });
  check("12 h paid shift flagged as long", issues.some((i) => i.code === "long_shift"));
}
{
  // 5 × 8 h = 40 h > 38
  const shifts = ["24", "25", "26", "27", "28"].map((d, i) =>
    S(`s${i}`, "e1", `2026-08-${d}`, "09:00", "17:30", 30)
  );
  const issues = detectRosterIssues({ shifts, employees: [casual] });
  const ot = issues.find((i) => i.code === "over_weekly");
  check("40 h flags weekly overtime", !!ot, ot?.message);
  check("overtime counts every own shift", !!ot && ot.shiftIds.length === 5);
}
{
  // Weekly hours combine across venues — 20 h here + 20 h at Torquay.
  const issues = detectRosterIssues({
    shifts: ["24", "25"].map((d, i) => S(`s${i}`, "e1", `2026-08-${d}`, "09:00", "19:00")),
    otherShifts: ["26", "27"].map((d, i) =>
      S(`o${i}`, "e1", `2026-08-${d}`, "09:00", "19:00", 0, "TQ")
    ),
    employees: [casual],
  });
  check("cross-venue hours roll into weekly overtime", issues.some((i) => i.code === "over_weekly"));
}
{
  // Part-timer 24 h against a 20 h contract → over_contract, not over_weekly.
  const issues = detectRosterIssues({
    shifts: ["24", "25", "26"].map((d, i) => S(`s${i}`, "e2", `2026-08-${d}`, "09:00", "17:00")),
    employees: [pt],
  });
  check("part-timer over contract flagged", issues.some((i) => i.code === "over_contract"));
  check("and not double-reported as weekly OT", !issues.some((i) => i.code === "over_weekly"));
}

// ── under-18 ──────────────────────────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e3", "2026-08-24", "17:00", "23:00", 30)],
    employees: [minor],
  });
  check("under-18 late finish flagged", issues.some((i) => i.code === "minor_late"));
}
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e3", "2026-08-24", "15:00", "21:00", 30)],
    employees: [minor],
  });
  check("under-18 inside the window is fine", !issues.some((i) => i.code === "minor_late"));
}
{
  const adult = { id: "e3", full_name: "Jason", date_of_birth: "1990-05-01" };
  const issues = detectRosterIssues({
    shifts: [S("a", "e3", "2026-08-24", "17:00", "23:00", 30)],
    employees: [adult],
  });
  check("adults are not minor-checked", !issues.some((i) => i.code === "minor_late"));
}

// ── public holiday ────────────────────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    shifts: [S("a", "e1", "2026-08-24", "10:00", "14:00")],
    employees: [casual],
    holidayNameByDate: new Map([["2026-08-24", "Melbourne Cup"]]),
  });
  const ph = issues.find((i) => i.code === "public_holiday");
  check("public holiday noted", !!ph && ph.severity === "info");
}

// ── hours banding ─────────────────────────────────────────────────────────────
check("casual ceiling is the weekly limit", hoursCeiling(casual) === 38);
check("part-timer ceiling is their contract", hoursCeiling(pt) === 20);
check("empty band", weeklyHoursBand(0, casual) === "empty");
check("casual 20 h is ok", weeklyHoursBand(20, casual) === "ok");
check("casual 35 h is near", weeklyHoursBand(35, casual) === "near");
check("casual 39 h is over", weeklyHoursBand(39, casual) === "over");
check("part-timer 12 h is under contract", weeklyHoursBand(12, pt) === "under");
check("part-timer 20 h is near", weeklyHoursBand(20, pt) === "near");
check("part-timer 22 h is over", weeklyHoursBand(22, pt) === "over");

// ── sorting ───────────────────────────────────────────────────────────────────
{
  const issues = detectRosterIssues({
    shifts: [
      S("a", "e1", "2026-08-24", "09:00", "15:00"),
      S("b", "e1", "2026-08-24", "14:00", "20:00"),
    ],
    employees: [casual],
    holidayNameByDate: new Map([["2026-08-24", "Melbourne Cup"]]),
  });
  check("errors sort before info", issues[0].severity === "error");
  check("info sorts last", issues[issues.length - 1].severity === "info");
}

// ── editable rule config ──────────────────────────────────────────────────────
const DEFAULTS = { options: DEFAULT_COMPLIANCE, rules: DEFAULT_RULES };

{
  const merged = mergeRosterCheckConfig(null, DEFAULTS);
  check("nothing stored gives the defaults", merged.options.restHours === 10);
  check("every check is present", ISSUE_CODES.every((c) => !!merged.rules[c]));
}
{
  const merged = mergeRosterCheckConfig(
    { options: { restHours: 12, weeklyHours: 30, bogus: 5 } },
    DEFAULTS
  );
  check("stored thresholds win", merged.options.restHours === 12 && merged.options.weeklyHours === 30);
  check("untouched thresholds keep the default", merged.options.minBreakMinutes === 30);
  check("unknown keys are ignored", !("bogus" in merged.options));
}
{
  // A check added in a later build isn't in an older saved config — it must
  // come back ON rather than silently vanishing.
  const merged = mergeRosterCheckConfig(
    { rules: { rest: { enabled: false, severity: "info" } } },
    DEFAULTS
  );
  check("a stored rule is applied", merged.rules.rest.enabled === false);
  check("rules missing from the save default to on", merged.rules.no_break.enabled === true);
  check("a bad severity falls back", mergeRosterCheckConfig({ rules: { rest: { severity: "nope" } } }, DEFAULTS).rules.rest.severity === "warning");
}
{
  // A disabled check produces nothing.
  const shifts = [S("a", "e1", "2026-08-24", "10:00", "16:30")];
  const on = detectRosterIssues({ shifts, employees: [casual], rules: DEFAULT_RULES });
  check("no_break fires when enabled", on.some((i) => i.code === "no_break"));
  const off = detectRosterIssues({
    shifts,
    employees: [casual],
    rules: { ...DEFAULT_RULES, no_break: { enabled: false, severity: "warning" } },
  });
  check("no_break is silenced when disabled", !off.some((i) => i.code === "no_break"));
}
{
  // Promoting a check to "must fix" must also move it to the top of the list.
  const issues = detectRosterIssues({
    shifts: [S("a", "e1", "2026-08-24", "10:00", "16:30")],
    employees: [casual],
    holidayNameByDate: new Map([["2026-08-24", "Melbourne Cup"]]),
    rules: { ...DEFAULT_RULES, no_break: { enabled: true, severity: "error" } },
  });
  check("severity override applies", issues[0].code === "no_break" && issues[0].severity === "error");
}
{
  // Thresholds are configurable end to end: a 6 h break rule leaves a 5.5 h
  // shift alone.
  const shifts = [S("a", "e1", "2026-08-24", "10:00", "15:30")];
  check(
    "default 5 h break rule flags a 5.5 h shift",
    detectRosterIssues({ shifts, employees: [casual] }).some((i) => i.code === "no_break")
  );
  check(
    "raising the threshold to 6 h clears it",
    !detectRosterIssues({
      shifts,
      employees: [casual],
      options: { breakAfterHours: 6 },
    }).some((i) => i.code === "no_break")
  );
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("  FAIL: " + f);
process.exit(fails.length ? 1 : 0);
