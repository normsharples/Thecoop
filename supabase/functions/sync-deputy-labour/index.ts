// sync-deputy-labour
// Pulls previous day's timesheets and roster from Deputy for configured locations.
// Calculates scheduled/actual hours, labour cost, overtime, hours by role.
// Upserts into labour_daily with labour_cost_pct derived from sales_daily.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT_DELAY_MS = 500;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Returns YYYY-MM-DD for Melbourne timezone, daysAgo days in the past. */
function getMelbourneDate(daysAgo = 1): string {
  const now = new Date();
  const melb = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [d, m, y] = melb.split("/");
  const date = new Date(`${y}-${m}-${d}`);
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

async function deputyGet(
  baseUrl: string,
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<unknown[]> {
  const url = new URL(`${baseUrl}/api/v1/${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const results: unknown[] = [];
  let start = 0;
  const limit = 500;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    url.searchParams.set("start", String(start));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      await delay(Number(res.headers.get("Retry-After") ?? "5") * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Deputy API error ${res.status}: ${await res.text()}`);
    }

    const page = (await res.json()) as unknown[];
    results.push(...page);
    if (page.length < limit) break;
    start += limit;
    await delay(RATE_LIMIT_DELAY_MS);
  }
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const targetDate = getMelbourneDate(1);

  // Load Deputy global settings
  const { data: setting, error: settingError } = await supabase
    .from("integration_settings")
    .select("*")
    .eq("provider", "deputy")
    .maybeSingle();

  if (settingError || !setting) {
    return new Response(
      JSON.stringify({ error: "Deputy not configured" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  const { api_token, account_url } = setting.credentials as {
    api_token: string;
    account_url: string;
  };
  const locationMapping = (
    (setting.config as { location_mapping?: { deputy_location_id: string; restaurant_id: string }[] })
      ?.location_mapping ?? []
  );

  if (!api_token || !account_url) {
    return new Response(
      JSON.stringify({ error: "Deputy credentials incomplete" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  const baseUrl = account_url.replace(/\/$/, "");
  const results = [];

  for (const mapping of locationMapping) {
    const { deputy_location_id, restaurant_id } = mapping;
    if (!deputy_location_id || !restaurant_id) continue;

    const logEntry = {
      provider: "deputy",
      restaurant_id,
      started_at: new Date().toISOString(),
      status: "success" as const,
      records_synced: 0,
      error_message: null as string | null,
      completed_at: null as string | null,
    };

    try {
      // Date range for the target day (Melbourne time expressed as Unix timestamps)
      const dayStart = new Date(`${targetDate}T00:00:00+11:00`); // AEDT; Deputy accepts timestamps
      const dayEnd = new Date(`${targetDate}T23:59:59+11:00`);

      // Fetch timesheets for this location and date
      const timesheets = (await deputyGet(baseUrl, api_token, "resource/Timesheet", {
        search: JSON.stringify({
          search: [
            { field: "OperationalUnitId", type: "eq", data: parseInt(deputy_location_id) },
            { field: "Date", type: "ge", data: dayStart.toISOString().split("T")[0] },
            { field: "Date", type: "le", data: dayEnd.toISOString().split("T")[0] },
          ],
        }),
      })) as Array<{
        TotalTime: number;
        Cost: number;
        Time: number;
        Mealbreak: number;
        Employee: number;
        OperationalUnitId: number;
        Open: boolean;
      }>;

      await delay(RATE_LIMIT_DELAY_MS);

      // Fetch roster/schedule for this location and date
      const rosters = (await deputyGet(baseUrl, api_token, "resource/Roster", {
        search: JSON.stringify({
          search: [
            { field: "OperationalUnitId", type: "eq", data: parseInt(deputy_location_id) },
            { field: "Date", type: "ge", data: targetDate },
            { field: "Date", type: "le", data: targetDate },
          ],
        }),
      })) as Array<{ StartTime: number; EndTime: number; EmployeeId: number }>;

      await delay(RATE_LIMIT_DELAY_MS);

      // Fetch employees for role info
      const employees = (await deputyGet(baseUrl, api_token, "resource/Employee")) as Array<{
        Id: number;
        DisplayName: string;
        MainPosition?: { OperationalUnitName: string };
      }>;

      const employeeMap = new Map(employees.map((e) => [e.Id, e]));

      // Calculate hours
      const actualHours = timesheets
        .filter((t) => !t.Open)
        .reduce((sum, t) => sum + t.TotalTime / 3600, 0);

      const scheduledSeconds = rosters.reduce((sum, r) => sum + (r.EndTime - r.StartTime), 0);
      const scheduledHours = scheduledSeconds / 3600;

      const labourCost = timesheets.reduce((sum, t) => sum + t.Cost, 0);

      // Overtime: hours > 8 per shift (simple threshold)
      const OVERTIME_THRESHOLD = 8;
      const overtimeHours = timesheets.reduce((sum, t) => {
        const shiftHours = t.TotalTime / 3600;
        return sum + Math.max(0, shiftHours - OVERTIME_THRESHOLD);
      }, 0);

      // Hours by role
      const roleHours: Record<string, number> = {};
      for (const ts of timesheets) {
        const emp = employeeMap.get(ts.Employee);
        const role = emp?.MainPosition?.OperationalUnitName ?? "General";
        roleHours[role] = (roleHours[role] ?? 0) + ts.TotalTime / 3600;
      }
      const hoursByRole = Object.entries(roleHours).map(([role, hours]) => ({
        role,
        hours: Math.round(hours * 100) / 100,
      }));

      // Get sales for labour % calculation
      const { data: sales } = await supabase
        .from("sales_daily")
        .select("total_sales")
        .eq("restaurant_id", restaurant_id)
        .eq("date", targetDate)
        .maybeSingle();

      const labourPercent =
        sales?.total_sales && Number(sales.total_sales) > 0
          ? (labourCost / Number(sales.total_sales)) * 100
          : 0;

      const { error: upsertError } = await supabase.from("labour_daily").upsert(
        {
          restaurant_id,
          date: targetDate,
          total_hours: Math.round(actualHours * 100) / 100,
          scheduled_hours: Math.round(scheduledHours * 100) / 100,
          overtime_hours: Math.round(overtimeHours * 100) / 100,
          total_cost: Math.round(labourCost * 100) / 100,
          labour_percent: Math.round(labourPercent * 100) / 100,
          hours_by_role: hoursByRole,
          source: "deputy",
        },
        { onConflict: "restaurant_id,date" }
      );
      if (upsertError) throw new Error(upsertError.message);

      logEntry.records_synced = timesheets.length;
      logEntry.completed_at = new Date().toISOString();
      results.push({ restaurant_id, status: "success", records: timesheets.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logEntry.status = "error" as const;
      logEntry.error_message = msg;
      logEntry.completed_at = new Date().toISOString();
      results.push({ restaurant_id, status: "error", error: msg });
    }

    await supabase.from("sync_logs").insert(logEntry);
    await delay(RATE_LIMIT_DELAY_MS);
  }

  // Update global Deputy sync status
  const hasErrors = results.some((r) => r.status === "error");
  await supabase
    .from("integration_settings")
    .update({
      last_sync_at: new Date().toISOString(),
      sync_status: hasErrors ? "error" : "success",
      sync_error: hasErrors
        ? results
            .filter((r) => r.status === "error")
            .map((r) => r.error)
            .join("; ")
        : null,
    })
    .eq("provider", "deputy");

  return new Response(JSON.stringify({ date: targetDate, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
