// Client for the on-demand data refresh.
//
// The web app can't reach the user's Mac directly (browsers block an https page
// calling http://localhost — mixed content / CORS / Private Network Access), so
// instead we INSERT a row into Supabase `refresh_requests`. A local watcher
// (refresh-watcher/watch.mjs) polls that table, runs the matching scraper against
// the open Coop Chrome, and marks the row done/error. We then poll the row for
// its outcome. This works in Safari, on iPad, anywhere. See REFRESH_ON_DEMAND.md.

import { supabase } from "@/lib/supabase";

export type RefreshStatus = "pending" | "running" | "done" | "error";

export type RefreshSource = { key: string; label: string };

export const REFRESH_SOURCES: RefreshSource[] = [
  { key: "lightspeed", label: "Lightspeed Sales" },
  { key: "sales-mix", label: "Lightspeed Sales Mix" },
  { key: "deputy", label: "Deputy Labour" },
  { key: "google", label: "Google Reviews" },
  { key: "bite", label: "Bite Online Sales" },
  { key: "uber", label: "Uber Eats Sales" },
  { key: "payouts", label: "Channel Payouts" },
];

export type RefreshResult = {
  ok: boolean;
  status?: RefreshStatus;
  error?: string;
};

// How long we wait for the watcher to finish before giving up (the scrapers can
// take a while), and how often we poll the request row.
const POLL_MS = 3000;
const TIMEOUT_MS = 8 * 60 * 1000;

/** Insert a pending refresh request and return its id. */
export async function queueRefresh(source: string): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("refresh_requests")
    .insert({
      source,
      status: "pending",
      requested_by: userData?.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Queue a refresh and wait for the local watcher to finish it.
 * `source` is a key from REFRESH_SOURCES, or "all".
 */
export async function triggerRefresh(source: string): Promise<RefreshResult> {
  let id: string;
  try {
    id = await queueRefresh(source);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const deadline = Date.now() + TIMEOUT_MS;
  let sawRunning = false;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const { data, error } = await supabase
      .from("refresh_requests")
      .select("status,error_message")
      .eq("id", id)
      .maybeSingle();
    if (error) continue;
    const row = data as { status: RefreshStatus; error_message: string | null } | null;
    if (!row) continue;
    if (row.status === "running") sawRunning = true;
    if (row.status === "done") return { ok: true, status: "done" };
    if (row.status === "error")
      return { ok: false, status: "error", error: row.error_message || "Refresh failed" };
  }

  // Never left 'pending' → the watcher almost certainly isn't running.
  return { ok: false, error: sawRunning ? "timeout" : "no-watcher" };
}

/** Human-readable failure message from a RefreshResult. */
export function refreshErrorMessage(res: RefreshResult): string {
  if (res.error === "no-watcher")
    return "No response from your Mac. Start the Refresh Watcher (Start Refresh Watcher.command) and try again.";
  if (res.error === "timeout")
    return "Refresh is taking too long — check the Refresh Watcher window on your Mac for errors.";
  return res.error || "Refresh failed";
}
