// send-daily-store-sheet
// Builds and sends the nightly Daily Store Sheet summary email.
//
// Invoked by a Supabase cron job. The cron should fire every 30 minutes;
// this function checks whether the current AEST time matches the brand's
// configured send_time, so it's safe to over-call.
//
// Required env vars (same as process-alerts):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY, ALERT_FROM_EMAIL, APP_URL

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowAEST(): Date {
  // Return a Date whose UTC methods give AEST values
  const utc = new Date();
  const aestOffset = 10 * 60; // minutes
  return new Date(utc.getTime() + aestOffset * 60_000);
}

function todayAEST(): string {
  const d = nowAEST();
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function sameDayLastYear(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().split("T")[0];
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(1) + "%";
}

function stars(rating: number): string {
  return "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("ALERT_FROM_EMAIL") ?? "The Coop <onboarding@resend.dev>";
  const APP_URL = Deno.env.get("APP_URL") ?? "";

  const today = todayAEST();
  const aestNow = nowAEST();
  const currentHH = String(aestNow.getUTCHours()).padStart(2, "0");
  const currentMM = aestNow.getUTCMinutes() < 30 ? "00" : "30";
  const currentSlot = `${currentHH}:${currentMM}`;

  // Allow forcing via body: { date?: string, force?: boolean }
  let forceDate: string | null = null;
  let force = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.date) forceDate = body.date;
    if (body.force) force = true;
  } catch { /* ignore */ }

  const targetDate = forceDate ?? today;

  console.log(`[daily-store-sheet] Running for date=${targetDate}, currentSlot=${currentSlot}, force=${force}`);

  try {
    // ── 1. Load all brand settings ──────────────────────────────────────────
    const { data: allSettings } = await supabase
      .from("daily_store_sheet_settings")
      .select("*")
      .eq("enabled", true);

    if (!allSettings?.length) {
      console.log("[daily-store-sheet] No enabled settings found. Exiting.");
      return new Response(
        JSON.stringify({ status: "noop", reason: "no_enabled_settings" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter to settings whose send_time matches the current 30-min slot
    const dueSettings = force
      ? allSettings
      : allSettings.filter((s: { send_time: string }) => s.send_time === currentSlot);

    if (!dueSettings.length) {
      console.log(`[daily-store-sheet] No settings due at ${currentSlot}. Exiting.`);
      return new Response(
        JSON.stringify({ status: "noop", reason: "not_due", currentSlot }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let emailsSent = 0;

    for (const settings of dueSettings) {
      const brandId = settings.brand_id as string;

      // ── 2. Fetch brand restaurants ──────────────────────────────────────
      const { data: restaurants } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("brand_id", brandId)
        .eq("status", "active")
        .order("name");

      if (!restaurants?.length) continue;

      const restaurantIds = restaurants.map((r: { id: string }) => r.id);
      const yoyDate = sameDayLastYear(targetDate);

      // ── 3. Fetch all data in parallel ───────────────────────────────────
      const lookbackDate = new Date(targetDate + "T00:00:00Z");
      lookbackDate.setUTCDate(lookbackDate.getUTCDate() - (settings.review_lookback_days ?? 7));
      const lookbackStr = lookbackDate.toISOString().split("T")[0];

      const [
        { data: salesRows },
        { data: yoySalesRows },
        { data: projectionRows },
        { data: cashUpRows },
        { data: sheetRows },
        { data: reviewRows },
        { data: superadminRows },
      ] = await Promise.all([
        supabase
          .from("sales_daily")
          .select("restaurant_id, date, total_sales, net_sales, transaction_count, delivery_sales, delivery_transaction_count")
          .in("restaurant_id", restaurantIds)
          .eq("date", targetDate),
        supabase
          .from("sales_daily")
          .select("restaurant_id, date, total_sales, net_sales, transaction_count")
          .in("restaurant_id", restaurantIds)
          .eq("date", yoyDate),
        supabase
          .from("daily_projections")
          .select("restaurant_id, date, projected_sales")
          .in("restaurant_id", restaurantIds)
          .eq("date", targetDate),
        supabase
          .from("cash_ups")
          .select("restaurant_id, cash_up_date, till_count, float_amount, amount_deposited, pos_expected_deposit, notes")
          .in("restaurant_id", restaurantIds)
          .eq("cash_up_date", targetDate),
        supabase
          .from("daily_store_sheets")
          .select("restaurant_id, sheet_date, shift_notes")
          .in("restaurant_id", restaurantIds)
          .eq("sheet_date", targetDate),
        supabase
          .from("google_reviews")
          .select("restaurant_id, reviewer_name, rating, comment, review_date")
          .in("restaurant_id", restaurantIds)
          .gte("review_date", lookbackStr)
          .lte("review_date", targetDate)
          .order("review_date", { ascending: false }),
        // Send to superadmins' personal email (contact_email) instead of
        // the recipients list's local/auth email.
        supabase
          .from("profiles")
          .select("id, email, contact_email")
          .eq("role", "superadmin"),
      ]);

      const recipientEmails = (superadminRows ?? [])
        .map((p: { email: string; contact_email?: string | null }) => p.contact_email || p.email)
        .filter(Boolean);

      if (!recipientEmails.length) {
        console.log(`[daily-store-sheet] Brand ${brandId}: no valid recipient emails.`);
        continue;
      }

      // Index by restaurant_id
      const salesMap = new Map((salesRows ?? []).map((r: Record<string, unknown>) => [r.restaurant_id, r]));
      const yoySalesMap = new Map((yoySalesRows ?? []).map((r: Record<string, unknown>) => [r.restaurant_id, r]));
      const projMap = new Map((projectionRows ?? []).map((r: Record<string, unknown>) => [r.restaurant_id, r]));
      const cashUpMap = new Map((cashUpRows ?? []).map((r: Record<string, unknown>) => [r.restaurant_id, r]));
      const sheetMap = new Map((sheetRows ?? []).map((r: Record<string, unknown>) => [r.restaurant_id, r]));
      const reviewsByVenue = new Map<string, Record<string, unknown>[]>();
      for (const r of (reviewRows ?? [])) {
        const rid = r.restaurant_id as string;
        if (!reviewsByVenue.has(rid)) reviewsByVenue.set(rid, []);
        reviewsByVenue.get(rid)!.push(r);
      }

      // ── 4. Build HTML ───────────────────────────────────────────────────
      const dateLabel = new Date(targetDate + "T00:00:00Z").toLocaleDateString("en-AU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });

      // Brand totals
      let brandTotalSales = 0;
      let brandTotalDelivery = 0;
      let brandTotalTransactions = 0;
      let brandTotalYoY = 0;
      let brandTotalYoYExists = false;

      const venueBlocks: string[] = [];

      for (const restaurant of restaurants) {
        const rid = restaurant.id as string;
        const name = restaurant.name as string;

        const sales = salesMap.get(rid) as Record<string, unknown> | undefined;
        const yoy = yoySalesMap.get(rid) as Record<string, unknown> | undefined;
        const proj = projMap.get(rid) as Record<string, unknown> | undefined;
        const cashUp = cashUpMap.get(rid) as Record<string, unknown> | undefined;
        const sheet = sheetMap.get(rid) as Record<string, unknown> | undefined;
        const reviews = reviewsByVenue.get(rid) ?? [];

        const netSales = (sales?.net_sales ?? sales?.total_sales ?? 0) as number;
        const totalSales = (sales?.total_sales ?? 0) as number;
        const txCount = (sales?.transaction_count ?? 0) as number;
        const deliverySales = (sales?.delivery_sales ?? 0) as number;

        brandTotalSales += netSales;
        brandTotalDelivery += deliverySales;
        brandTotalTransactions += txCount;

        if (yoy) {
          brandTotalYoYExists = true;
          brandTotalYoY += (yoy.net_sales ?? yoy.total_sales ?? 0) as number;
        }

        let sections = "";

        // Sales
        if (settings.include_sales) {
          sections += `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;font-weight:600;">Sales</td>
                </tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border-radius:6px;">
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Net Sales</td>
                        <td style="font-size:13px;font-weight:700;color:#18181b;text-align:right;">${fmtCurrency(netSales)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Total Sales</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(totalSales)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Transactions</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${txCount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        }

        // Delivery
        if (settings.include_delivery && deliverySales > 0) {
          const deliveryPct = totalSales > 0 ? (deliverySales / totalSales) * 100 : 0;
          const deliveryTx = (sales?.delivery_transaction_count ?? 0) as number;
          sections += `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;font-weight:600;">Delivery</td></tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border-radius:6px;">
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Delivery Sales</td>
                        <td style="font-size:13px;font-weight:700;color:#18181b;text-align:right;">${fmtCurrency(deliverySales)} (${fmtPct(deliveryPct)})</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Delivery Orders</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${deliveryTx}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        }

        // YoY
        if (settings.include_yoy && yoy) {
          const yoyNet = (yoy.net_sales ?? yoy.total_sales ?? 0) as number;
          const yoyDiff = netSales - yoyNet;
          const yoyPct = yoyNet > 0 ? (yoyDiff / yoyNet) * 100 : 0;
          const arrow = yoyDiff >= 0 ? "▲" : "▼";
          const color = yoyDiff >= 0 ? "#16a34a" : "#dc2626";
          sections += `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;font-weight:600;">Year-on-Year</td></tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border-radius:6px;">
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Same day last year</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(yoyNet)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Variance</td>
                        <td style="font-size:13px;font-weight:700;color:${color};text-align:right;">${arrow} ${fmtCurrency(Math.abs(yoyDiff))} (${fmtPct(Math.abs(yoyPct))})</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        }

        // Projections
        if (settings.include_projections && proj) {
          const projected = (proj.projected_sales ?? 0) as number;
          const variance = netSales - projected;
          const variancePct = projected > 0 ? (variance / projected) * 100 : 0;
          const arrow = variance >= 0 ? "▲" : "▼";
          const color = variance >= 0 ? "#16a34a" : "#dc2626";
          sections += `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;font-weight:600;">Projection Variance</td></tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border-radius:6px;">
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Projected</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(projected)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Actual</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(netSales)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Variance</td>
                        <td style="font-size:13px;font-weight:700;color:${color};text-align:right;">${arrow} ${fmtCurrency(Math.abs(variance))} (${fmtPct(Math.abs(variancePct))})</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        }

        // Cash Up
        if (settings.include_cashup && cashUp) {
          const tillCount = (cashUp.till_count ?? 0) as number;
          const expected = (cashUp.pos_expected_deposit ?? 0) as number;
          const deposited = (cashUp.amount_deposited ?? 0) as number;
          const cashVariance = deposited - expected;
          const varColor = Math.abs(cashVariance) < 1 ? "#18181b" : cashVariance >= 0 ? "#16a34a" : "#dc2626";
          sections += `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;font-weight:600;">Cash Up</td></tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border-radius:6px;">
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Till Count</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(tillCount)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Expected Deposit</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(expected)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Actual Deposit</td>
                        <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(deposited)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#52525b;">Variance</td>
                        <td style="font-size:13px;font-weight:700;color:${varColor};text-align:right;">${fmtCurrency(cashVariance)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        }

        // Shift Notes
        if (settings.include_notes) {
          const notes = (sheet?.shift_notes ?? null) as string | null;
          sections += `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;font-weight:600;">Shift Notes</td></tr>
                <tr>
                  <td style="font-size:13px;color:#3f3f46;${notes ? '' : 'font-style:italic;color:#a1a1aa;'}padding:6px 0;">
                    ${notes ? notes.replace(/\n/g, "<br>") : "No notes recorded"}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        }

        // Reviews
        if (settings.include_reviews && reviews.length > 0) {
          const reviewHtml = reviews.map((r) => `
            <tr>
              <td style="padding:6px 0;border-bottom:1px solid #f4f4f5;">
                <div style="font-size:13px;color:#f59e0b;letter-spacing:1px;">${stars(r.rating as number)}</div>
                <div style="font-size:12px;color:#71717a;margin-top:2px;">${r.reviewer_name ?? "Anonymous"} &middot; ${r.review_date}</div>
                ${r.comment ? `<div style="font-size:13px;color:#3f3f46;margin-top:4px;">${(r.comment as string).substring(0, 200)}${(r.comment as string).length > 200 ? "…" : ""}</div>` : ""}
              </td>
            </tr>`).join("");

          sections += `
          <tr>
            <td style="padding:8px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;font-weight:600;">Google Reviews (last ${settings.review_lookback_days ?? 7} days)</td></tr>
                ${reviewHtml}
              </table>
            </td>
          </tr>`;
        }

        venueBlocks.push(`
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
          <tr>
            <td style="background:#0E1726;border-radius:8px 8px 0 0;padding:14px 20px;">
              <h2 style="margin:0;color:white;font-size:16px;font-weight:700;">${name}</h2>
            </td>
          </tr>
          <tr>
            <td style="background:white;border:1px solid #e4e4e7;border-top:0;border-radius:0 0 8px 8px;padding:12px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                ${sections || '<tr><td style="font-size:13px;color:#a1a1aa;font-style:italic;padding:8px 0;">No data recorded for today.</td></tr>'}
              </table>
            </td>
          </tr>
        </table>`);
      }

      // Brand summary
      const yoyBrandDiff = brandTotalYoYExists ? brandTotalSales - brandTotalYoY : null;
      const yoyBrandPct = brandTotalYoYExists && brandTotalYoY > 0 ? ((brandTotalSales - brandTotalYoY) / brandTotalYoY) * 100 : null;

      const brandSummary = `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="background:#FF6B2C;border-radius:8px 8px 0 0;padding:18px 20px;">
            <h1 style="margin:0;color:white;font-size:20px;font-weight:700;">Daily Store Sheet</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${dateLabel}</p>
          </td>
        </tr>
        <tr>
          <td style="background:white;border:1px solid #e4e4e7;border-top:0;border-radius:0 0 8px 8px;padding:16px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr><td style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:8px;font-weight:600;">Brand Summary — All Venues</td></tr>
              <tr>
                <td>
                  <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border-radius:6px;">
                    <tr>
                      <td style="font-size:13px;color:#52525b;">Total Net Sales</td>
                      <td style="font-size:15px;font-weight:700;color:#18181b;text-align:right;">${fmtCurrency(brandTotalSales)}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#52525b;">Total Delivery</td>
                      <td style="font-size:13px;color:#18181b;text-align:right;">${fmtCurrency(brandTotalDelivery)}${brandTotalSales > 0 ? ` (${fmtPct((brandTotalDelivery / brandTotalSales) * 100)})` : ""}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#52525b;">Total Transactions</td>
                      <td style="font-size:13px;color:#18181b;text-align:right;">${brandTotalTransactions}</td>
                    </tr>
                    ${brandTotalYoYExists ? `
                    <tr>
                      <td style="font-size:13px;color:#52525b;">vs Last Year</td>
                      <td style="font-size:13px;font-weight:700;color:${yoyBrandDiff! >= 0 ? "#16a34a" : "#dc2626"};text-align:right;">${yoyBrandDiff! >= 0 ? "▲" : "▼"} ${fmtCurrency(Math.abs(yoyBrandDiff!))} (${fmtPct(Math.abs(yoyBrandPct!))})</td>
                    </tr>` : ""}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    ${brandSummary}
    ${venueBlocks.join("\n")}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;">
      <tr>
        <td style="text-align:center;padding:16px;">
          <a href="${APP_URL}/daily-sheet" style="display:inline-block;background:#0E1726;color:white;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:600;font-size:14px;">
            View in ORBIT &rarr;
          </a>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;padding:8px 0 0;">
          <p style="margin:0;color:#a1a1aa;font-size:11px;">
            Sent by ORBIT &middot; <a href="${APP_URL}/admin/settings/daily-sheet" style="color:#FF6B2C;">Manage settings</a>
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

      // ── 5. Send email ─────────────────────────────────────────────────────
      if (!RESEND_API_KEY) {
        console.log(`[daily-store-sheet] No RESEND_API_KEY. Would email: ${recipientEmails.join(", ")}`);
        continue;
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipientEmails,
          subject: `Daily Store Sheet — ${dateLabel}`,
          html,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[daily-store-sheet] Resend error ${response.status}: ${body}`);
      } else {
        emailsSent++;
        console.log(`[daily-store-sheet] Brand ${brandId}: email sent to ${recipientEmails.length} recipients.`);
      }
    }

    return new Response(
      JSON.stringify({ status: "success", date: targetDate, emailsSent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[daily-store-sheet] Fatal error:", message);
    return new Response(
      JSON.stringify({ status: "error", error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
