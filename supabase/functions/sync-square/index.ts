// sync-square
// ---------------------------------------------------------------------------
// Square POS → The Coop. Works for any venue/business that runs on Square.
//
// Actions (POST body):
//   { action: "locations", access_token?, environment?, restaurant_id? }
//       Lists the Square locations a token can see, so a venue can be mapped
//       to one. Uses the given token, or the venue's saved one.
//   { action: "sync", restaurant_id?, date?, days? }
//       Pulls COMPLETED orders for each Square venue (or just one) and writes:
//         sales_daily         daily totals, channel split, discounts, refunds
//         sales_transactions  one row per order (Sales by Hour, Daily Activity)
//         sales_mix_daily     category + product mix (Sales Mix)
//       Default dates: yesterday + today in the location's own timezone, so a
//       scheduled run keeps today live and closes off yesterday. `date`
//       (YYYY-MM-DD) syncs one day; `days` (≤ 62) backfills that many days
//       ending today.
//
// Auth: a superadmin (from Settings → Integrations) or the service-role key
//       (nightly-sync / cron).
//
// Credentials: integration_credentials, provider = 'square':
//   { access_token, environment, location_id, location_name, timezone }
// A Square "Personal access token" (Developer Dashboard → your app →
// Production → Access token) is all that's needed.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SQUARE_VERSION = "2026-09-16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Money { amount?: number; currency?: string }
interface SquareLineItem {
  name?: string;
  variation_name?: string;
  quantity?: string;
  catalog_object_id?: string;
  gross_sales_money?: Money;
  total_money?: Money;
  total_tax_money?: Money;
}
interface SquareOrder {
  id: string;
  closed_at?: string;
  created_at?: string;
  ticket_name?: string;
  reference_id?: string;
  source?: { name?: string };
  line_items?: SquareLineItem[];
  fulfillments?: { type?: string }[];
  total_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  total_tip_money?: Money;
  discounts?: unknown[];
}
interface SquareCreds {
  access_token?: string;
  environment?: "production" | "sandbox";
  location_id?: string;
  location_name?: string;
  timezone?: string;
}

const cents = (m?: Money) => (m?.amount ?? 0) / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Square API ──────────────────────────────────────────────────────────────

function baseUrl(env?: string) {
  return env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
}

async function sq<T>(token: string, env: string | undefined, path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${baseUrl(env)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (body as { errors?: { detail?: string; code?: string }[] }).errors?.[0];
      if (res.status === 401) throw new Error("Square rejected the access token (401) — check it's a Production token and still valid.");
      throw new Error(`Square ${res.status}: ${detail?.detail ?? detail?.code ?? JSON.stringify(body).slice(0, 200)}`);
    }
    return body as T;
  }
  throw new Error("Square rate limit — try again in a minute.");
}

async function listLocations(token: string, env?: string) {
  const data = await sq<{ locations?: Record<string, unknown>[] }>(token, env, "/v2/locations");
  return (data.locations ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    timezone: (l.timezone as string) ?? "Australia/Melbourne",
    status: l.status as string,
    currency: l.currency as string,
    address: [
      (l.address as Record<string, string> | undefined)?.address_line_1,
      (l.address as Record<string, string> | undefined)?.locality,
    ].filter(Boolean).join(", "),
  }));
}

async function searchOrders(token: string, env: string | undefined, locationId: string, startISO: string, endISO: string) {
  const orders: SquareOrder[] = [];
  let cursor: string | undefined;
  do {
    const page = await sq<{ orders?: SquareOrder[]; cursor?: string }>(token, env, "/v2/orders/search", {
      method: "POST",
      body: JSON.stringify({
        location_ids: [locationId],
        limit: 1000,
        cursor,
        return_entries: false,
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: { closed_at: { start_at: startISO, end_at: endISO } },
          },
          sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
        },
      }),
    });
    orders.push(...(page.orders ?? []));
    cursor = page.cursor;
  } while (cursor);
  return orders;
}

async function listRefunds(token: string, env: string | undefined, locationId: string, startISO: string, endISO: string) {
  let amount = 0;
  let count = 0;
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ location_id: locationId, begin_time: startISO, end_time: endISO, status: "COMPLETED", limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await sq<{ refunds?: { amount_money?: Money }[]; cursor?: string }>(token, env, `/v2/refunds?${qs}`);
    for (const r of page.refunds ?? []) {
      amount += cents(r.amount_money);
      count += 1;
    }
    cursor = page.cursor;
  } while (cursor);
  return { amount: r2(amount), count };
}

/** Variation id → category name, via the catalog (items and categories come back as related objects). */
async function categoriesFor(token: string, env: string | undefined, variationIds: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < variationIds.length; i += 1000) {
    const batch = variationIds.slice(i, i + 1000);
    const data = await sq<{ objects?: Record<string, any>[]; related_objects?: Record<string, any>[] }>(
      token, env, "/v2/catalog/batch-retrieve",
      { method: "POST", body: JSON.stringify({ object_ids: batch, include_related_objects: true }) },
    ).catch(() => ({ objects: [], related_objects: [] }));
    const related = [...(data.objects ?? []), ...(data.related_objects ?? [])];
    const byId = new Map(related.map((o) => [o.id as string, o]));
    for (const v of data.objects ?? []) {
      if (v.type !== "ITEM_VARIATION") continue;
      const item = byId.get(v.item_variation_data?.item_id);
      const d = item?.item_data ?? {};
      const catId = d.reporting_category?.id ?? d.categories?.[0]?.id ?? d.category_id;
      const cat = catId ? byId.get(catId) : undefined;
      if (cat?.category_data?.name) out.set(v.id, cat.category_data.name);
    }
  }
  return out;
}

// ─── Dates & timezones ───────────────────────────────────────────────────────

/** Minutes the timezone is ahead of UTC at a given instant. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** UTC instant of local midnight on `date` (YYYY-MM-DD) in `tz`. */
function localMidnightUTC(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const off1 = tzOffsetMinutes(tz, guess);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(tz, first); // DST edge
  return new Date(guess.getTime() - off2 * 60000);
}

function localDate(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function localHour(tz: string, at: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(at)) % 24;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// ─── Channel ─────────────────────────────────────────────────────────────────

function channelOf(o: SquareOrder): "delivery" | "online" | "pos" {
  const src = (o.source?.name ?? "").toLowerCase();
  if (/uber|doordash|menulog|deliveroo|delivery/.test(src)) return "delivery";
  if ((o.fulfillments ?? []).some((f) => f.type === "DELIVERY")) return "delivery";
  if (/online|web|app|order|kiosk/.test(src) && !/point of sale/.test(src)) return "online";
  return "pos";
}

// ─── Sync one venue/day ──────────────────────────────────────────────────────

async function syncDay(db: SupabaseClient, restaurantId: string, c: Required<Pick<SquareCreds, "access_token" | "location_id">> & SquareCreds, date: string) {
  const tz = c.timezone || "Australia/Melbourne";
  const start = localMidnightUTC(date, tz);
  const end = localMidnightUTC(addDays(date, 1), tz);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const [orders, refunds] = await Promise.all([
    searchOrders(c.access_token, c.environment, c.location_id, startISO, endISO),
    listRefunds(c.access_token, c.environment, c.location_id, startISO, endISO).catch(() => ({ amount: 0, count: 0 })),
  ]);

  // ── Totals, channels, hours ────────────────────────────────────────────────
  let gross = 0, tax = 0, discounts = 0, discountCount = 0;
  const ch = { online: { sales: 0, count: 0 }, delivery: { sales: 0, count: 0 } };
  const hourly = new Array(24).fill(0);
  const txRows: Record<string, unknown>[] = [];

  // mix: key → { name, category?, qty, sales, count }
  const products = new Map<string, { name: string; variationId?: string; qty: number; sales: number; count: number }>();

  for (const o of orders) {
    const oGross = cents(o.total_money) - cents(o.total_tip_money);
    const oTax = cents(o.total_tax_money);
    const at = new Date(o.closed_at ?? o.created_at ?? startISO);
    const hour = localHour(tz, at);
    const channel = channelOf(o);

    gross += oGross;
    tax += oTax;
    discounts += cents(o.total_discount_money);
    if (cents(o.total_discount_money) > 0) discountCount += 1;
    hourly[hour] += oGross;
    if (channel !== "pos") {
      ch[channel].sales += oGross;
      ch[channel].count += 1;
    }

    txRows.push({
      restaurant_id: restaurantId,
      transaction_ref: `sq:${o.id}`,
      sold_at: at.toISOString(),
      business_date: date,
      hour,
      amount: r2(oGross),
      net_amount: r2(oGross - oTax),
      tax_amount: r2(oTax),
      tip_amount: r2(cents(o.total_tip_money)),
      sale_number: o.ticket_name ?? o.reference_id ?? o.id.slice(-6),
      order_type: channel,
      item_count: (o.line_items ?? []).reduce((s, li) => s + (Number(li.quantity) || 0), 0),
      raw: { source: o.source?.name ?? null, provider: "square" },
      scraped_at: new Date().toISOString(),
    });

    for (const li of o.line_items ?? []) {
      const base = li.name ?? "Custom amount";
      const name = li.variation_name && !/^regular$/i.test(li.variation_name) ? `${base} — ${li.variation_name}` : base;
      const p = products.get(name) ?? { name, variationId: li.catalog_object_id, qty: 0, sales: 0, count: 0 };
      p.qty += Number(li.quantity) || 0;
      p.sales += cents(li.gross_sales_money ?? li.total_money);
      p.count += 1;
      products.set(name, p);
    }
  }

  const txCount = orders.length;
  const net = gross - tax;

  // ── sales_daily ────────────────────────────────────────────────────────────
  const catNames = await categoriesFor(
    c.access_token, c.environment,
    [...new Set([...products.values()].map((p) => p.variationId).filter((x): x is string => !!x))],
  );
  const categories = new Map<string, { qty: number; sales: number; count: number; n: number }>();
  for (const p of products.values()) {
    const cat = (p.variationId && catNames.get(p.variationId)) || "Uncategorised";
    const e = categories.get(cat) ?? { qty: 0, sales: 0, count: 0, n: 0 };
    e.qty += p.qty; e.sales += p.sales; e.count += p.count; e.n += 1;
    categories.set(cat, e);
  }

  // Only columns from the base schema go in the upsert; everything added by
  // later migrations is written separately and tolerated if missing, so an
  // unapplied migration never blocks the core numbers.
  const core = {
    restaurant_id: restaurantId,
    date,
    total_sales: r2(gross),
    net_sales: r2(net),
    transaction_count: txCount,
    average_transaction: txCount ? r2(gross / txCount) : 0,
    sales_by_hour: hourly.map((amount, hour) => ({ hour, amount: r2(amount) })).filter((h) => h.amount !== 0),
    sales_by_category: [...categories.entries()].map(([name, e]) => ({ name, amount: r2(e.sales) })).sort((a, b) => b.amount - a.amount),
    source: "square",
  };
  const { error: dailyErr } = await db.from("sales_daily").upsert(core, { onConflict: "restaurant_id,date" });
  if (dailyErr) throw new Error(`sales_daily: ${dailyErr.message}`);

  const optional: Record<string, unknown>[] = [
    { discounts_amount: r2(discounts), discounts_count: discountCount },
    { refunds_amount: refunds.amount, refunds_count: refunds.count },
    {
      delivery_sales: r2(ch.delivery.sales),
      delivery_transaction_count: ch.delivery.count,
      delivery_average_transaction: ch.delivery.count ? r2(ch.delivery.sales / ch.delivery.count) : 0,
    },
    { online_sales: r2(ch.online.sales) },
    {
      online_transaction_count: ch.online.count,
      online_average_transaction: ch.online.count ? r2(ch.online.sales / ch.online.count) : 0,
    },
  ];
  for (const patch of optional) {
    const { error } = await db.from("sales_daily").update(patch).eq("restaurant_id", restaurantId).eq("date", date);
    if (error) console.warn(`[sync-square] sales_daily optional columns skipped: ${error.message}`);
  }

  // ── sales_transactions ─────────────────────────────────────────────────────
  for (let i = 0; i < txRows.length; i += 500) {
    const { error } = await db.from("sales_transactions")
      .upsert(txRows.slice(i, i + 500), { onConflict: "restaurant_id,transaction_ref" });
    // Table comes from migration 057 — don't lose the daily totals over it.
    if (error) { console.warn(`[sync-square] sales_transactions skipped: ${error.message}`); break; }
  }

  // ── sales_mix_daily ────────────────────────────────────────────────────────
  const mixRows: Record<string, unknown>[] = [];
  for (const [name, e] of categories) {
    mixRows.push({
      restaurant_id: restaurantId, business_date: date, level: "category", item_name: name,
      quantity: e.qty, sales_amount: r2(e.sales), num_sales: e.count, num_products: e.n,
      pct_sales: gross ? r2((e.sales / gross) * 100) : null, raw: { provider: "square" },
      scraped_at: new Date().toISOString(),
    });
  }
  for (const p of products.values()) {
    mixRows.push({
      restaurant_id: restaurantId, business_date: date, level: "product", item_name: p.name,
      category_name: (p.variationId && catNames.get(p.variationId)) || null,
      quantity: p.qty, sales_amount: r2(p.sales), num_sales: p.count,
      pct_sales: gross ? r2((p.sales / gross) * 100) : null, raw: { provider: "square" },
      scraped_at: new Date().toISOString(),
    });
  }
  for (let i = 0; i < mixRows.length; i += 500) {
    const { error } = await db.from("sales_mix_daily")
      .upsert(mixRows.slice(i, i + 500), { onConflict: "restaurant_id,business_date,level,item_name" });
    if (error) console.warn(`[sync-square] sales_mix_daily: ${error.message}`);
  }

  return { date, orders: txCount, gross: r2(gross) };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await handle(req);
  } catch (e) {
    console.error("[sync-square] crashed:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // ── Auth: service role, or a superadmin ────────────────────────────────────
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Not authenticated" }, 401);
  if (bearer !== serviceKey) {
    const { data: u } = await db.auth.getUser(bearer);
    if (!u?.user) return json({ error: "Not authenticated" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).single();
    if (prof?.role !== "superadmin") return json({ error: "Only superadmins can manage Square" }, 403);
  }

  const body = await req.json().catch(() => ({})) as {
    action?: "locations" | "sync";
    access_token?: string;
    environment?: "production" | "sandbox";
    restaurant_id?: string;
    date?: string;
    days?: number;
  };

  // ── Locations ──────────────────────────────────────────────────────────────
  if (body.action === "locations") {
    let token = body.access_token?.trim();
    let env = body.environment;
    if (!token && body.restaurant_id) {
      const { data } = await db.from("integration_credentials")
        .select("credentials").eq("restaurant_id", body.restaurant_id).eq("provider", "square").single();
      const c = (data?.credentials ?? {}) as SquareCreds;
      token = c.access_token;
      env = env ?? c.environment;
    }
    if (!token) return json({ error: "Paste the Square access token first" }, 400);
    return json({ locations: await listLocations(token, env) });
  }

  // ── Sync ───────────────────────────────────────────────────────────────────
  let q = db.from("integration_credentials")
    .select("id, restaurant_id, credentials").eq("provider", "square").eq("is_manual_only", false);
  if (body.restaurant_id) q = q.eq("restaurant_id", body.restaurant_id);
  const { data: creds, error } = await q;
  if (error) return json({ error: error.message }, 500);
  if (!creds?.length) return json({ ok: true, venues: [], note: "No Square venues connected" });

  const results: unknown[] = [];
  for (const row of creds) {
    const c = (row.credentials ?? {}) as SquareCreds;
    const restaurantId = row.restaurant_id as string;
    const startedAt = new Date().toISOString();
    if (!c.access_token || !c.location_id) {
      results.push({ restaurant_id: restaurantId, error: "Not fully connected (token or location missing)" });
      continue;
    }
    const tz = c.timezone || "Australia/Melbourne";
    const today = localDate(tz);
    const dates = body.date
      ? [body.date]
      : body.days
        ? Array.from({ length: Math.min(Math.max(1, body.days), 62) }, (_, i) => addDays(today, -i)).reverse()
        : [addDays(today, -1), today];

    await db.from("integration_credentials").update({ sync_status: "syncing" }).eq("id", row.id);
    try {
      const days = [];
      for (const d of dates) {
        days.push(await syncDay(db, restaurantId, c as Required<Pick<SquareCreds, "access_token" | "location_id">> & SquareCreds, d));
      }
      const orders = days.reduce((s, d) => s + d.orders, 0);
      await db.from("integration_credentials").update({
        sync_status: "success", sync_error: null, last_sync_at: new Date().toISOString(),
      }).eq("id", row.id);
      await db.from("sync_logs").insert({
        provider: "square", restaurant_id: restaurantId, status: "success",
        records_synced: orders, started_at: startedAt, completed_at: new Date().toISOString(),
      });
      results.push({ restaurant_id: restaurantId, days });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("integration_credentials").update({ sync_status: "error", sync_error: msg }).eq("id", row.id);
      await db.from("sync_logs").insert({
        provider: "square", restaurant_id: restaurantId, status: "error",
        error_message: msg, started_at: startedAt, completed_at: new Date().toISOString(),
      });
      results.push({ restaurant_id: restaurantId, error: msg });
    }
  }

  const failed = results.filter((r) => (r as { error?: string }).error);
  return json({ ok: failed.length === 0, venues: results }, failed.length && failed.length === results.length ? 502 : 200);
}
