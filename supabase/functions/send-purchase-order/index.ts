// send-purchase-order
// ---------------------------------------------------------------------------
// Emails a purchase order to its supplier from the app.
//
// Body: { po_id: string }
// Auth: any signed-in user who can see the PO. The PO is read with the
//       caller's own token, so venue-access RLS decides — nobody can send an
//       order for a venue they can't see.
//
// FROM: one sending account for the whole app, with the brand + venue as the
//       display name — e.g. "Pollo Rotisserie Torquay <coopordering@gmail.com>".
// REPLY-TO: the venue's ordering reply email (Settings → Venues), else the
//       person who sent it — so the supplier's reply lands in the venue inbox.
// CC: the venue's reply email and the sender, for their records.
//
// Sending — whichever is configured (Supabase secrets):
//   SMTP (no domain needed — e.g. a Gmail account with an app password)
//     SMTP_USER   the account, e.g. coopordering@gmail.com
//     SMTP_PASS   its app password (Google Account → Security → App passwords)
//     SMTP_HOST   optional, default smtp.gmail.com
//     SMTP_PORT   optional, default 465 (Supabase blocks 25 and 587)
//   or Resend (needs a verified domain)
//     RESEND_API_KEY + ORDERS_FROM_EMAIL
// SMTP wins if both are set.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface POItem { description: string; quantity: number; unit: string; unit_price: number }

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n: number) =>
  "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

/** Real inbox or null — username logins use a synthetic @thecoop.local address. */
function realEmail(e?: string | null): string | null {
  if (!e) return null;
  const t = e.trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) && !t.endsWith("@thecoop.local") ? t : null;
}

// Any uncaught error still answers with CORS headers and a readable message —
// otherwise the browser only sees "Failed to send a request to the Edge Function".
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await handle(req);
  } catch (e) {
    console.error("[send-purchase-order] crashed:", e);
    return json({ error: `Send failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});

async function handle(req: Request): Promise<Response> {

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "Not authenticated" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  // Caller-scoped client: RLS applies to every read and write below.
  const db = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
  });

  const { data: userData, error: userErr } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  let poId: string | undefined;
  try {
    ({ po_id: poId } = await req.json());
  } catch { /* fall through */ }
  if (!poId) return json({ error: "po_id is required" }, 400);

  const { data: po, error: poErr } = await db
    .from("purchase_orders")
    .select("*")
    .eq("id", poId)
    .single();
  if (poErr || !po) return json({ error: "Order not found" }, 404);
  if (po.status === "cancelled") return json({ error: "This order is cancelled" }, 400);

  const to = realEmail(po.supplier_email);
  if (!to) return json({ error: "Add the supplier's email before sending" }, 400);

  const items = (po.items ?? []) as POItem[];
  if (!items.length) return json({ error: "This order has no items" }, 400);

  const { data: me } = await db
    .from("profiles").select("full_name, email, contact_email").eq("id", userId).single();

  // orders_email arrives with migration 086 — fall back if it isn't there yet.
  type Venue = { name: string; address: string | null; brand_id: string | null; orders_email?: string | null };
  let venue: Venue | null = null;
  {
    const withEmail = await db.from("restaurants")
      .select("name, address, brand_id, orders_email").eq("id", po.restaurant_id).single();
    if (!withEmail.error) venue = withEmail.data as Venue;
    else {
      const plain = await db.from("restaurants")
        .select("name, address, brand_id").eq("id", po.restaurant_id).single();
      venue = (plain.data as Venue) ?? null;
    }
  }
  let brandName = "";
  if (venue?.brand_id) {
    const { data: brand } = await db.from("brands").select("name").eq("id", venue.brand_id).single();
    brandName = brand?.name ?? "";
  }
  const venueName = venue?.name ?? "";
  const businessName = [brandName, venueName].filter(Boolean).join(" ") || "The Coop";
  const senderName = me?.full_name ?? "";
  const senderEmail = realEmail(me?.contact_email) ?? realEmail(me?.email);
  const venueEmail = realEmail(venue?.orders_email);
  const replyTo = venueEmail ?? senderEmail;
  const cc = [...new Set([venueEmail, senderEmail].filter((e): e is string => !!e && e !== to))];

  // ── Email body ────────────────────────────────────────────────────────────
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #EDF0F5;">${esc(i.description)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EDF0F5;text-align:right;white-space:nowrap;"><strong>${i.quantity}</strong> ${esc(i.unit)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EDF0F5;text-align:right;color:#667085;white-space:nowrap;">${i.unit_price ? money(i.unit_price) : "—"}</td>
      </tr>`
    )
    .join("");

  const detail = (label: string, value: string) =>
    value
      ? `<tr><td style="padding:2px 16px 2px 0;color:#667085;">${label}</td><td style="padding:2px 0;color:#101828;">${value}</td></tr>`
      : "";

  const html = `<!doctype html><html><body style="margin:0;background:#F7F8FA;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101828;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border:1px solid #E4E7EC;border-radius:12px;padding:28px;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#667085;">Purchase order ${esc(po.po_number)}</p>
      <h1 style="margin:0 0 20px;font-size:22px;">${esc(businessName)}</h1>
      <p style="margin:0 0 16px;">Hi ${esc(po.supplier_name)}, please supply the following order.</p>
      <table style="font-size:14px;margin-bottom:20px;border-collapse:collapse;">
        ${detail("Deliver to", esc([businessName, venue?.address].filter(Boolean).join(", ")))}
        ${detail("Order date", fmtDate(po.order_date))}
        ${detail("Delivery", po.expected_delivery ? `<strong>${fmtDate(po.expected_delivery)}</strong>` : "Next available")}
        ${detail("Ordered by", esc(senderName))}
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#FAFBFC;">
          <th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#667085;border-bottom:1px solid #E4E7EC;">Item</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:#667085;border-bottom:1px solid #E4E7EC;">Qty</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;text-transform:uppercase;color:#667085;border-bottom:1px solid #E4E7EC;">Price</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="2" style="padding:10px;text-align:right;color:#667085;">Estimated total (ex. GST)</td>
          <td style="padding:10px;text-align:right;font-weight:700;">${money(Number(po.total_amount) || 0)}</td>
        </tr></tfoot>
      </table>
      ${po.notes ? `<p style="margin:20px 0 0;padding:12px 14px;background:#FFFAEB;border-radius:8px;font-size:14px;"><strong>Notes:</strong> ${esc(po.notes)}</p>` : ""}
      <p style="margin:24px 0 0;font-size:14px;">Please reply to confirm this order${replyTo ? "" : " by phone"} and let us know of any substitutions or shortages.</p>
      <p style="margin:16px 0 0;font-size:14px;">Thanks,<br>${esc(senderName || businessName)}<br><span style="color:#667085;">${esc(businessName)}</span></p>
    </div>
    <p style="text-align:center;margin:16px 0 0;font-size:11px;color:#98A2B3;">Sent from The Coop · Reference ${esc(po.po_number)}</p>
  </div></body></html>`;

  const text = [
    `Purchase order ${po.po_number} — ${businessName}`,
    ``,
    `Hi ${po.supplier_name}, please supply the following order.`,
    ``,
    `Deliver to: ${[businessName, venue?.address].filter(Boolean).join(", ")}`,
    `Order date: ${fmtDate(po.order_date)}`,
    `Delivery: ${po.expected_delivery ? fmtDate(po.expected_delivery) : "Next available"}`,
    senderName ? `Ordered by: ${senderName}` : null,
    ``,
    ...items.map((i) => `- ${i.quantity} ${i.unit}  ${i.description}${i.unit_price ? `  @ ${money(i.unit_price)}` : ""}`),
    ``,
    `Estimated total (ex. GST): ${money(Number(po.total_amount) || 0)}`,
    po.notes ? `\nNotes: ${po.notes}` : null,
    ``,
    `Please reply to confirm this order and let us know of any substitutions or shortages.`,
    ``,
    `Thanks,`,
    senderName || businessName,
  ].filter((l) => l !== null).join("\n");

  // ── Send ──────────────────────────────────────────────────────────────────
  const displayName = businessName.replace(/[<>"]/g, "");
  const isResend = (po.send_count ?? 0) > 0;
  const subject = `${isResend ? "UPDATED: " : ""}Order ${po.po_number} — ${businessName}${po.expected_delivery ? ` — deliver ${fmtDate(po.expected_delivery)}` : ""}`;

  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  let fromUsed: string;

  if (smtpUser && smtpPass) {
    // ── SMTP (e.g. a plain Gmail account + app password — no domain needed) ──
    fromUsed = smtpUser;
    try {
      const transport = nodemailer.createTransport({
        host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
        port: Number(Deno.env.get("SMTP_PORT") ?? 465),
        secure: true, // 465 = TLS. Supabase blocks outbound 25 and 587.
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transport.sendMail({
        from: { name: displayName, address: smtpUser },
        to,
        ...(replyTo ? { replyTo } : {}),
        ...(cc.length ? { cc } : {}),
        subject,
        html,
        text,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[send-purchase-order] SMTP: ${msg}`);
      if (/Invalid login|Username and Password not accepted|535/i.test(msg)) {
        return json({ error: `The sending account rejected the login — check SMTP_USER and the app password (SMTP_PASS).` }, 502);
      }
      return json({ error: `Email failed: ${msg.slice(0, 200)}` }, 502);
    }
  } else if (resendKey) {
    // ── Resend (needs a verified domain) ─────────────────────────────────────
    fromUsed =
      Deno.env.get("ORDERS_FROM_EMAIL") ??
      Deno.env.get("NOTIFY_FROM_EMAIL") ??
      "orders@thecoopops.com.au";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${displayName} <${fromUsed}>`,
        to: [to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(cc.length ? { cc } : {}),
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[send-purchase-order] Resend ${res.status}: ${body}`);
      if (res.status === 403 && /not verified/i.test(body)) {
        return json({ error: `Can't send from ${fromUsed} — its domain isn't verified in Resend.` }, 502);
      }
      return json({ error: `Email failed (${res.status}). ${body.slice(0, 200)}` }, 502);
    }
  } else {
    return json({ error: "Email isn't set up yet — set SMTP_USER and SMTP_PASS in Supabase secrets." }, 500);
  }

  const { error: updErr } = await db
    .from("purchase_orders")
    .update({
      status: po.status === "draft" ? "sent" : po.status,
      sent_at: new Date().toISOString(),
      sent_to: to,
      sent_by: userId,
      send_count: (po.send_count ?? 0) + 1,
    })
    .eq("id", po.id);
  if (updErr) console.error("[send-purchase-order] sent but failed to record:", updErr.message);

  return json({ ok: true, sent_to: to, from: fromUsed, reply_to: replyTo });
}
