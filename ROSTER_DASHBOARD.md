# Roster Dashboard

Labour Reports → **Roster** tab. Compares the roster you've built in Deputy against
the hours you *should* be rostering, per day, before the week happens.

## How it works

```
Projections tab (daily grid)        Settings → Targets
  projected_sales per day             SPMH target (per store)
        │                             Min roster hours (per store)
        └──────────────┬───────────────────┘
                       ▼
   Required h = max( projected_sales ÷ SPMH target , min_roster_hours )
                       ▼
   Roster dashboard  ──vs──  Rostered h (Deputy scheduled_hours)
```

- **Required hours** is driven by per-day projected sales ÷ the store's SPMH target,
  floored at the store's minimum hours.
- **Rostered hours / cost** come from `labour_daily.scheduled_hours` / `total_cost`,
  populated by the Deputy scrape running in forward (`--roster`) mode.
- **Rostered SPMH** = projected sales ÷ rostered hours (forward-looking, vs target).
- Calendar events on a day show as a marker on the chart and a chip in the day table.
- One free-text **note per week per store**.
- Works **one store at a time** — select a single venue in the store picker.

## Setup steps

1. **Run the migration** `supabase/migrations/037_roster_dashboard.sql`
   (creates `daily_projections`, `roster_notes`, `roster_refresh_requests`).
2. **Settings → Targets**, per store: set **SPMH Target** (I) and **Minimum Roster
   Hours** (J). Use "Copy targets to another store" to fan out.
3. **Projections tab**: fill the **Daily Sales Projections** grid for the roster week.
4. **Deputy scrape** (`deputy-labour-sync/`):
   - Nightly actuals: `node sync.mjs` (unchanged).
   - Forward roster: `node sync.mjs --roster` — schedule daily via launchd. Pulls
     this + next week's scheduled hours & wage cost into future-dated `labour_daily`.
   - On-demand refresh: `node sync.mjs --watch` — run as a persistent agent so the
     dashboard's **Refresh roster** button works (it queues a row in
     `roster_refresh_requests`; the watcher runs the scrape and marks it done).
   - Env knobs: `ROSTER_WEEKS` (default 2), `WATCH_POLL_MS` (default 15000).

## ⚠ Calibration

`navigateToWeek()` (week prev/next controls) and `extractWeekLabour()` (per-day
columns) in `sync.mjs` are DOM-dependent. If `--roster` logs "no per-day roster
figures parsed", run `node sync.mjs --setup`, inspect the dumped page, and tune the
selectors — same pattern as the existing labour label calibration.

## Refresh button architecture

The web app is hosted; the scraper runs on your Mac. The button can't call your
machine directly, so it inserts a `pending` row in `roster_refresh_requests`. The
`--watch` process polls that table, runs the scrape for that store+week, and marks
the row `done`/`error`. The dashboard polls the row to reflect progress.
