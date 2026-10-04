// coop-agent — the gateway every Coop Agent desktop app talks to.
// ─────────────────────────────────────────────────────────────────────────────
// The venue computers never hold the service-role key. They hold a device
// token (from agent_pair(), migration 088) and send it as `x-agent-token`.
// This function resolves the token to ONE restaurant and then:
//
//   /coop-agent/rest/v1/<table>?…   PostgREST passthrough, so the existing
//                                   scrapers keep using supabase-js unchanged
//                                   (they're just pointed at this URL). Only an
//                                   allow-list of sync tables + methods, and
//                                   every read/write is pinned to the agent's
//                                   own restaurant.
//   /coop-agent/agent/<action>      hello · heartbeat · claim · finish-refresh ·
//                                   finish-roster · run-start · run-end
//
// Deploy:  supabase functions deploy coop-agent
// (verify_jwt stays ON — the app sends the public anon key as its bearer.)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, accept, range, x-agent-token, accept-profile, content-profile",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "content-range, x-coop-dropped",
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", ...extra },
  });

// ── Allow-list ───────────────────────────────────────────────────────────────
// scope: which column pins a row to a venue. 'venue' = channel_payouts' text
// venue name (venue_sync_settings.payout_venue, else the restaurant name). nullable: rows may carry
// null in the scope column (sync_logs without a venue).
type Rule = { methods: string[]; scope: "restaurant_id" | "venue"; nullable?: boolean };
const TABLES: Record<string, Rule> = {
  sales_daily:             { methods: ["GET", "POST", "PATCH"],           scope: "restaurant_id" },
  labour_daily:            { methods: ["GET", "POST", "PATCH"],           scope: "restaurant_id" },
  sales_mix_daily:         { methods: ["GET", "POST", "PATCH", "DELETE"], scope: "restaurant_id" },
  google_reviews:          { methods: ["GET", "POST", "PATCH"],           scope: "restaurant_id" },
  google_rating_daily:     { methods: ["GET", "POST", "PATCH"],           scope: "restaurant_id" },
  sales_transactions:      { methods: ["GET", "POST", "PATCH"],           scope: "restaurant_id" },
  delivery_orders:         { methods: ["GET", "POST", "PATCH"],           scope: "restaurant_id" },
  channel_payouts:         { methods: ["GET", "POST", "PATCH"],           scope: "venue" },
  sync_logs:               { methods: ["POST"],                           scope: "restaurant_id", nullable: true },
  roster_refresh_requests: { methods: ["GET", "PATCH"],                   scope: "restaurant_id" },
  print_jobs:              { methods: ["GET", "PATCH"],                   scope: "restaurant_id" },
  printers:                { methods: ["GET", "PATCH"],                   scope: "restaurant_id" },
};

type Device = {
  id: string;
  restaurant_id: string;
  name: string;
  active: boolean;
  schedule_overrides: Record<string, string | null> | null;
};

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolveDevice(req: Request): Promise<Device | null> {
  const token = req.headers.get("x-agent-token") ?? "";
  if (token.length < 32) return null;
  const { data } = await db
    .from("agent_devices")
    .select("id, restaurant_id, name, active, schedule_overrides")
    .eq("token_hash", await sha256Hex(token))
    .eq("active", true)
    .maybeSingle();
  return (data as Device) ?? null;
}

async function agentConfig() {
  const { data } = await db.from("app_settings").select("value").eq("key", "agent").maybeSingle();
  return ((data as { value?: Record<string, unknown> } | null)?.value ?? {}) as {
    sources?: Record<string, { label?: string; schedule?: string | null; env?: Record<string, string> }>;
    refresh_all?: string[];
    payout_venues?: Record<string, string>;
    portals?: unknown[];
  };
}

// Keep only the comma-separated *_MAP entries that mention this restaurant.
function filterMap(value: string, rid: string) {
  return value.split(",").map((s) => s.trim()).filter((s) => s.includes(rid)).join(",");
}

// ── PostgREST passthrough ────────────────────────────────────────────────────
async function proxy(req: Request, dev: Device, table: string, search: string) {
  const rule = TABLES[table];
  const method = req.method.toUpperCase();
  if (!rule || !rule.methods.includes(method)) {
    return json({ message: `Agents may not ${method} ${table}` }, 403);
  }

  let scopeValue = dev.restaurant_id;
  if (rule.scope === "venue") {
    const v = await payoutVenueFor(dev.restaurant_id);
    if (!v) return json({ message: "No payout venue name for this restaurant" }, 403);
    scopeValue = v;
  }

  const params = new URLSearchParams(search);
  let body: string | undefined;
  let dropped = 0;

  if (method === "GET" || method === "PATCH" || method === "DELETE") {
    // Pin the filter. PostgREST ANDs repeated filters, so a scraper asking for
    // another venue simply gets nothing back.
    params.append(rule.scope, `eq.${scopeValue}`);
  }

  if (method === "PATCH") {
    const raw = await req.text();
    const patch = raw ? JSON.parse(raw) : {};
    if (rule.scope in patch && patch[rule.scope] !== scopeValue) {
      return json({ message: `Agents may not move rows to another venue` }, 403);
    }
    body = raw;
  }

  if (method === "POST") {
    const raw = await req.text();
    const parsed = raw ? JSON.parse(raw) : [];
    const rows: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : [parsed];
    const kept = rows.filter((r) =>
      r?.[rule.scope] === scopeValue || (rule.nullable && (r?.[rule.scope] ?? null) === null)
    );
    dropped = rows.length - kept.length;
    if (!kept.length) {
      // Nothing for this venue — succeed quietly so the scraper carries on.
      return json([], 201, { "x-coop-dropped": String(dropped) });
    }
    body = JSON.stringify(Array.isArray(parsed) ? kept : kept[0]);
  }

  const headers = new Headers();
  headers.set("apikey", SB_KEY);
  headers.set("Authorization", `Bearer ${SB_KEY}`);
  for (const h of ["content-type", "prefer", "accept", "range", "range-unit", "accept-profile", "content-profile"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const qs = params.toString();
  const upstream = await fetch(`${SB_URL}/rest/v1/${table}${qs ? "?" + qs : ""}`, {
    method,
    headers,
    body,
  });

  const out = new Headers(cors);
  for (const h of ["content-type", "content-range", "preference-applied"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (dropped) out.set("x-coop-dropped", String(dropped));
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// ── Refresh roll-up ──────────────────────────────────────────────────────────
// A request for one venue finishes when that venue's agent finishes. A request
// for all venues (restaurant_id null) finishes when every agent seen in the
// last 10 minutes has reported back.
async function rollUp(requestId: string) {
  const { data: rq } = await db.from("refresh_requests")
    .select("id, restaurant_id, status").eq("id", requestId).maybeSingle();
  if (!rq) return;
  const { data: runs } = await db.from("refresh_request_runs")
    .select("device_id, status, error_message, agent_devices(name)")
    .eq("request_id", requestId);
  const list = (runs ?? []) as unknown as { device_id: string; status: string; error_message: string | null; agent_devices: { name: string } | null }[];

  let expected: string[];
  if (rq.restaurant_id) {
    expected = list.map((r) => r.device_id);
  } else {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: live } = await db.from("agent_devices")
      .select("id").eq("active", true).not("token_hash", "is", null).gte("last_seen_at", since);
    expected = [...new Set([...(live ?? []).map((d: { id: string }) => d.id), ...list.map((r) => r.device_id)])];
  }

  const finished = list.filter((r) => r.status !== "running");
  if (finished.length < expected.length || expected.length === 0) return;

  const errors = list.filter((r) => r.status === "error");
  await db.from("refresh_requests").update({
    status: errors.length ? "error" : "done",
    error_message: errors.length
      ? errors.map((e) => `${e.agent_devices?.name ?? "Agent"}: ${e.error_message ?? "failed"}`).join(" · ").slice(0, 2000)
      : null,
    completed_at: new Date().toISOString(),
  }).eq("id", requestId);
}

// ── Per-venue sync settings (migration 090) ─────────────────────────────────
type VenueSync = {
  lightspeed?: { venue_name?: string };
  kounta?: { site_name?: string };
  deputy?: { url?: string; location_name?: string };
  uber?: { store_uuid?: string; store_name?: string };
  bite?: { url?: string; site_id?: string | number; connect_id?: string | number };
  doordash?: { enabled?: boolean };
  google?: { share_url?: string };
  payout_venue?: string;
};

async function venueSync(rid: string): Promise<VenueSync | null> {
  const { data } = await db.from("venue_sync_settings").select("config").eq("restaurant_id", rid).maybeSingle();
  return ((data as { config?: VenueSync } | null)?.config ?? null);
}

// Map entries are "name:uuid" lists, so names can't carry the separators.
const clean = (v: unknown) => String(v ?? "").replace(/[,:|]/g, " ").trim();
const trimUrl = (v: unknown) => {
  const u = String(v ?? "").trim().replace(/\/+$/, "");
  // Origin only: people paste "https://brand.bitebusiness.com/admin/…" etc.
  try { return /^https:\/\//i.test(u) ? new URL(u).origin : ""; } catch { return ""; }
};

/** channel_payouts.venue for a restaurant: venue setting → legacy global map → restaurant name. */
async function payoutVenueFor(rid: string): Promise<string | null> {
  const vs = await venueSync(rid);
  if (vs?.payout_venue) return vs.payout_venue;
  const cfg = await agentConfig();
  if (cfg.payout_venues?.[rid]) return cfg.payout_venues[rid];
  const { data } = await db.from("restaurants").select("name").eq("id", rid).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

/**
 * Which syncs this venue uses, and the env each needs. A source is only switched
 * on when its section of the venue's settings is filled in.
 */
function venueEnv(vs: VenueSync, rid: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const ls = clean(vs.lightspeed?.venue_name);
  if (ls) out["lightspeed"] = out["sales-mix"] = { VENUE_MAP: `${ls}:${rid}` };
  const site = clean(vs.kounta?.site_name);
  if (site) out["salesfeed"] = { VENUE_MAP: `${site}:${rid}` };
  const depUrl = trimUrl(vs.deputy?.url), depLoc = clean(vs.deputy?.location_name);
  if (depUrl && depLoc) out["deputy"] = out["deputy-roster"] = { VENUE_MAP: `${depLoc}:${rid}`, DEPUTY_URL: depUrl };
  const uUuid = String(vs.uber?.store_uuid ?? "").trim(), uName = clean(vs.uber?.store_name);
  if (uUuid && uName) {
    out["delivery"] = { STORE_MAP: `venue:${uUuid}:${rid}:${uName}` };
    out["uber"] = { COOP_UBER_STORE_UUID: uUuid, COOP_UBER_STORE_NAME: uName };
  }
  const biteUrl = trimUrl(vs.bite?.url), biteSite = String(vs.bite?.site_id ?? "").trim();
  if (biteUrl && biteSite) out["bite"] = { COOP_BITE_URL: biteUrl, COOP_BITE_SITE_ID: biteSite };
  const pay: Record<string, string> = {};
  if (uUuid && uName) pay.COOP_UBER_STORE_UUID = uUuid;
  if (biteUrl && biteSite && vs.bite?.connect_id) {
    pay.COOP_BITE_URL = biteUrl; pay.COOP_BITE_SITE_ID = biteSite; pay.COOP_BITE_CONNECT_ID = String(vs.bite.connect_id).trim();
  }
  if (vs.doordash?.enabled) pay.COOP_DOORDASH = "1";
  if (Object.keys(pay).length) out["payouts"] = pay;
  const share = String(vs.google?.share_url ?? "").trim();
  if (share) out["google"] = { STORE_MAP: `${share}|${rid}` };
  return out;
}

/** Sign-in tabs for this venue's Coop Browser, from the systems it uses. */
function venuePortals(vs: VenueSync, globalPortals: { key: string; name: string; url: string; match: string }[]) {
  const tpl = (key: string, fallback: { name: string; url: string; match: string }) =>
    ({ key, ...fallback, ...(globalPortals.find((p) => p.key === key) ?? {}) });
  const out = [];
  if (clean(vs.lightspeed?.venue_name)) out.push(tpl("lightspeed", { name: "Lightspeed Insights", url: "https://insights.kounta.com/insights?url=/embed/dashboards-next/1216", match: "insights.kounta.com/insights" }));
  if (clean(vs.kounta?.site_name)) out.push(tpl("kounta", { name: "Lightspeed Back Office (Sales Feed)", url: "https://my.kounta.com/sale", match: "my.kounta.com/sale" }));
  const depUrl = trimUrl(vs.deputy?.url);
  if (depUrl) out.push({ key: "deputy", name: "Deputy", url: `${depUrl}/#/roster/insights`, match: `${new URL(depUrl).host}/#` });
  if (vs.uber?.store_uuid) out.push(tpl("uber", { name: "Uber Eats Manager", url: "https://merchants.ubereats.com/manager/home", match: "merchants.ubereats.com/manager" }));
  const biteUrl = trimUrl(vs.bite?.url);
  if (biteUrl) out.push({ key: "bite", name: "Bite Business", url: `${biteUrl}/admin`, match: `${new URL(biteUrl).host}/admin` });
  if (vs.doordash?.enabled) out.push(tpl("doordash", { name: "DoorDash Merchant", url: "https://merchant.doordash.com", match: "merchant.doordash.com/merchant" }));
  return out;
}

// ── Config for one agent ─────────────────────────────────────────────────────
// Default labels/schedules from app_settings 'agent'; what runs and with which
// details from the venue's own settings (090) — or, for a venue not set up yet,
// the legacy global *_MAP env filtered to it; then this computer's schedule
// overrides (089) on top.
async function buildConfig(dev: Device, now: string) {
  const { data: r } = await db.from("restaurants").select("name").eq("id", dev.restaurant_id).maybeSingle();
  const cfg = await agentConfig();
  const vs = await venueSync(dev.restaurant_id);
  const perVenue = vs ? venueEnv(vs, dev.restaurant_id) : null;
  const payoutVenue = await payoutVenueFor(dev.restaurant_id);
  const overrides = dev.schedule_overrides ?? {};
  const sources: Record<string, unknown> = {};
  for (const [key, src] of Object.entries(cfg.sources ?? {})) {
    if (perVenue && !perVenue[key]) continue; // venue doesn't use this system
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(src.env ?? {})) {
      if (perVenue && k.endsWith("_MAP")) continue; // venue settings supply the maps
      env[k] = k.endsWith("_MAP") ? filterMap(String(v), dev.restaurant_id) : String(v);
    }
    if (perVenue) Object.assign(env, perVenue[key]);
    env.COOP_RESTAURANT_ID = dev.restaurant_id;
    if (payoutVenue) env.COOP_PAYOUT_VENUE = payoutVenue;
    const overridden = Object.prototype.hasOwnProperty.call(overrides, key);
    const defaultSchedule = src.schedule ?? null;
    sources[key] = {
      label: src.label ?? key,
      schedule: overridden ? overrides[key] : defaultSchedule,
      default_schedule: defaultSchedule,
      overridden,
      env,
    };
  }
  const globalPortals = (cfg.portals ?? []) as { key: string; name: string; url: string; match: string }[];
  return {
    device_id: dev.id,
    device_name: dev.name,
    restaurant_id: dev.restaurant_id,
    restaurant_name: (r as { name?: string } | null)?.name ?? null,
    configured: !!vs,
    sources,
    refresh_all: (cfg.refresh_all ?? []).filter((k) => k in sources),
    portals: vs ? venuePortals(vs, globalPortals) : globalPortals,
    server_time: now,
  };
}

// "daily HH:MM" or "hourly :MM [HH-HH]", with real hour/minute ranges.
function validSchedule(s: string) {
  let m = s.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
  if (m) return Number(m[1]) <= 23 && Number(m[2]) <= 59;
  m = s.match(/^hourly\s+:(\d{2})(?:\s+(\d{1,2})-(\d{1,2}))?$/i);
  if (m) {
    const from = m[2] ? Number(m[2]) : 0, to = m[3] ? Number(m[3]) : 23;
    return Number(m[1]) <= 59 && from <= 23 && to <= 23 && from <= to;
  }
  return false;
}

// ── Agent actions ────────────────────────────────────────────────────────────
async function action(req: Request, dev: Device, name: string) {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const now = new Date().toISOString();

  switch (name) {
    case "hello": {
      await db.from("agent_devices").update({
        last_seen_at: now,
        app_version: String(body.version ?? "").slice(0, 40) || null,
        platform: String(body.platform ?? "").slice(0, 20) || null,
      }).eq("id", dev.id);
      return json(await buildConfig(dev, now));
    }

    // Change (or reset) this computer's schedule for one source. Only ever
    // touches this device's own row — the defaults in app_settings stay put.
    case "set-schedule": {
      const source = String(body.source ?? "");
      const cfg = await agentConfig();
      if (!cfg.sources?.[source]) return json({ message: `Unknown sync "${source}"` }, 400);

      const overrides = { ...(dev.schedule_overrides ?? {}) };
      if (body.reset) {
        delete overrides[source];
      } else {
        const sched = body.schedule == null || String(body.schedule).trim() === "" ? null : String(body.schedule).trim();
        if (sched !== null && !validSchedule(sched)) {
          return json({ message: `"${sched}" isn't a valid schedule. Use "daily 04:00" or "hourly :05 09-23".` }, 400);
        }
        // Setting it back to exactly the default is the same as resetting.
        if (sched === (cfg.sources[source].schedule ?? null)) delete overrides[source];
        else overrides[source] = sched;
      }
      const { error } = await db.from("agent_devices").update({ schedule_overrides: overrides }).eq("id", dev.id);
      if (error) return json({ message: error.message }, 500);
      return json(await buildConfig({ ...dev, schedule_overrides: overrides }, now));
    }

    case "heartbeat": {
      await db.from("agent_devices").update({
        last_seen_at: now,
        status: typeof body.status === "object" && body.status ? body.status : {},
      }).eq("id", dev.id);
      return json({ ok: true });
    }

    case "claim": {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: open } = await db.from("refresh_requests")
        .select("id, source, restaurant_id, status")
        .in("status", ["pending", "running"])
        .gte("requested_at", since)
        .or(`restaurant_id.is.null,restaurant_id.eq.${dev.restaurant_id}`)
        .order("requested_at", { ascending: true })
        .limit(10);

      const refresh: { id: string; source: string }[] = [];
      for (const rq of (open ?? []) as { id: string; source: string; status: string }[]) {
        // The insert is the claim: the primary key stops a second claim by the
        // same device; other devices get their own row.
        const { error } = await db.from("refresh_request_runs")
          .insert({ request_id: rq.id, device_id: dev.id, status: "running" });
        if (error) continue; // already claimed by this device
        if (rq.status === "pending") {
          await db.from("refresh_requests").update({ status: "running", started_at: now })
            .eq("id", rq.id).eq("status", "pending");
        }
        refresh.push({ id: rq.id, source: rq.source });
      }

      const { data: rosterOpen } = await db.from("roster_refresh_requests")
        .update({ status: "running" })
        .eq("restaurant_id", dev.restaurant_id)
        .eq("status", "pending")
        .select("id, week_start");

      await db.from("agent_devices").update({ last_seen_at: now }).eq("id", dev.id);
      return json({ refresh, roster: rosterOpen ?? [] });
    }

    case "finish-refresh": {
      const id = String(body.request_id ?? "");
      await db.from("refresh_request_runs").update({
        status: body.ok ? "done" : "error",
        error_message: body.ok ? null : String(body.error ?? "failed").slice(0, 1000),
        completed_at: now,
      }).eq("request_id", id).eq("device_id", dev.id);
      await rollUp(id);
      return json({ ok: true });
    }

    case "finish-roster": {
      await db.from("roster_refresh_requests").update({
        status: body.ok ? "done" : "error",
        error_message: body.ok ? null : String(body.error ?? "failed").slice(0, 1000),
        completed_at: now,
      }).eq("id", String(body.id ?? "")).eq("restaurant_id", dev.restaurant_id);
      return json({ ok: true });
    }

    case "run-start": {
      const trigger = ["schedule", "refresh", "manual", "roster"].includes(body.trigger) ? body.trigger : "manual";
      const { data, error } = await db.from("agent_runs").insert({
        device_id: dev.id,
        restaurant_id: dev.restaurant_id,
        source: String(body.source ?? "unknown").slice(0, 40),
        trigger,
      }).select("id").single();
      if (error) return json({ message: error.message }, 500);
      return json(data);
    }

    case "run-end": {
      await db.from("agent_runs").update({
        status: body.ok ? "done" : "error",
        exit_code: Number.isFinite(body.exit_code) ? body.exit_code : null,
        log_tail: String(body.log_tail ?? "").slice(-4000),
        finished_at: now,
      }).eq("id", String(body.id ?? "")).eq("device_id", dev.id);
      return json({ ok: true });
    }

    default:
      return json({ message: `Unknown action ${name}` }, 404);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    // Path arrives as /coop-agent/... (or /functions/v1/coop-agent/... locally).
    const path = url.pathname.replace(/^.*?\/coop-agent/, "");

    const dev = await resolveDevice(req);
    if (!dev) return json({ message: "This computer is not paired (or was revoked). Re-pair it in the Coop Agent app." }, 401);

    const rest = path.match(/^\/rest\/v1\/([a-z_]+)\/?$/);
    if (rest) return await proxy(req, dev, rest[1], url.search);

    const act = path.match(/^\/agent\/([a-z-]+)\/?$/);
    if (act) return await action(req, dev, act[1]);

    return json({ message: "Not found" }, 404);
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
