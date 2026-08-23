// issue-contract
// ---------------------------------------------------------------------------
// Renders and issues an employment contract, server-side, with the service-role
// key. Runs in two situations:
//
//   • the employee finishes their details in the onboarding wizard, and
//   • the admin saves the employment terms for someone already finished.
//
// Whoever calls it, the BODY is rendered here from the stored template — never
// supplied by the caller — so an employee cannot issue themselves a contract of
// their own wording. The employer signature is the person who started the
// onboarding (employee_onboarding.requested_by), falling back to the company
// signatory in app_settings['company'].
//
// Body: { employee_id: string, kind?: "contract" | "variation", template_id?: string, force?: boolean }
// Auth: the employee themselves, or any superadmin.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SIG_MARKER = "<!--SIGBLOCK-->";

// ── Award maths (mirrors src/lib/award.ts) ─────────────────────────────────
const DEFAULT_AWARD = {
  code: "MA000003",
  junior_pct: { "15": 40, "16": 50, "17": 60, "18": 70, "19": 80, "20": 90, "21": 100 } as Record<string, number>,
  levels: { "1": 27.81, "2": 29.45, "3": 29.91, "3+": 30.27 } as Record<string, number>,
};

const LEVEL_LABELS: Record<string, string> = {
  "1": "Level 1", "2": "Level 2", "3": "Level 3", "3+": "Level 3 (2+ staff)",
};

function yearsBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  let age = to.getFullYear() - from.getFullYear();
  const m = to.getMonth() - from.getMonth();
  if (m < 0 || (m === 0 && to.getDate() < from.getDate())) age--;
  return age;
}

function juniorPercent(dob: string | null, onDate: string, cfg = DEFAULT_AWARD): number | null {
  if (!dob) return null;
  const age = yearsBetween(dob, onDate);
  if (age <= 15) return cfg.junior_pct["15"] ?? 40;
  if (age >= 21) return 100;
  return cfg.junior_pct[String(age)] ?? 100;
}

function fmtDate(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function money(n?: number | null): string {
  if (n == null) return "";
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  casual: "Casual", part_time: "Part-time", full_time: "Full-time",
};

// deno-lint-ignore no-explicit-any
function buildTokens(p: any, r: any, c: any, award = DEFAULT_AWARD): Record<string, string> {
  const onDate = p.start_date || new Date().toISOString().slice(0, 10);
  const legalName = [p.legal_first_name, p.legal_middle_name, p.legal_last_name].filter(Boolean).join(" ");
  const address = [
    [p.address_line2, p.address_line1].filter(Boolean).join(", "),
    p.suburb,
    [p.address_state, p.postcode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");

  const adult = p.award_level ? award.levels[p.award_level] ?? null : null;
  const jp = p.date_of_birth ? juniorPercent(p.date_of_birth, onDate, award) : null;
  const derived = adult == null ? null : Math.round(adult * ((jp ?? 100) / 100) * 100) / 100;
  const rate = p.base_pay_rate != null ? Number(p.base_pay_rate) : derived;

  return {
    "employee.full_name": p.full_name ?? "",
    "employee.legal_name": legalName || p.full_name || "",
    "employee.first_name": p.legal_first_name ?? (p.full_name ?? "").split(" ")[0] ?? "",
    "employee.last_name": p.legal_last_name ?? (p.full_name ?? "").split(" ").slice(1).join(" "),
    "employee.preferred_name": p.preferred_name || p.full_name || "",
    "employee.dob": fmtDate(p.date_of_birth),
    "employee.age": p.date_of_birth ? String(yearsBetween(p.date_of_birth, onDate)) : "",
    "employee.address": address,
    "employee.email": p.contact_email ?? "",
    "employee.phone": p.phone ?? "",

    "employment.position": p.position_title ?? "",
    "employment.type": EMPLOYMENT_LABELS[p.employment_type ?? ""] ?? "",
    "employment.start_date": fmtDate(p.start_date),
    "employment.probation": p.probation_weeks ? `${p.probation_weeks} weeks` : "",
    "employment.hours": p.contracted_hours != null ? String(p.contracted_hours) : "",
    "employment.pay_type": p.pay_type === "salary" ? "Salary" : "Hourly",
    "employment.pay_rate": money(rate),
    "employment.salary": p.salary_annual != null ? money(Number(p.salary_annual)) : "",
    "employment.pay_frequency": "Weekly",

    "award.name": "Fast Food Industry Award 2010",
    "award.code": award.code,
    "award.level": p.award_level ? LEVEL_LABELS[p.award_level] ?? `Level ${p.award_level}` : "",
    "award.classification": p.award_level
      ? `Fast Food Employee ${LEVEL_LABELS[p.award_level] ?? p.award_level}` : "",
    "award.junior_percent": jp != null ? `${jp}%` : "100%",

    "restaurant.name": r?.name ?? "",
    "restaurant.address": r?.address ?? "",
    "restaurant.state": r?.state ?? "",

    "company.legal_name": c.legal_name ?? "",
    "company.trading_name": c.trading_name ?? "",
    "company.abn": c.abn ?? "",
    "company.address": c.address ?? "",
    "company.signatory_name": c.signatory_name ?? "",
    "company.signatory_title": c.signatory_title ?? "",

    today: fmtDate(new Date().toISOString().slice(0, 10)),
  };
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function render(body: string, values: Record<string, string>) {
  const missing: string[] = [];
  const html = body.replace(TOKEN_RE, (_m, raw: string) => {
    const token = raw.trim();
    if (token === "signature.block") return SIG_MARKER;
    const v = values[token];
    if (v == null || v === "") {
      if (token in values) missing.push(token);
      return `{{${token}}}`;
    }
    return escapeHtml(v);
  });
  return { html: html.includes(SIG_MARKER) ? html : html + SIG_MARKER, missing };
}

// deno-lint-ignore no-explicit-any
function pickTemplate(templates: any[], employmentType: string | null, restaurantId: string | null, kind: string) {
  const candidates = templates.filter((t) => t.active && t.kind === kind);
  let best = null, bestScore = -1;
  for (const t of candidates) {
    if (t.employment_type && t.employment_type !== employmentType) continue;
    if (t.restaurant_id && t.restaurant_id !== restaurantId) continue;
    const score = (t.employment_type ? 2 : 0) + (t.restaurant_id ? 1 : 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Not authenticated" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);
  const callerId = userData.user.id;

  const { data: caller } = await admin.from("profiles").select("role").eq("id", callerId).single();
  const isSuperadmin = caller?.role === "superadmin";

  let body: { employee_id?: string; kind?: string; template_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }

  const employeeId = body.employee_id ?? callerId;
  if (employeeId !== callerId && !isSuperadmin) {
    return json({ error: "Not allowed" }, 403);
  }
  const kind = body.kind === "variation" ? "variation" : "contract";

  // ── Gate: only issue when both halves are actually ready ─────────────────
  const { data: onboarding } = await admin
    .from("employee_onboarding").select("*").eq("employee_id", employeeId).maybeSingle();

  if (!body.force) {
    if (!onboarding) return json({ issued: false, reason: "no_onboarding_record" });
    const { data: ready, error: readyErr } = await admin.rpc("contract_ready_to_issue", {
      target: employeeId,
    });
    // A missing RPC means migration 065 has not been applied — say so plainly
    // rather than reporting "not ready" and sending everyone hunting.
    if (readyErr) {
      return json({ issued: false, reason: "setup_incomplete", detail: readyErr.message });
    }
    if (!ready) {
      const { data: blockers } = await admin.rpc("contract_issue_blockers", {
        target: employeeId,
      });
      return json({ issued: false, reason: "not_ready", blockers: blockers ?? [] });
    }
  }

  // ── Load everything the render needs ─────────────────────────────────────
  const { data: profile } = await admin.from("profiles").select("*").eq("id", employeeId).single();
  if (!profile) return json({ error: "Employee not found" }, 404);

  const { data: templates } = await admin.from("contract_templates").select("*");
  const template = body.template_id
    ? (templates ?? []).find((t) => t.id === body.template_id)
    : pickTemplate(templates ?? [], profile.employment_type, profile.home_restaurant_id, kind);
  if (!template) return json({ issued: false, reason: "no_template" });

  const { data: restaurant } = profile.home_restaurant_id
    ? await admin.from("restaurants").select("name, address, state").eq("id", profile.home_restaurant_id).single()
    : { data: null };

  const { data: companyRow } = await admin
    .from("app_settings").select("value").eq("key", "company").maybeSingle();
  const company = (companyRow?.value ?? {}) as Record<string, string>;

  const { data: awardRow } = await admin
    .from("app_settings").select("value").eq("key", "award").maybeSingle();
  const award = awardRow?.value
    ? { ...DEFAULT_AWARD, ...(awardRow.value as Record<string, unknown>) }
    : DEFAULT_AWARD;

  // ── Who authorises: whoever started the onboarding ───────────────────────
  const authoriserId = onboarding?.requested_by ?? (isSuperadmin ? callerId : null);
  const { data: authoriser } = authoriserId
    ? await admin.from("profiles")
        .select("id, full_name, signatory_title, signature_image").eq("id", authoriserId).single()
    : { data: null };

  const signatoryName = authoriser?.full_name || company.signatory_name || "";
  const signatoryTitle = authoriser?.signatory_title || company.signatory_title || "";
  const signatoryImage = authoriser?.signature_image || company.signature_image || null;

  const tokens = buildTokens(profile, restaurant, {
    ...company,
    signatory_name: signatoryName,
    signatory_title: signatoryTitle,
  }, award as typeof DEFAULT_AWARD);

  const { html, missing } = render(template.body_html, tokens);
  if (missing.length && !body.force) {
    return json({ issued: false, reason: "missing_fields", missing });
  }

  const { data: contract, error: insErr } = await admin
    .from("employee_contracts")
    .insert({
      employee_id: employeeId,
      template_id: template.id,
      template_version: template.version,
      template_name: template.name,
      kind,
      status: "issued",
      body_html: html,
      tokens,
      issued_by: callerId,
      authorised_by: authoriser?.id ?? null,
      auto_issued: !body.force,
      issued_at: new Date().toISOString(),
      employer_signatory_name: signatoryName,
      employer_signatory_title: signatoryTitle,
      employer_signature_image: signatoryImage,
      employer_signed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (insErr) return json({ error: insErr.message }, 400);

  await admin.from("notifications").insert([
    {
      user_id: employeeId,
      type: "contract_issued",
      title: "Your employment contract is ready",
      body: "Please read and sign your contract to finish onboarding.",
      data: { path: "/onboarding" },
    },
    ...(authoriser?.id && authoriser.id !== employeeId
      ? [{
          user_id: authoriser.id,
          type: "contract_issued",
          title: "Contract sent",
          body: `${profile.full_name}'s contract was issued for signature in your name.`,
          data: { path: "/admin/team" },
        }]
      : []),
  ]);

  return json({ issued: true, contract_id: contract.id, signatory: signatoryName });
});
