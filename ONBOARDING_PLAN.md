# The Coop — Onboarding & Employment Contracts

Design locked via grill-me, 22 Aug 2026. Sits on top of [rostering](ROSTER_DASHBOARD.md) and
[payroll](PAYROLL_PLAN.md). Migration series **063+**.

## The shape (locked decisions)

| Decision | Choice |
|---|---|
| Who enters details | **Admin starts, employee finishes.** Superadmin creates the account (name, username, password, role, home store, employment type, award level, pay rate, start date); the employee completes the rest on first login. |
| Scope | Anyone with `is_rosterable = true`, with a per-person override on the create form. |
| Gate | **Hard gate** (full-screen `/onboarding`, all other routes redirect) for `team_member` + `staff`. **Soft gate** (wizard on login with "Continue to dashboard" + persistent banner) for `manager` and above. **Clock in/out is NEVER gated** — nobody works unpaid because of paperwork. |
| Existing team | Gate everyone at go-live (Norm's call, against the staged-backfill recommendation), softened by the two carve-outs above. `legacy` status exists for per-person exemption. |
| Who administers | **Superadmin only** — creates users, edits templates, generates/issues contracts, sees TFN/bank/super, approves change requests. |
| Contract editor | **HTML source + live preview + token picker.** Paste, or `.docx` import via `mammoth` (no PDF import). |
| Templates | Matched by `employment_type` + `restaurant_id`, most specific wins, generic fallback. Three seeded MA000003 **DRAFT** templates ship with the feature, clearly marked not-legally-reviewed. |
| Signature | **Drawn (canvas) with typed fallback**, plus audit trail: name, timestamp, client IP, user agent, SHA-256 of the rendered body. Employer counter-signature pre-filled from company settings. |
| Contract artifact | **Rendered HTML snapshot is the legal record** (immutable, stored on the row), copied to the private `contracts` Storage bucket as `.html`. PDF via browser print stylesheet (same pattern as `printRoster`). |
| Profile self-service | Three tiers — free edit (phone, email, address, emergency contact, preferred name); **approval required** (bank, super, legal name, DOB); admin-only read-only (pay rate, award level, employment type, home store, role, start date). Bank changes notify both Norm and the employee. |
| Variations | Pay-rate / employment-type / position changes prompt a **variation letter** off a fourth template, signed, chained to the original. Built last. |

## Sensitive data

TFN, bank account and super details live in **`employee_sensitive`**, a separate table whose RLS is
`employee_id = auth.uid() OR is_superadmin()`. They are **never** joined into the team list and are
masked in the UI (`•••• 4821`) until explicitly revealed. This matters because
`profiles_select_roster_manager` (migration 042) lets every roster manager read every profile row —
putting a TFN on `profiles` would hand every store manager the whole team's tax file numbers.

Note: TFN is stored as plaintext protected by RLS, not encrypted at rest beyond Supabase's own disk
encryption. If that is not acceptable, the alternative is to not store TFN in The Coop at all and
keep TFN declarations in Xero/ATO only — the rest of the flow works unchanged.

## Data model (migration 063)

- `profiles` **+** legal name parts, preferred name, address, emergency contact, medical notes,
  work eligibility + visa, position title, start date, probation weeks.
- `employee_onboarding` — one row per employee: status, what's being collected, per-flag completion,
  current step, escape hatch. Source of truth for the gate.
- `employee_sensitive` — TFN / tax / super / bank. Locked-down RLS.
- `employee_documents` (+ private `employee-docs` bucket) — RSA, food handler, visa, other; expiry dates.
- `contract_templates` + `contract_template_versions` — superadmin-only.
- `employee_contracts` — the issued/signed instrument, with the immutable rendered snapshot.
- `onboarding_checklist_items` + `employee_checklist` — configurable induction tick-list.
- `profile_change_requests` — the approval queue for tier-2 fields.
- `app_settings['company']` — legal name, ABN, address, signatory name/title/signature image.

Completion is computed server-side by `public.onboarding_recalc(uuid)` and fired by triggers on
`profiles`, `employee_sensitive` and `employee_contracts` — the employee cannot mark themselves done.

## Tokens available to templates

`{{employee.full_name}}` `{{employee.legal_name}}` `{{employee.preferred_name}}` `{{employee.first_name}}`
`{{employee.last_name}}` `{{employee.dob}}` `{{employee.age}}` `{{employee.address}}` `{{employee.email}}`
`{{employee.phone}}` — `{{employment.position}}` `{{employment.type}}` `{{employment.start_date}}`
`{{employment.probation}}` `{{employment.hours}}` `{{employment.pay_rate}}` `{{employment.salary}}`
`{{employment.pay_type}}` `{{employment.pay_frequency}}` — `{{award.name}}` `{{award.code}}`
`{{award.level}}` `{{award.classification}}` `{{award.junior_percent}}` — `{{restaurant.name}}`
`{{restaurant.address}}` `{{restaurant.state}}` — `{{company.legal_name}}` `{{company.abn}}`
`{{company.address}}` `{{company.signatory_name}}` `{{company.signatory_title}}` — `{{today}}`
`{{signature.block}}`

## Build order

1. **O1 — Data + admin.** Migration 063, types, hooks, Team → Onboarding tab (pipeline, trigger, view).
2. **O2 — Employee wizard.** `/onboarding`, six steps, mobile-first, resumable, gate + clock-in carve-out.
3. **O3 — Templates.** Editor, token picker, paste/.docx import, seeded drafts, company settings.
4. **O4 — Generate & sign.** Render, issue, sign, snapshot, Storage copy, print.
5. **O5 — Profile self-service.** My Profile, three tiers, change-request approvals.
6. **O6 — Polish.** Notifications + reminders, checklist, expiry alerts, variation letters.

## Where each contract field comes from

`lib/contract.ts` → `TOKEN_SOURCES` maps every token to the screen that sets it, and
`groupMissingBySource()` drives the "Not ready to send" warning. The two that catch people out:

| Field | Set in |
|---|---|
| `employment.*` (position, type, start date, probation, hours, pay type, pay rate, salary) + `award.level` / `award.classification` | **Team → Onboarding → [person] → Details → Employment terms.** Everything the contract needs is on one screen, with a live "contract will print $X/hr" preview. Team → Payroll edits the same columns; both invalidate each other's caches. |
| `employee.*` | Details tab (personal / address / emergency), or the employee's own wizard |
| `company.*` | Team → Contracts → Company & signature |
| `restaurant.*` | Settings → Venues |

`award.classification` and `employment.pay_rate` both derive from **`profiles.award_level`** (or a
manual `base_pay_rate` override) — neither is on the Details tab, which is why the first version of
the warning sent people to the wrong screen.


## Placement (final, 23 Aug)

Team management and onboarding are **one page**: Team → **Team** tab. The old separate Onboarding
tab is gone, and `components/onboarding/OnboardingAdmin.tsx` is now unused (safe to delete).

`TeamSettings.tsx` is the merged page and holds:

- **"Onboard team member"** (was "Add User") — account fields plus employment type, award level,
  position title and start date; on save it creates the account, writes the terms, enrols them for
  onboarding and opens their record so pay can be set immediately.
- Pending detail-change approvals (`ChangeRequests`) at the top.
- Clickable onboarding counters (Not started / In progress / Complete) that filter the list, plus a
  search box and a status filter.
- An **Onboarding** column per person — status pill plus "Waiting on details, tax & bank, contract".
- Row actions: **Open** (the full record drawer: Details incl. employment terms, Tax & bank,
  Contract, Documents, Checklist), **Access** (role, venues, password, delete), and a **•••** menu
  for start onboarding / exempt / let them skip the gate.

Team page tabs are now: **Team | Contracts | Training | Payroll**.

## Auto-issue + who signs (migration 065, `issue-contract` edge function)

**The contract sends itself.** No "send" click. It goes out the moment both halves are ready:
the admin has set the employment terms (type + award level / rate) *and* the employee has finished
their own details and tax/bank. Whichever happens second fires it — the wizard calls it after the
employee's last step, the admin drawer calls it after saving employment terms. Both routes hit the
same `issue-contract` edge function, which no-ops with a reason when it isn't time.
`employee_onboarding.auto_issue` turns it off per person (checkbox on the Contract tab).

**The employer signature is whoever started the onboarding**, from
`employee_onboarding.requested_by` — not one fixed company signatory. Norm onboards someone, Norm's
name is on it; Jason onboards someone, Jason's is. Each authoriser sets their own title and
signature image in **My profile → "Your signature (for contracts you authorise)"**;
`app_settings['company']` is the fallback for anyone who hasn't. The name, title **and image** are
snapshotted onto `employee_contracts` at issue, so changing your signature later never alters a
contract already signed.

**Why an edge function.** Rendering on the client would let a caller choose the contract body, and
`contract_templates` is superadmin-only so an employee cannot read a template anyway. The function
runs under the service role, verifies the caller is the employee or a superadmin, renders from the
stored template, and inserts the row. `useIssueContract` (client-side insert) was removed.

**Gate change.** If the employee's half is complete and no contract is waiting, the hard gate lets
them through — the hold-up is ours, and locking them out over a document they cannot action would
strand them at a disabled button. They keep the banner, and the gate returns as soon as a contract
is actually issued to them.
