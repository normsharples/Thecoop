# The Coop — Payroll & Timesheets Design

Designed via grill session (2026-08). Built after the rostering subsystem (migrations 042–051).
Award: **Fast Food Industry Award MA000003** (Australia). Country: AU. Super/loading already in `app_settings` 'payroll'.

## Locked decisions

**Actual hours source** — In-app clock in/out with manager approval. The Coop becomes the
system of record for worked hours, phasing Deputy out gradually (Deputy stays source of truth
for `labour_daily` until Coop matches it).

**Clock method** — Both a shared in-venue **kiosk** (store tablet, staff pick name + 4-digit PIN)
and **personal phone** (authenticated portal button). No GPS geofence in v1.

**Breaks** — Staff punch break start/end (one unpaid meal break per shift in v1). Paid time =
worked − measured break.

**Approval** — Auto-approve punches within **±15 min** of the rostered shift (tolerance editable
in Payroll settings); variances flag to the store manager's review queue. Nothing outside
tolerance is payable until a manager approves.

**Pay engine** — **Full award interpretation** (MA000003), built in layers. The Coop **holds the
rates and computes gross itself** (user accepted the July-sync upkeep) — needed anyway for
in-app SPMH / wage-% accuracy. Buckets: ordinary / Saturday / Sunday / public holiday / overtime,
plus junior % and casual loading + super.

**Junior rates** — Auto-derived from **date of birth**; award junior % by age, stepped up on
birthdays.

**Public holidays** — Per store's **state** (`restaurants.state`); dates seeded per state/year,
confirmed annually by the operator.

**Salaried staff** — Clock in/out for attendance + accurate labour cost, but pay = `salary_annual/52`
(no penalty/OT). Feed cost cards, not gross buckets.

**Output** — **Xero CSV** export. The Coop stops short of tax/PAYG/STP — Xero handles those and
payslips. Pay period: **weekly**.

**Visibility** — Store managers see their **own store's** pay + rates. Area managers + superadmin
see all. Team members see **own hours only, no dollars** in the portal.

## Build phasing (each usable alone, validated against Deputy before the next)

- **T1 Capture** — clock in/out/break (kiosk + phone), auto-approve/exception flags, manager
  weekly timesheet review, PIN + DOB setup. `time_entries` schema.
- **T2 Classify** — MA000003 award classifier: split approved hours into earnings buckets;
  junior % by DOB; public-holiday calendar per state.
- **T3 Gross** — gross + super + casual loading from a maintainable rates table; salaried = annual/52;
  feed SPMH / wage-% cards.
- **T4 Export** — weekly pay-run screen + Xero CSV; reconcile vs Deputy `labour_daily`; cutover.

## T1 technical notes

- **Kiosk auth**: no device-token system. Kiosk runs under a logged-in manager session (store scope
  via `has_roster_manage`); staff identity confirmed by a 4-digit PIN checked server-side by a
  `SECURITY DEFINER` RPC (`verify_pin`) using **pgcrypto** `crypt()`. PIN hashes never leave the DB.
- **Phone**: authenticated employee inserts own `time_entries` row (`employee_id = auth.uid()`).
- **time_entries**: one row per shift/day; single unpaid break pair; `worked_minutes` + `approval_status`
  (`pending`/`auto_approved`/`flagged`/`approved`/`rejected`) + `flag_reason` set by a finalize
  trigger on clock-out comparing to the matching shift within tolerance.
- New profile cols: `pin_hash`, `date_of_birth`. New restaurant col: `state`.
