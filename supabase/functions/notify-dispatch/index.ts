// notify-dispatch
// Fans a newly-created in-app notification out to EMAIL (Resend) and WEB PUSH.
//
// Invoke via a Supabase Database Webhook on public.notifications INSERT:
//   Database → Webhooks → "notifications insert" → HTTP POST to this function.
// Payload shape: { type:"INSERT", table:"notifications", record:{...row...} }.
// Can also be called directly with a bare notification row for testing.
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY        (already set for process-alerts)
//   NOTIFY_FROM_EMAIL     (optional; defaults to ALERT_FROM_EMAIL / a fallback)
//   APP_URL               (optional; used for links in the email)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@domain)
//                         — generate with:  npx web-push generate-vapid-keys
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
}

const APP_URL = Deno.env.get("APP_URL") ?? "";

function emailHtml(n: NotificationRow, name: string): string {
  const path = typeof n.data?.path === "string" ? n.data.path : "";
  const link = APP_URL ? `${APP_URL}${path}` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#f97316;border-radius:8px 8px 0 0;padding:20px 24px;">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">🐔 ${n.title}</h1>
    </div>
    <div style="background:#fff;border-radius:0 0 8px 8px;padding:24px;border:1px solid #e4e4e7;border-top:0;">
      <p style="margin:0 0 16px;color:#18181b;font-size:15px;">Hi ${name || "there"},</p>
      <p style="margin:0 0 20px;color:#18181b;font-size:15px;">${n.body ?? ""}</p>
      ${link ? `<a href="${link}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">Open The Coop &rarr;</a>` : ""}
      <hr style="margin:24px 0;border:0;border-top:1px solid #e4e4e7;">
      <p style="margin:0;color:#a1a1aa;font-size:12px;">You can turn these emails off in The Coop notification settings.</p>
    </div>
  </div>
</body></html>`;
}

async function sendEmail(to: string, n: NotificationRow, name: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from =
    Deno.env.get("NOTIFY_FROM_EMAIL") ??
    Deno.env.get("ALERT_FROM_EMAIL") ??
    "notifications@thecoopops.com.au";
  if (!key) {
    console.log(`[notify-dispatch] no RESEND_API_KEY; would email ${to}: ${n.title}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: n.title, html: emailHtml(n, name) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function configurePush(): boolean {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@thecoopops.com.au";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = await req.json();
    const rec: NotificationRow = payload.record ?? payload;
    if (!rec?.user_id) {
      return new Response(JSON.stringify({ error: "no user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, contact_email, full_name, notification_prefs")
      .eq("id", rec.user_id)
      .single();

    const prefs = (profile?.notification_prefs as { email?: boolean; push?: boolean }) ?? {
      email: true,
      push: true,
    };
    const firstName = (profile?.full_name ?? "").split(" ")[0] ?? "";
    const results: Record<string, string> = {};

    // ── Email ──────────────────────────────────────────────────────────────
    if (prefs.email !== false) {
      const to = profile?.contact_email || profile?.email || "";
      if (to && !to.endsWith("@thecoop.local")) {
        try {
          await sendEmail(to, rec, firstName);
          results.email = "sent";
        } catch (e) {
          results.email = `error: ${(e as Error).message}`;
        }
      } else {
        results.email = "skipped (no real email)";
      }
    }

    // ── Web push ───────────────────────────────────────────────────────────
    if (prefs.push !== false && configurePush()) {
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", rec.user_id);
      const path = typeof rec.data?.path === "string" ? rec.data.path : "/";
      const body = JSON.stringify({ title: rec.title, body: rec.body ?? "", path });
      let sent = 0;
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
          }
        }
      }
      results.push = `sent ${sent}`;
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
