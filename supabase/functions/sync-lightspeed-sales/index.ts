// sync-lightspeed-sales
// Pulls previous day's sales from Lightspeed O-Series for each restaurant that
// has credentials configured. Upserts aggregated daily totals into sales_daily.
// Can be called with { restaurant_id } to sync a single restaurant.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LIGHTSPEED_BASE = "https://api.lightspeedapp.com/API/V3/Account";
const RATE_LIMIT_DELAY_MS = 500;

// ─── helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Melbourne AEST/AEDT offset — Lightspeed stores UTC, we want the Melbourne day. */
function getMelbourneDate(daysAgo = 1): string {
  const now = new Date();
  const melb = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // melb = "DD/MM/YYYY"
  const [d, m, y] = melb.split("/");
  const today = new Date(`${y}-${m}-${d}`);
  today.setDate(today.getDate() - daysAgo);
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
}

/** Refresh the OAuth access token using the stored refresh token. */
async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch("https://cloud.lightspeedapp.com/oauth/access_token.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

/** Paginated fetch against a Lightspeed API endpoint. */
async function fetchAllPages<T>(
  baseUrl: string,
  accessToken: string,
  params: Record<string, string>
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const limit = 100;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 429) {
      // Rate limited — back off exponentially
      const retryAfter = Number(res.headers.get("Retry-After") ?? "5") * 1000;
      console.log(`Rate limited, waiting ${retryAfter}ms`);
      await delay(retryAfter);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Lightspeed API error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();

    // Lightspeed wraps in a root key — detect it
    const rootKey = Object.keys(json).find(
      (k) => k !== "@attributes" && Array.isArray(json[k])
    );
    if (!rootKey) break;

    const page: T[] = json[rootKey];
    results.push(...page);

    const attrs = json["@attributes"] ?? {};
    const count = parseInt(attrs.count ?? "0", 10);
    const returned = parseInt(attrs.offset ?? "0", 10) + page.length;
    if (returned >= count) break;

    offset += limit;
    await delay(RATE_LIMIT_DELAY_MS);
  }
  return results;
}

// ─── main sync for one restaurant ────────────────────────────────────────────

async function syncRestaurant(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string,
  credential: {
    id: string;
    credentials: Record<string, string>;
  },
  targetDate: string
): Promise<{ records_synced: number }> {
  const { account_id, client_id, client_secret, access_token, refresh_token } =
    credential.credentials as Record<string, string>;

  // Refresh token
  let currentToken = access_token;
  let newRefreshToken = refresh_token;
  try {
    const tokens = await refreshAccessToken(client_id, client_secret, refresh_token);
    currentToken = tokens.access_token;
    newRefreshToken = tokens.refresh_token;
    // Persist new tokens
    await supabase
      .from("integration_credentials")
      .update({
        credentials: {
          ...credential.credentials,
          access_token: currentToken,
          refresh_token: newRefreshToken,
        },
      })
      .eq("id", credential.id);
  } catch (e) {
    console.warn("Token refresh failed — using existing token:", e);
  }

  const baseUrl = `${LIGHTSPEED_BASE}/${account_id}`;

  // Fetch sales for target date
  // Lightspeed timeStamp filter: >=,YYYY-MM-DDT00:00:00+00:00
  const startISO = `${targetDate}T00:00:00+00:00`;
  const endDate = new Date(targetDate);
  endDate.setDate(endDate.getDate() + 1);
  const endISO = endDate.toISOString().split("T")[0] + "T00:00:00+00:00";

  const sales = await fetchAllPages<Record<string, unknown>>(
    `${baseUrl}/Sale.json`,
    currentToken,
    {
      timeStamp: `>=,${startISO}`,
      timeStamp2: `<,${endISO}`,
      completed: "true",
    }
  );

  await delay(RATE_LIMIT_DELAY_MS);

  // Fetch sale lines for category breakdown
  const saleIds = sales.map((s) => s.saleID as string);
  let saleLines: Record<string, unknown>[] = [];
  if (saleIds.length > 0) {
    saleLines = await fetchAllPages<Record<string, unknown>>(
      `${baseUrl}/SaleLine.json`,
      currentToken,
      { saleID: `IN,[${saleIds.join(",")}]` }
    );
  }

  await delay(RATE_LIMIT_DELAY_MS);

  // Fetch categories for name lookup
  const categories = await fetchAllPages<Record<string, unknown>>(
    `${baseUrl}/Category.json`,
    currentToken,
    {}
  );
  const categoryMap = new Map(
    categories.map((c) => [String(c.categoryID), String(c.name)])
  );

  if (sales.length === 0) {
    return { records_synced: 0 };
  }

  // Aggregate
  const totalSales = sales.reduce(
    (sum, s) => sum + parseFloat(String(s.calcTotal ?? 0)),
    0
  );
  const totalTransactions = sales.length;
  const avgTransaction = totalTransactions > 0 ? totalSales / totalTransactions : 0;

  // Category breakdown
  const categoryTotals: Record<string, number> = {};
  for (const line of saleLines) {
    const catId = String(line.categoryID ?? "");
    const amount = parseFloat(String(line.calcTotal ?? 0));
    const catName = categoryMap.get(catId) ?? "Other";
    categoryTotals[catName] = (categoryTotals[catName] ?? 0) + amount;
  }

  // Hour breakdown (Melbourne time)
  const hourTotals: Record<number, number> = {};
  for (const sale of sales) {
    const ts = String(sale.timeStamp ?? "");
    if (ts) {
      const localHour = new Date(ts).toLocaleString("en-AU", {
        timeZone: "Australia/Melbourne",
        hour: "2-digit",
        hour12: false,
      });
      const hour = parseInt(localHour, 10);
      hourTotals[hour] = (hourTotals[hour] ?? 0) + parseFloat(String(sale.calcTotal ?? 0));
    }
  }

  const salesByCategory = Object.entries(categoryTotals).map(([name, amount]) => ({
    name,
    amount: Math.round(amount * 100) / 100,
  }));

  const salesByHour = Object.entries(hourTotals)
    .map(([hour, amount]) => ({
      hour: parseInt(hour, 10),
      amount: Math.round(amount * 100) / 100,
    }))
    .sort((a, b) => a.hour - b.hour);

  // Upsert into sales_daily
  const { error } = await supabase.from("sales_daily").upsert(
    {
      restaurant_id: restaurantId,
      date: targetDate,
      total_sales: Math.round(totalSales * 100) / 100,
      transaction_count: totalTransactions,
      average_transaction: Math.round(avgTransaction * 100) / 100,
      sales_by_category: salesByCategory,
      sales_by_hour: salesByHour,
      source: "lightspeed",
    },
    { onConflict: "restaurant_id,date" }
  );
  if (error) throw new Error(`DB upsert failed: ${error.message}`);

  // Update last sync status
  await supabase
    .from("integration_credentials")
    .update({
      last_sync_at: new Date().toISOString(),
      sync_status: "success",
      sync_error: null,
    })
    .eq("id", credential.id);

  return { records_synced: sales.length };
}

// ─── serve ────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const started_at = new Date().toISOString();
  let body: { restaurant_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body
  }

  const targetDate = getMelbourneDate(1);

  // Fetch all (or one) Lightspeed credentials
  let credQuery = supabase
    .from("integration_credentials")
    .select("*")
    .eq("provider", "lightspeed")
    .eq("is_manual_only", false);

  if (body.restaurant_id) {
    credQuery = credQuery.eq("restaurant_id", body.restaurant_id);
  }

  const { data: credentials, error: credError } = await credQuery;
  if (credError) {
    return new Response(JSON.stringify({ error: credError.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const results: {
    restaurant_id: string;
    status: "success" | "error" | "skipped";
    records?: number;
    error?: string;
  }[] = [];

  for (const cred of credentials ?? []) {
    const logEntry = {
      provider: "lightspeed",
      restaurant_id: cred.restaurant_id as string,
      started_at,
      status: "success" as const,
      records_synced: 0,
      error_message: null as string | null,
      completed_at: null as string | null,
    };

    try {
      const { records_synced } = await syncRestaurant(
        supabase,
        cred.restaurant_id as string,
        cred,
        targetDate
      );
      logEntry.records_synced = records_synced;
      logEntry.completed_at = new Date().toISOString();
      results.push({
        restaurant_id: cred.restaurant_id as string,
        status: "success",
        records: records_synced,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logEntry.status = "error";
      logEntry.error_message = msg;
      logEntry.completed_at = new Date().toISOString();
      // Update credential error state
      await supabase
        .from("integration_credentials")
        .update({
          sync_status: "error",
          sync_error: msg,
          last_sync_at: new Date().toISOString(),
        })
        .eq("id", cred.id);
      results.push({
        restaurant_id: cred.restaurant_id as string,
        status: "error",
        error: msg,
      });
    }

    await supabase.from("sync_logs").insert(logEntry);
    await delay(RATE_LIMIT_DELAY_MS);
  }

  return new Response(JSON.stringify({ date: targetDate, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
