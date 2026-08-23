-- ============================================================================
-- 053. PUBLIC HOLIDAYS + AWARD CONFIG  (Payroll T2 — classify)
-- ----------------------------------------------------------------------------
-- Feeds the MA000003 award classifier: which dates are public holidays (per
-- state) and the tunable award parameters (overtime thresholds, evening/night
-- windows, penalty %, junior %). Dollar base rates per level live with the
-- per-member rate in PayrollSettings; these are the multipliers/rules on top.
--
-- Classification only needs: public_holidays + tz + OT thresholds + time
-- windows. The penalty %/junior % are seeded here too so the gross engine (T3)
-- reads one source. Seed uses ON CONFLICT DO NOTHING so operator edits survive.
-- ============================================================================

create table public.public_holidays (
  id         uuid        primary key default uuid_generate_v4(),
  date       date        not null,
  state      text        not null
    check (state in ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT')),
  name       text        not null,
  created_at timestamptz not null default now(),
  unique (date, state)
);

create index idx_public_holidays_date on public.public_holidays(date);

alter table public.public_holidays enable row level security;

-- Any authenticated user may read (the classifier runs for roster managers, but
-- reading holiday dates is not sensitive). Only roster managers may edit.
create policy "public_holidays_select" on public.public_holidays
  for select using (auth.uid() is not null);
create policy "public_holidays_insert" on public.public_holidays
  for insert with check (public.is_roster_manager());
create policy "public_holidays_update" on public.public_holidays
  for update using (public.is_roster_manager());
create policy "public_holidays_delete" on public.public_holidays
  for delete using (public.is_roster_manager());

-- ── Seed: Victoria 2026 (operator confirms yearly; AFL GF Friday provisional) ─
insert into public.public_holidays (date, state, name) values
  ('2026-01-01','VIC','New Year''s Day'),
  ('2026-01-26','VIC','Australia Day'),
  ('2026-03-09','VIC','Labour Day'),
  ('2026-04-03','VIC','Good Friday'),
  ('2026-04-04','VIC','Saturday before Easter Sunday'),
  ('2026-04-05','VIC','Easter Sunday'),
  ('2026-04-06','VIC','Easter Monday'),
  ('2026-04-25','VIC','Anzac Day'),
  ('2026-06-08','VIC','King''s Birthday'),
  ('2026-09-25','VIC','Friday before the AFL Grand Final'),
  ('2026-11-03','VIC','Melbourne Cup Day'),
  ('2026-12-25','VIC','Christmas Day'),
  ('2026-12-26','VIC','Boxing Day'),
  ('2026-12-28','VIC','Boxing Day (additional)')
on conflict (date, state) do nothing;

-- ── Award config (app_settings key 'award') ──────────────────────────────────
-- Percentages are % of the permanent base rate. Casual figures already include
-- the 25% casual loading (e.g. Saturday casual 150 = 125 + 25).
insert into public.app_settings (key, value) values (
  'award',
  '{
    "code": "MA000003",
    "tz": "Australia/Melbourne",
    "ot_daily_hours": 11,
    "ot_weekly_hours": 38,
    "evening_start": "22:00",
    "morning_end": "06:00",
    "junior_pct": {"15": 40, "16": 50, "17": 60, "18": 70, "19": 80, "20": 90, "21": 100},
    "penalties": {
      "permanent": {"ordinary": 100, "evening": 110, "night": 115, "saturday": 125, "sunday_l1": 125, "sunday": 150, "public_holiday": 225, "ot_first2": 150, "ot_after": 200},
      "casual":    {"ordinary": 125, "evening": 135, "night": 140, "saturday": 150, "sunday_l1": 150, "sunday": 175, "public_holiday": 250, "ot_first2": 175, "ot_after": 225}
    }
  }'::jsonb
)
on conflict (key) do nothing;

-- ============================================================================
-- END OF MIGRATION 053
-- ============================================================================
