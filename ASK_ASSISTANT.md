# Ask The Coop — the in-app assistant

Ask a question in plain English ("what was the busiest day this month?") and get
an answer built from the live data, with the venue scoping the rest of the app
already enforces.

## How it works

```
AskDrawer  ──POST──▶  edge function `ask`  ──▶  Claude API (tool use)
(browser)             (user's JWT, anon key)         │
                              │                      │ picks a tool
                              ◀──────────────────────┘
                              │
                              └──rpc()──▶ ask_* functions (migration 069)
                                          └─ RLS applies, as the caller
```

Three deliberate choices:

**The model never writes SQL.** It picks from five typed tools, each of which
maps to exactly one `ask_*` function. There is no text-to-SQL path, so a
badly-phrased (or injected) question can at worst pick a silly date range.

**The function never holds the service-role key.** It builds its Supabase client
from the anon key plus the caller's own JWT, so every query runs under that
user's RLS. A manager asking about a venue they can't see gets zero rows, and
there is no code path that could return otherwise.

**Metric definitions live in one place.** Gross, net, delivery, labour % and
SPMH are computed inside migration 069 to match the Sales, Labour and Pulse
reports, so the assistant can't quietly disagree with the dashboard.

## Files

| What | Where |
| --- | --- |
| Reporting functions | `supabase/migrations/069_ask_reporting.sql` |
| Rollup functions | `supabase/migrations/070_ask_rollups.sql` |
| Edge function | `supabase/functions/ask/index.ts` |
| Drawer UI | `src/components/ask/AskDrawer.tsx` |
| Answer renderer | `src/components/ask/AskMarkdown.tsx` |
| Conversation state | `src/hooks/useAsk.ts` |
| Mounted in | `src/components/layout/AppLayout.tsx` |

## Setup

```bash
# 1. Apply the migration (Supabase SQL editor, or)
supabase db push

# 2. Add the API key from console.anthropic.com
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# 3. Deploy
supabase functions deploy ask
```

Optional: `supabase secrets set ASK_MODEL=claude-haiku-4-5` to trade some
reasoning for speed and cost.

## Access

`superadmin`, `area_manager`, `manager` — the same line as the rest of the
sales/labour data. Set in `ALLOWED_ROLES` in the edge function and mirrored in
`AppLayout` so the button doesn't appear for anyone else. RLS is the real
boundary; the role check just decides who sees the launcher.

## The tools

| Tool | Function | Answers |
| --- | --- | --- |
| `daily_sales` | `ask_daily_sales` | busiest day, week-on-week, venue vs venue |
| `hourly_profile` | `ask_hourly_profile` | which hour makes the most money, when the rush is |
| `weekday_profile` | `ask_weekday_profile` | which day of the week trades best |
| `hourly_sales` | `ask_hourly_sales` | the shape of one particular day |
| `labour` | `ask_labour` | labour %, SPMH, over/understaffed |
| `projections` | `ask_projections` | did we hit the number |
| `targets` | `ask_targets` | what "good" is, per venue and metric |

**Group in SQL, not in the model.** The first version had only `hourly_sales`,
so "which hour makes the most money?" pulled 637 rows covering two months and
the model returned nothing at all — it ran out of output budget trying to
distil them. `hourly_profile` answers the same question in about twelve rows
per venue. Any question of the form "which X is best across a period" wants a
function that groups by X, not raw rows plus hope.

Range caps: 400 days for the daily and profile tools, 14 for raw `hourly_sales`
— wide hourly ranges are pushed to `hourly_profile` by the range check itself.
Six tool rounds per question, 600 rows per call.

## Adding a tool

1. Write an `ask_*` function in a new migration. `security invoker`, `stable`,
   aggregate in SQL, qualify every column reference.
2. `grant execute ... to authenticated` (and `revoke ... from public` first —
   functions are granted to PUBLIC by default).
3. Add an entry to `TOOLS` in the edge function. The `description` is the only
   place the model learns what the metric means, so put the definition there,
   not a pointer to it.
4. Redeploy the function. No frontend change needed.

## Known limits

- **Not streamed.** The answer arrives whole, after 3–10 seconds. Streaming is
  the obvious next improvement.
- **No charts.** Answers are text and markdown tables. Returning a chart spec
  the drawer could render with Recharts is the second obvious improvement.
- **Vague questions get vague answers.** It is sharp on "which day/venue/hour"
  and comparisons; weaker on "how are we going?" unless targets are configured.
- **Labour lags.** Deputy syncs nightly, so today's labour is usually absent.
  The prompt tells it to say so rather than report zero hours.
