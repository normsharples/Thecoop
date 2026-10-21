// nightly-sync
// Master orchestrator running at 4:00 AM AEST.
// Runs: Lightspeed → Square → Deputy → Google Reviews → process-alerts → the
// daily people jobs (onboarding reminders, document expiry, Pulse survey
// statuses, scheduled offboarding access revocation) in sequence.
// Continues on failure, logs each step, sends summary if errors occurred.
// Schedule via Supabase cron: "0 17 * * *" (UTC = 4 AM AEDT / 3 AM AEST)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface StepResult {
  step: string;
  status: "success" | "error";
  data?: unknown;
  error?: string;
  duration_ms: number;
}

async function invokeFunction(
  supabase: ReturnType<typeof createClient>,
  name: string,
  body?: Record<string, unknown>
): Promise<{ data: unknown; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(name, {
      body: body ? JSON.stringify(body) : undefined,
    });
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const overallStart = Date.now();
  const steps: StepResult[] = [];
  const errors: string[] = [];

  // ── Step 1: Lightspeed Sales ─────────────────────────────────────────────
  {
    const t = Date.now();
    console.log("[nightly-sync] Running Lightspeed sales sync...");
    const { data, error } = await invokeFunction(supabase, "sync-lightspeed-sales");
    const result: StepResult = {
      step: "sync-lightspeed-sales",
      status: error ? "error" : "success",
      data,
      error: error ?? undefined,
      duration_ms: Date.now() - t,
    };
    steps.push(result);
    if (error) errors.push(`Lightspeed: ${error}`);
    console.log(`[nightly-sync] Lightspeed done in ${result.duration_ms}ms — ${result.status}`);
  }

  // ── Step 1b: Square Sales (venues on Square) ─────────────────────────────
  {
    const t = Date.now();
    console.log("[nightly-sync] Running Square sales sync...");
    const { data, error } = await invokeFunction(supabase, "sync-square", { action: "sync" });
    const result: StepResult = {
      step: "sync-square",
      status: error ? "error" : "success",
      data,
      error: error ?? undefined,
      duration_ms: Date.now() - t,
    };
    steps.push(result);
    if (error) errors.push(`Square: ${error}`);
    console.log(`[nightly-sync] Square done in ${result.duration_ms}ms — ${result.status}`);
  }

  // ── Step 2: Deputy Labour ────────────────────────────────────────────────
  {
    const t = Date.now();
    console.log("[nightly-sync] Running Deputy labour sync...");
    const { data, error } = await invokeFunction(supabase, "sync-deputy-labour");
    const result: StepResult = {
      step: "sync-deputy-labour",
      status: error ? "error" : "success",
      data,
      error: error ?? undefined,
      duration_ms: Date.now() - t,
    };
    steps.push(result);
    if (error) errors.push(`Deputy: ${error}`);
    console.log(`[nightly-sync] Deputy done in ${result.duration_ms}ms — ${result.status}`);
  }

  // ── Step 3: Google Reviews ───────────────────────────────────────────────
  {
    const t = Date.now();
    console.log("[nightly-sync] Running Google Reviews sync...");
    const { data, error } = await invokeFunction(supabase, "sync-google-reviews");
    const result: StepResult = {
      step: "sync-google-reviews",
      status: error ? "error" : "success",
      data,
      error: error ?? undefined,
      duration_ms: Date.now() - t,
    };
    steps.push(result);
    if (error) errors.push(`Google Reviews: ${error}`);
    console.log(`[nightly-sync] Google done in ${result.duration_ms}ms — ${result.status}`);
  }

  // ── Step 4: Process Alerts ───────────────────────────────────────────────
  {
    const t = Date.now();
    console.log("[nightly-sync] Running process-alerts...");
    const { data, error } = await invokeFunction(
      supabase,
      "process-alerts",
      { mode: "all" }
    );
    const result: StepResult = {
      step: "process-alerts",
      status: error ? "error" : "success",
      data,
      error: error ?? undefined,
      duration_ms: Date.now() - t,
    };
    steps.push(result);
    if (error) errors.push(`Alerts: ${error}`);
    console.log(`[nightly-sync] Alerts done in ${result.duration_ms}ms — ${result.status}`);
  }

  // ── Step 5: daily people jobs ────────────────────────────────────────────
  // Four idempotent SQL functions, safe to call more than once a day. This is
  // the pattern migration 064 set out ("…or by adding two supabase.rpc() calls
  // to the nightly-sync edge function") — 093 and 095 added two more:
  //
  //   onboarding_send_reminders()        064 — chase unfinished onboarding
  //   document_expiry_alerts()           064 — 30-day certificate warnings
  //   pulse_refresh_statuses()           093 — open/close scheduled check-ins
  //   offboarding_process_revocations()  095 — end access after the last shift
  //
  // Running them here rather than under pg_cron keeps every scheduled job in
  // one place, and means a failure shows up in sync_logs like any other step.
  {
    const peopleJobs: { name: string; label: string }[] = [
      { name: "onboarding_send_reminders", label: "Onboarding reminders" },
      { name: "document_expiry_alerts", label: "Document expiry alerts" },
      { name: "pulse_refresh_statuses", label: "Pulse survey statuses" },
      { name: "offboarding_process_revocations", label: "Offboarding revocations" },
    ];

    for (const job of peopleJobs) {
      const t = Date.now();
      console.log(`[nightly-sync] Running ${job.name}...`);
      const { data, error } = await supabase.rpc(job.name);
      const result: StepResult = {
        step: job.name,
        status: error ? "error" : "success",
        data,
        error: error?.message ?? undefined,
        duration_ms: Date.now() - t,
      };
      steps.push(result);
      // A missing function means the migration has not been applied yet. Note
      // it and carry on rather than failing the whole run.
      if (error) errors.push(`${job.label}: ${error.message}`);
      console.log(
        `[nightly-sync] ${job.name} done in ${result.duration_ms}ms — ${result.status}` +
          (typeof data === "number" ? ` (${data} affected)` : "")
      );
    }
  }

  const totalDuration = Date.now() - overallStart;

  // ── Log overall run ──────────────────────────────────────────────────────
  await supabase.from("sync_logs").insert({
    provider: "nightly_sync",
    restaurant_id: null,
    status: errors.length > 0 ? "error" : "success",
    records_synced: steps.filter((s) => s.status === "success").length,
    error_message: errors.length > 0 ? errors.join(" | ") : null,
    started_at: new Date(Date.now() - totalDuration).toISOString(),
    completed_at: new Date().toISOString(),
  });

  // ── Email superadmins on errors ──────────────────────────────────────────
  if (errors.length > 0) {
    const { data: admins } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "superadmin");

    if (admins && admins.length > 0) {
      const emails = admins.map((a: { email: string }) => a.email);
      const body = [
        "Nightly sync completed with errors:",
        "",
        ...errors.map((e) => `• ${e}`),
        "",
        "Step details:",
        ...steps.map(
          (s) =>
            `  ${s.step}: ${s.status}${s.error ? ` — ${s.error}` : ""} (${s.duration_ms}ms)`
        ),
      ].join("\n");

      console.log(`[nightly-sync] Would email ${emails.join(", ")}:\n${body}`);
      // Integrate Resend / SendGrid here if needed for sync errors
    }
  }

  return new Response(
    JSON.stringify({
      status: errors.length > 0 ? "completed_with_errors" : "success",
      steps,
      errors,
      duration_ms: totalDuration,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
  );
});
