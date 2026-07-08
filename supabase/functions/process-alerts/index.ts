// process-alerts
// Evaluates all active alert rules against latest data.
// Called by:
//   - nightly-sync (step 4) — runs all alert checks
//   - sync-google-reviews completion — bad_review only
//   - Supabase cron at 10am AEST ("0 0 * * *" UTC) — missing_deposit only
//
// Deduplication: one alert per (alert_type, restaurant_id) per calendar day (AEST).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlertConfigRow {
  id: string;
  alert_type: string;
  enabled: boolean;
  global_threshold: Record<string, number | string>;
  restaurant_overrides: Record<string, Record<string, number | string>>;
  recipients: string[];
}

interface Restaurant {
  id: string;
  name: string;
  created_at: string;
}

interface SalesDaily {
  restaurant_id: string;
  date: string;
  net_sales: number | null;
  total_sales: number;
  transaction_count: number;
}

interface LabourDaily {
  restaurant_id: string;
  date: string;
  total_cost: number;
  total_hours: number;
}

interface CashDeposit {
  restaurant_id: string;
  deposit_date: string;
}

interface GoogleReview {
  id: string;
  restaurant_id: string;
  rating: number;
  reviewer_name: string | null;
  review_date: string;
}

interface Target {
  restaurant_id: string;
  metric: string;
  day_of_week: number | null;
  value: number;
}

interface TriggeredAlert {
  alert_type: string;
  restaurant_id: string;
  severity: "warning" | "urgent" | "critical";
  title: string;
  message: string;
  metric_value: number | null;
  threshold_value: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getThreshold(
  config: AlertConfigRow,
  restaurantId: string,
  key: string
): number {
  const override = config.restaurant_overrides?.[restaurantId]?.[key];
  if (override !== undefined) return Number(override);
  return Number(config.global_threshold[key] ?? 0);
}

function todayAEST(): string {
  return new Date().toLocaleDateString("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).split("/").reverse().join("-");
}

function yesterdayAEST(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).split("/").reverse().join("-");
}

function jsDayToTargetDow(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

// ── Email sending ─────────────────────────────────────────────────────────────

async function sendAlertEmail(
  alert: TriggeredAlert,
  recipientEmails: string[],
  restaurantName: string,
  reportUrl: string
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("ALERT_FROM_EMAIL") ?? "alerts@thecoopops.com.au";

  if (!RESEND_API_KEY || !recipientEmails.length) {
    console.log(
      `[process-alerts] No RESEND_API_KEY or no recipients for ${alert.alert_type}. Would email: ${recipientEmails.join(", ")}`
    );
    return;
  }

  const severityColor =
    alert.severity === "urgent" ? "#ef4444" : "#f59e0b";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:${severityColor};border-radius:8px 8px 0 0;padding:24px;">
      <h1 style="margin:0;color:white;font-size:20px;font-weight:700;">
        🔔 ${alert.title}
      </h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
        ${restaurantName} &mdash; ${new Date().toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "full" })}
      </p>
    </div>
    <div style="background:white;border-radius:0 0 8px 8px;padding:24px;border:1px solid #e4e4e7;border-top:0;">
      <p style="margin:0 0 20px;color:#18181b;font-size:15px;">${alert.message}</p>
      ${alert.metric_value !== null ? `
      <div style="background:#f4f4f5;border-radius:6px;padding:12px 16px;margin:0 0 20px;">
        <p style="margin:0;font-size:13px;color:#71717a;">Actual value</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#18181b;">${alert.metric_value}</p>
        ${alert.threshold_value !== null ? `<p style="margin:4px 0 0;font-size:12px;color:#a1a1aa;">Threshold: ${alert.threshold_value}</p>` : ""}
      </div>` : ""}
      <a href="${reportUrl}" style="display:inline-block;background:${severityColor};color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">
        View Report &rarr;
      </a>
      <hr style="margin:24px 0;border:0;border-top:1px solid #e4e4e7;">
      <p style="margin:0;color:#a1a1aa;font-size:12px;">
        This alert was generated by The Coop. To manage alert settings, visit your
        <a href="${Deno.env.get("APP_URL") ?? "#"}/settings/alerts" style="color:#f97316;">alert preferences</a>.
      </p>
    </div>
  </div>
</body>
</html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: recipientEmails,
      subject: `[The Coop Alert] ${alert.title} — ${restaurantName}`,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }
}

// ── Main serve handler ────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Optional body: { mode: "all" | "bad_review" | "missing_deposit" }
  let mode: "all" | "bad_review" | "missing_deposit" = "all";
  try {
    const body = await req.json().catch(() => ({}));
    if (body.mode) mode = body.mode;
  } catch { /* ignore */ }

  const today = todayAEST();
  const yesterday = yesterdayAEST();
  const yesterdayDate = new Date(yesterday);
  const dow = jsDayToTargetDow(yesterdayDate.getDay());

  console.log(`[process-alerts] Running mode=${mode} for date=${yesterday}`);

  try {
    // ── Fetch everything in parallel ────────────────────────────────────────
    const [
      { data: configs },
      { data: restaurants },
      { data: salesRows },
      { data: labourRows },
      { data: depositRows },
      { data: reviewRows },
      { data: targetRows },
      { data: profileRows },
    ] = await Promise.all([
      supabase
        .from("alert_configs")
        .select("*")
        .eq("enabled", true),
      supabase
        .from("restaurants")
        .select("id, name, created_at")
        .eq("status", "active"),
      supabase
        .from("sales_daily")
        .select("restaurant_id, date, net_sales, total_sales, transaction_count")
        .eq("date", yesterday),
      supabase
        .from("labour_daily")
        .select("restaurant_id, date, total_cost, total_hours")
        .eq("date", yesterday),
      supabase
        .from("cash_deposits")
        .select("restaurant_id, deposit_date")
        .gte("deposit_date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]),
      supabase
        .from("google_reviews")
        .select("id, restaurant_id, rating, reviewer_name, review_date")
        .gte("review_date", yesterday)
        .order("review_date", { ascending: false }),
      supabase
        .from("targets")
        .select("restaurant_id, metric, day_of_week, value"),
      supabase
        .from("profiles")
        .select("id, email, full_name"),
    ]);

    const alertConfigs = (configs ?? []) as AlertConfigRow[];
    const allRestaurants = (restaurants ?? []) as Restaurant[];
    const allSales = (salesRows ?? []) as SalesDaily[];
    const allLabour = (labourRows ?? []) as LabourDaily[];
    const allDeposits = (depositRows ?? []) as CashDeposit[];
    const allReviews = (reviewRows ?? []) as GoogleReview[];
    const allTargets = (targetRows ?? []) as Target[];
    const allProfiles = (profileRows ?? []) as { id: string; email: string; full_name: string }[];

    const configMap: Record<string, AlertConfigRow> = {};
    for (const c of alertConfigs) configMap[c.alert_type] = c;

    // ── Check which alerts already fired today ───────────────────────────────
    const { data: existingAlerts } = await supabase
      .from("alert_history")
      .select("alert_type, restaurant_id")
      .gte("triggered_at", today + "T00:00:00.000Z")
      .lte("triggered_at", today + "T23:59:59.999Z");

    const alreadyFired = new Set(
      (existingAlerts ?? []).map(
        (a: { alert_type: string; restaurant_id: string }) =>
          `${a.alert_type}:${a.restaurant_id}`
      )
    );

    function alreadySent(alertType: string, restaurantId: string): boolean {
      return alreadyFired.has(`${alertType}:${restaurantId}`);
    }

    function getTarget(
      restaurantId: string,
      metric: string,
      dayOfWeek?: number | null
    ): number | null {
      const t = allTargets.find(
        (row) =>
          row.restaurant_id === restaurantId &&
          row.metric === metric &&
          (dayOfWeek === undefined
            ? true
            : row.day_of_week === (dayOfWeek ?? null))
      );
      return t?.value ?? null;
    }

    const triggered: TriggeredAlert[] = [];

    for (const restaurant of allRestaurants) {
      const rid = restaurant.id;
      const sales = allSales.find((s) => s.restaurant_id === rid);
      const labour = allLabour.find((l) => l.restaurant_id === rid);

      // ── 1. Sales Dip ─────────────────────────────────────────────────────
      if ((mode === "all") && configMap.sales_dip && !alreadySent("sales_dip", rid)) {
        const pctThreshold = getThreshold(configMap.sales_dip, rid, "percentage");
        const target = getTarget(rid, "daily_sales", dow);
        if (target && sales) {
          const netSales = sales.net_sales ?? sales.total_sales;
          const pct = (netSales / target) * 100;
          if (pct < pctThreshold) {
            triggered.push({
              alert_type: "sales_dip",
              restaurant_id: rid,
              severity: "warning",
              title: `Sales Dip — ${restaurant.name}`,
              message: `Net sales of $${netSales.toFixed(0)} are ${(100 - pct).toFixed(1)}% below the ${pctThreshold}% threshold (target: $${target.toFixed(0)}).`,
              metric_value: Math.round(pct * 10) / 10,
              threshold_value: pctThreshold,
            });
          }
        }
      }

      // ── 2. Labour Spike ──────────────────────────────────────────────────
      if ((mode === "all") && configMap.labour_spike && !alreadySent("labour_spike", rid)) {
        const pctThreshold = getThreshold(configMap.labour_spike, rid, "percentage");
        if (sales && labour) {
          const netSales = sales.net_sales ?? sales.total_sales;
          if (netSales > 0) {
            const labourPct = (labour.total_cost / netSales) * 100;
            if (labourPct > pctThreshold) {
              triggered.push({
                alert_type: "labour_spike",
                restaurant_id: rid,
                severity: "warning",
                title: `Labour Spike — ${restaurant.name}`,
                message: `Labour cost is ${labourPct.toFixed(1)}%, exceeding the ${pctThreshold}% threshold.`,
                metric_value: Math.round(labourPct * 10) / 10,
                threshold_value: pctThreshold,
              });
            }
          }
        }
      }

      // ── 3. Bad Review ────────────────────────────────────────────────────
      if ((mode === "all" || mode === "bad_review") && configMap.bad_review) {
        const starThreshold = getThreshold(configMap.bad_review, rid, "stars");
        const badReviews = allReviews.filter(
          (r) =>
            r.restaurant_id === rid &&
            r.rating <= starThreshold &&
            !alreadySent("bad_review", rid)
        );
        if (badReviews.length > 0) {
          const review = badReviews[0];
          triggered.push({
            alert_type: "bad_review",
            restaurant_id: rid,
            severity: "urgent",
            title: `Bad Review — ${restaurant.name}`,
            message: `${review.reviewer_name ?? "Anonymous"} left a ${review.rating}★ review (threshold: ≤${starThreshold}★).`,
            metric_value: review.rating,
            threshold_value: starThreshold,
          });
        }
      }

      // ── 4. Overtime Warning ──────────────────────────────────────────────
      if ((mode === "all") && configMap.overtime_warning && !alreadySent("overtime_warning", rid)) {
        const hoursThreshold = getThreshold(configMap.overtime_warning, rid, "hours");
        if (labour && labour.total_hours > hoursThreshold) {
          triggered.push({
            alert_type: "overtime_warning",
            restaurant_id: rid,
            severity: "warning",
            title: `Overtime Warning — ${restaurant.name}`,
            message: `Total hours ${labour.total_hours.toFixed(1)}h exceeds the ${hoursThreshold}h/week threshold.`,
            metric_value: Math.round(labour.total_hours * 10) / 10,
            threshold_value: hoursThreshold,
          });
        }
      }

      // ── 5. Low Transactions ──────────────────────────────────────────────
      if ((mode === "all") && configMap.low_transactions && !alreadySent("low_transactions", rid)) {
        const pctThreshold = getThreshold(configMap.low_transactions, rid, "percentage");
        const target = getTarget(rid, "transaction_count", dow);
        if (target && sales && sales.transaction_count < (target * pctThreshold) / 100) {
          const pct = (sales.transaction_count / target) * 100;
          triggered.push({
            alert_type: "low_transactions",
            restaurant_id: rid,
            severity: "warning",
            title: `Low Transactions — ${restaurant.name}`,
            message: `${sales.transaction_count} transactions (${pct.toFixed(0)}% of target ${Math.round(target)}), below the ${pctThreshold}% threshold.`,
            metric_value: sales.transaction_count,
            threshold_value: pctThreshold,
          });
        }
      }

      // ── 6. Missing Deposit ───────────────────────────────────────────────
      if ((mode === "all" || mode === "missing_deposit") && configMap.missing_deposit && !alreadySent("missing_deposit", rid)) {
        const businessDays = getThreshold(configMap.missing_deposit, rid, "business_days");
        const restaurantDeposits = allDeposits.filter(
          (d) => d.restaurant_id === rid
        );
        const lastDeposit = restaurantDeposits.sort(
          (a, b) =>
            new Date(b.deposit_date).getTime() - new Date(a.deposit_date).getTime()
        )[0];

        let daysSinceDeposit: number;
        if (!lastDeposit) {
          daysSinceDeposit = 999;
        } else {
          daysSinceDeposit = Math.floor(
            (Date.now() - new Date(lastDeposit.deposit_date).getTime()) /
              86400000
          );
        }

        if (daysSinceDeposit > businessDays) {
          triggered.push({
            alert_type: "missing_deposit",
            restaurant_id: rid,
            severity: "warning",
            title: `Missing Deposit — ${restaurant.name}`,
            message: lastDeposit
              ? `No cash deposit recorded in ${daysSinceDeposit} business days (threshold: ${businessDays} days).`
              : `No cash deposit has ever been recorded for this store.`,
            metric_value: daysSinceDeposit,
            threshold_value: businessDays,
          });
        }
      }
    }

    // ── Insert triggered alerts ──────────────────────────────────────────────
    let inserted = 0;
    const emailPromises: Promise<void>[] = [];

    for (const alert of triggered) {
      const { data: insertedRow, error } = await supabase
        .from("alert_history")
        .insert({
          alert_type: alert.alert_type,
          restaurant_id: alert.restaurant_id,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          metric_value: alert.metric_value,
          threshold_value: alert.threshold_value,
          triggered_at: new Date().toISOString(),
          acknowledged: false,
          email_sent: false,
        })
        .select("id")
        .single();

      if (!error && insertedRow) {
        inserted++;

        // Queue email
        const config = configMap[alert.alert_type];
        if (config?.recipients?.length) {
          const recipientEmails = allProfiles
            .filter((p) => config.recipients.includes(p.id))
            .map((p) => p.email)
            .filter(Boolean);

          if (recipientEmails.length) {
            const restaurant = allRestaurants.find((r) => r.id === alert.restaurant_id);
            const reportUrls: Record<string, string> = {
              sales_dip: "/reports/sales",
              labour_spike: "/reports/labour",
              bad_review: "/reports/reviews",
              overtime_warning: "/reports/labour",
              low_transactions: "/reports/sales",
              missing_deposit: "/cash",
            };
            const reportUrl =
              (Deno.env.get("APP_URL") ?? "") +
              (reportUrls[alert.alert_type] ?? "/");

            emailPromises.push(
              sendAlertEmail(
                alert,
                recipientEmails,
                restaurant?.name ?? "Store",
                reportUrl
              ).then(async () => {
                await supabase
                  .from("alert_history")
                  .update({
                    email_sent: true,
                    email_sent_at: new Date().toISOString(),
                  })
                  .eq("id", insertedRow.id);
              }).catch((err) => {
                console.error(`[process-alerts] Email failed for ${alert.alert_type}: ${err.message}`);
              })
            );
          }
        }
      }
    }

    // Send all emails (non-blocking, best effort)
    await Promise.allSettled(emailPromises);

    console.log(
      `[process-alerts] Done. Triggered ${triggered.length}, inserted ${inserted}, emails queued ${emailPromises.length}`
    );

    return new Response(
      JSON.stringify({
        status: "success",
        mode,
        date: yesterday,
        triggered: triggered.length,
        inserted,
        alerts: triggered.map((a) => ({
          type: a.alert_type,
          restaurant_id: a.restaurant_id,
          title: a.title,
        })),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[process-alerts] Fatal error:", message);
    return new Response(
      JSON.stringify({ status: "error", error: message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
