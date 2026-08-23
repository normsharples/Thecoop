// ask
// The in-app assistant. Answers questions about the business by calling a small
// set of reporting functions (migration 069) and letting Claude decide which
// ones to call, with what date range, and how to read the result.
//
//   POST /functions/v1/ask
//   { messages: [{ role: "user" | "assistant", content: "..." }],
//     context?: { restaurant_ids?: string[], page?: string } }
//   → { answer, steps: [{ tool, input, rows }], usage }
//
// SECURITY — the two things that matter here:
//   1. This function NEVER holds the service-role key. It builds a Supabase
//      client from the ANON key plus the caller's own JWT, so every query runs
//      under that user's RLS. The model cannot reach a venue the user can't.
//   2. The model cannot write SQL. It picks from five typed tools, each of
//      which maps to one ask_* function. Worst case for a prompt-injected
//      question is a badly-chosen date range.
//
// Required secret:
//   ANTHROPIC_API_KEY   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optional:
//   ASK_MODEL           defaults to claude-sonnet-5
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("ASK_MODEL") ?? "claude-sonnet-5";
const TZ = "Australia/Melbourne";

// Roles allowed to use the assistant at all. Everything below this line only
// ever sees sales/labour data through their own RLS anyway, but there is no
// reason to put the button in front of them.
const ALLOWED_ROLES = ["superadmin", "area_manager", "manager"];

const MAX_ROUNDS = 6;      // tool round-trips before we stop and answer
const MAX_ROWS = 600;      // rows handed back to the model per tool call
const MAX_DAILY_DAYS = 400;
// Raw hour-by-hour rows are capped tight on purpose: a fortnight is already
// ~280 rows, and anything wider is a question for the rollup tools. Handing the
// model 600+ rows to distil twelve numbers from is how it ends up with nothing
// to say.
const MAX_HOURLY_DAYS = 14;
const BULKY_ROWS = 250;    // past this we tell the model a rollup exists

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Today's date in venue-local time, as yyyy-mm-dd. */
function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

// ── Tools ────────────────────────────────────────────────────────────────────
// Each one is a thin wrapper over an ask_* function. The descriptions are the
// only place the model learns what a metric means, so they carry the
// definitions rather than pointing at them.

const dateRangeProps = {
  from: { type: "string", description: "Start date, inclusive, as yyyy-mm-dd." },
  to:   { type: "string", description: "End date, inclusive, as yyyy-mm-dd." },
  restaurant_ids: {
    type: "array",
    items: { type: "string" },
    description:
      "Venue ids to include. Omit for every venue the user can see. Use the ids from the venue list in the system prompt.",
  },
};

const TOOLS = [
  {
    name: "daily_sales",
    description:
      "Sales per venue per day. Returns gross_sales (till total incl. GST), net_sales (ex-GST), " +
      "delivery_sales (Uber Eats etc.), online_sales (web/app ordering), transactions, avg_transaction " +
      "and the weekday name. This is the right tool for 'busiest day', 'best week', " +
      "trends, and venue-vs-venue comparisons. For 'which day of the WEEK' use weekday_profile " +
      "instead — it does the grouping for you. Range limit: 400 days.",
    input_schema: { type: "object", properties: dateRangeProps, required: ["from", "to"] },
    rpc: "ask_daily_sales",
  },
  {
    name: "hourly_profile",
    description:
      "The trading curve: sales TOTALLED BY HOUR across a date range, per venue — about 12 rows per " +
      "venue however long the range. Returns gross_sales and net_sales for the hour across the whole " +
      "range, avg_gross_per_day, order count, and pct_of_day (that hour's share of the venue's takings). " +
      "This is the tool for 'which hour makes the most money', 'when is the rush', 'how does the day " +
      "shape up'. Prefer it over hourly_sales for any question spanning more than a couple of days. " +
      "Range limit: 400 days.",
    input_schema: { type: "object", properties: dateRangeProps, required: ["from", "to"] },
    rpc: "ask_hourly_profile",
  },
  {
    name: "weekday_profile",
    description:
      "Sales grouped BY DAY OF THE WEEK across a range, per venue — 7 rows per venue. Returns " +
      "days_counted, total_gross, avg_gross_per_day, avg_net_per_day, avg_transactions, and the single " +
      "best_day for that weekday with its takings. Use for 'which day of the week is busiest', 'are " +
      "Mondays worth opening', 'how do weekends compare'. Range limit: 400 days.",
    input_schema: { type: "object", properties: dateRangeProps, required: ["from", "to"] },
    rpc: "ask_weekday_profile",
  },
  {
    name: "hourly_sales",
    description:
      "Hour-by-hour rows for SPECIFIC DAYS — one row per venue per date per hour, from the live Kounta " +
      "feed. Hours are 0-23 Melbourne time. Returns gross_sales, net_sales, delivery_sales and order " +
      "count. Use only when the shape of a particular day matters ('what happened at 7pm last Friday'); " +
      "for anything about hours in general use hourly_profile instead. " +
      "Note delivery_sales is a SLICE of net_sales, not an addition — the tills already see those orders. " +
      "Range limit: 14 days.",
    input_schema: { type: "object", properties: dateRangeProps, required: ["from", "to"] },
    rpc: "ask_hourly_sales",
  },
  {
    name: "labour",
    description:
      "Labour per venue per day: actual_hours worked, scheduled_hours, overtime_hours, labour_cost, " +
      "labour_percent (cost as a % of sales), the day's gross_sales, and spmh (Sales Per Man Hour = " +
      "gross sales ÷ actual hours). Use for 'were we overstaffed', 'labour percentage', 'SPMH'. " +
      "Range limit: 400 days.",
    input_schema: { type: "object", properties: dateRangeProps, required: ["from", "to"] },
    rpc: "ask_labour",
  },
  {
    name: "projections",
    description:
      "Projected vs actual sales per venue per day, with variance and variance_percent. Use for " +
      "'did we hit our number', 'how far off projection were we'. Range limit: 400 days.",
    input_schema: { type: "object", properties: dateRangeProps, required: ["from", "to"] },
    rpc: "ask_projections",
  },
  {
    name: "targets",
    description:
      "The venue's configured targets by metric (e.g. sales, labour percent, SPMH). day_of_week is " +
      "0=Sunday..6=Saturday, or null when the target applies to every day. Call this before judging a " +
      "number as good or bad, rather than guessing what good looks like.",
    input_schema: {
      type: "object",
      properties: {
        restaurant_ids: dateRangeProps.restaurant_ids,
      },
    },
    rpc: "ask_targets",
  },
] as const;

type ToolName = typeof TOOLS[number]["name"];

interface ToolResult {
  rows?: unknown[];
  row_count?: number;
  truncated?: boolean;
  hint?: string;
  error?: string;
}

async function runTool(
  db: SupabaseClient,
  name: ToolName,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const spec = TOOLS.find((t) => t.name === name);
  if (!spec) return { error: `Unknown tool ${name}` };

  const ids = Array.isArray(input.restaurant_ids) && input.restaurant_ids.length
    ? (input.restaurant_ids as string[])
    : null;

  let args: Record<string, unknown> = { p_restaurant_ids: ids };

  if (name !== "targets") {
    const from = String(input.from ?? "");
    const to = String(input.to ?? "");
    const span = daysBetween(from, to);
    if (Number.isNaN(span)) {
      return { error: "from and to must be dates in yyyy-mm-dd form." };
    }
    if (span <= 0) {
      return { error: "'to' must be on or after 'from'." };
    }
    const limit = name === "hourly_sales" ? MAX_HOURLY_DAYS : MAX_DAILY_DAYS;
    if (span > limit) {
      const hint =
        name === "hourly_sales"
          ? " For a range this wide use hourly_profile, which totals by hour across the whole period."
          : " Narrow the range and try again.";
      return { error: `That range is ${span} days; this tool allows ${limit}.${hint}` };
    }
    args = { ...args, p_from: from, p_to: to };
  }

  const { data, error } = await db.rpc(spec.rpc, args);
  if (error) {
    console.error(`[ask] ${name} failed:`, error.message);
    return { error: `Query failed: ${error.message}` };
  }

  const rows = (data ?? []) as unknown[];
  const bulky =
    rows.length > BULKY_ROWS && (name === "hourly_sales" || name === "daily_sales")
      ? `${rows.length} rows is a lot to read through. If the question is about hours or days of the week in general, hourly_profile / weekday_profile answer it in a dozen rows.`
      : undefined;

  if (rows.length > MAX_ROWS) {
    return {
      rows: rows.slice(0, MAX_ROWS),
      row_count: rows.length,
      truncated: true,
      hint: `Only the first ${MAX_ROWS} of ${rows.length} rows are shown. ${bulky ?? "Narrow the range, or say in your answer that the period was too wide to read in full."}`,
    };
  }
  return { rows, row_count: rows.length, hint: bulky };
}

// ── System prompt ────────────────────────────────────────────────────────────

function systemPrompt(
  venues: { restaurant_id: string; venue: string; address: string | null }[],
  userName: string,
  scopedIds: string[] | undefined,
  page: string | undefined
): string {
  const today = todayLocal();
  const venueList = venues.length
    ? venues.map((v) => `  - ${v.venue} — id ${v.restaurant_id}`).join("\n")
    : "  (none — this user has no venue access)";

  const scoped = scopedIds?.length
    ? venues.filter((v) => scopedIds.includes(v.restaurant_id)).map((v) => v.venue).join(", ")
    : null;

  return `You are the assistant inside The Coop, the operations dashboard for Pollo Rotisserie — a rotisserie chicken business in Geelong and Torquay, Victoria, Australia. You are talking to ${userName}, who runs or manages these venues.

Today is ${today} (Australia/Melbourne). All money is AUD. The week starts Monday. Dates are dd/mm/yyyy when you write them out for a human, but always yyyy-mm-dd when you pass them to a tool.

Venues this user can see:
${venueList}
${scoped ? `\nThe venue switcher in the app is currently set to: ${scoped}. If the question doesn't name a venue, answer for this selection and say which venue(s) you used.` : ""}
${page ? `They are currently looking at: ${page}.` : ""}

HOW TO ANSWER

Use the tools. Never state a figure you have not fetched — if a tool returns nothing, say the data isn't there rather than estimating. If a question needs two ranges (this month vs last month), make two calls.

Pick the tool that does the grouping for you. "Which hour makes the most money" is hourly_profile, not sixty days of hourly_sales rows. "Which day of the week is busiest" is weekday_profile, not a month of daily rows you add up yourself. Pull raw per-day or per-hour rows only when a specific day or hour is the subject.

Resolve relative dates yourself against today's date above. "This month" means the 1st to today, not the whole calendar month — say so when it matters. Today's own figures are always partial, because the day is still running; flag that rather than comparing a half-day against full days.

Lead with the answer in one sentence, then the supporting detail. A short markdown table beats a paragraph when you are comparing days, venues or hours. Keep numbers rounded sensibly — dollars to the nearest dollar for totals, one decimal for percentages.

Say which date range and which venues you used. That one line is what makes the answer checkable.

WHAT THE NUMBERS MEAN

- Gross sales is the till total including GST. Net sales is ex-GST. The Sales report leads with gross; Pulse leads with net.
- There is no discount or refund data in this database. If asked about discounts or refunds, say the figures aren't synced rather than reporting zero.
- Delivery sales (Uber Eats and similar) already sit inside the POS totals — report them alongside, never add them on top.
- Labour percent is labour cost as a percentage of sales. SPMH is sales per man hour — sales divided by hours worked. Both are the numbers the Labour report shows.
- Labour figures come from Deputy and can lag a day behind sales. If labour is missing for a recent day, say so instead of reporting zero hours.

Judge performance against the targets tool, not against your own sense of what a restaurant should do. If there is no target for a metric, compare against the venue's own recent history and say that's what you did.

Be direct. If the number is bad, say it's bad. Don't pad the answer with caveats or offer to do further analysis unless it's genuinely the obvious next step.`;
}

// ── Claude call ──────────────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: unknown[]
): Promise<AnthropicResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages,
      tools: TOOLS.map(({ name, description, input_schema }) => ({
        name, description, input_schema,
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  return await res.json() as AnthropicResponse;
}

/**
 * What to say when the model returns no text at all.
 *
 * This used to be a flat "I couldn't put an answer together", which told
 * nobody anything. The stop reason is the whole diagnosis: `max_tokens` means
 * we handed it more rows than it could distil, and that is a fixable question,
 * not a broken assistant.
 */
function emptyAnswerFallback(stopReason: string): string {
  if (stopReason === "max_tokens") {
    return "I pulled back more data than I could sum up in one reply. Ask again for a single venue, or a shorter stretch of time, and I'll get there.";
  }
  return `I couldn't put an answer together for that one — the model stopped with "${stopReason}". Try rephrasing the question.`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "The assistant isn't configured yet — ANTHROPIC_API_KEY is not set." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Not authenticated" }, 401);

  // Anon key + the caller's JWT: every query below runs under their RLS.
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
  );

  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);

  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userData.user.id)
    .single();

  if (!profile) return json({ error: "No profile for this user" }, 403);
  if (!ALLOWED_ROLES.includes(profile.role)) {
    return json({ error: "The assistant is available to managers and above." }, 403);
  }

  let body: {
    messages?: { role: string; content: string }[];
    context?: { restaurant_ids?: string[]; page?: string };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12); // keep the last few turns; older context isn't worth the tokens

  if (!history.length) return json({ error: "No question asked" }, 400);

  const { data: venues, error: venuesErr } = await db.rpc("ask_venues");
  if (venuesErr) {
    console.error("[ask] ask_venues failed:", venuesErr.message);
    return json(
      { error: "Reporting functions are missing — apply migration 069_ask_reporting.sql." },
      500
    );
  }

  const system = systemPrompt(
    (venues ?? []).filter((v: { status: string }) => v.status !== "inactive"),
    profile.full_name,
    body.context?.restaurant_ids,
    body.context?.page
  );

  const messages: unknown[] = history.map((m) => ({ role: m.role, content: m.content }));
  const steps: { tool: string; input: unknown; rows: number; error?: string }[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await callClaude(apiKey, system, messages);
      inputTokens += reply.usage?.input_tokens ?? 0;
      outputTokens += reply.usage?.output_tokens ?? 0;

      const toolUses = reply.content.filter((c) => c.type === "tool_use");

      if (!toolUses.length || reply.stop_reason !== "tool_use") {
        const answer = reply.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n")
          .trim();

        if (!answer) {
          console.error(
            `[ask] empty answer — stop_reason=${reply.stop_reason}, blocks=[${reply.content
              .map((c) => c.type)
              .join(",")}], rows fetched=${steps.reduce((n, s) => n + s.rows, 0)}`
          );
        }

        return json({
          answer: answer || emptyAnswerFallback(reply.stop_reason),
          steps,
          stop_reason: reply.stop_reason,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens, model: MODEL },
        });
      }

      messages.push({ role: "assistant", content: reply.content });

      const results = await Promise.all(
        toolUses.map(async (use) => {
          const result = await runTool(db, use.name as ToolName, use.input ?? {});
          steps.push({
            tool: use.name ?? "?",
            input: use.input,
            rows: result.row_count ?? 0,
            error: result.error,
          });
          return {
            type: "tool_result",
            tool_use_id: use.id,
            is_error: !!result.error,
            content: JSON.stringify(result.error ? { error: result.error } : result),
          };
        })
      );

      messages.push({ role: "user", content: results });
    }

    return json({
      answer:
        "That took more steps than I'm allowed in one go. Try narrowing the question — a shorter date range or one venue.",
      steps,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, model: MODEL },
    });
  } catch (err) {
    console.error("[ask] failed:", err);
    return json({ error: err instanceof Error ? err.message : "The assistant failed" }, 500);
  }
});
