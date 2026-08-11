// Shared client for the local on-demand refresh trigger server.
// The server runs on the user's Mac (refresh-server/server.mjs) and drives the
// open Coop Chrome tabs. See REFRESH_ON_DEMAND.md.

export const REFRESH_URL =
  (import.meta.env.VITE_REFRESH_URL as string) || "http://127.0.0.1:8787";
export const REFRESH_TOKEN =
  (import.meta.env.VITE_REFRESH_TOKEN as string) || "";

export type RefreshSource = { key: string; label: string };
export type RefreshHealth = {
  ok: boolean;
  chrome: boolean;
  sources: RefreshSource[];
};
export type RefreshResult = {
  ok: boolean;
  error?: string;
  results?: { source: string; label: string; ok: boolean }[];
};

/** GET /health — returns null if the local server isn't reachable. */
export async function checkRefreshHealth(): Promise<RefreshHealth | null> {
  try {
    const r = await fetch(`${REFRESH_URL}/health`, { method: "GET" });
    return (await r.json()) as RefreshHealth;
  } catch {
    return null;
  }
}

/** POST /refresh — run a single source, or "all". */
export async function triggerRefresh(source: string): Promise<RefreshResult> {
  try {
    const r = await fetch(`${REFRESH_URL}/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-refresh-token": REFRESH_TOKEN,
      },
      body: JSON.stringify({ source }),
    });
    const j = (await r.json()) as RefreshResult;
    return j;
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

/** Human-readable failure message from a RefreshResult. */
export function refreshErrorMessage(res: RefreshResult): string {
  if (res.error === "unreachable")
    return "Can't reach the local refresh server. Is it running on your Mac?";
  if (res.error) return res.error;
  const failed = (res.results || []).filter((x) => !x.ok).map((x) => x.label);
  return failed.length ? `Failed: ${failed.join(", ")}` : "Refresh failed";
}
