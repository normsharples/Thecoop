// admin-users
// Superadmin-only user management, executed server-side because it needs the
// service-role key (which must never ship in the frontend).
//
// Actions (JSON body):
//   { action: "create", username, full_name, password, role, restaurant_access }
//   { action: "reset_password", id, password }
//   { action: "delete", id }
//
// The caller's JWT (Authorization header) is verified and must belong to a
// superadmin, otherwise every action is rejected with 403.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYNTHETIC_EMAIL_DOMAIN = "thecoop.local";

type Role = "superadmin" | "area_manager" | "manager" | "staff";

interface CreateBody {
  action: "create";
  username: string;
  full_name: string;
  password: string;
  role: Role;
  restaurant_access: string[];
}
interface ResetBody {
  action: "reset_password";
  id: string;
  password: string;
}
interface DeleteBody {
  action: "delete";
  id: string;
}
type Body = CreateBody | ResetBody | DeleteBody;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Service-role client — bypasses RLS, holds admin powers.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // ── Authorize: the caller must be an authenticated superadmin ──────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Not authenticated" }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData.user) {
    return json({ error: "Not authenticated" }, 401);
  }

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (callerProfile?.role !== "superadmin") {
    return json({ error: "Superadmin access required" }, 403);
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  try {
    switch (body.action) {
      case "create": {
        const { username, full_name, password, role, restaurant_access } = body;
        if (!username || !full_name || !password) {
          return json({ error: "Username, name and password are required" }, 400);
        }
        if (password.length < 6) {
          return json({ error: "Password must be at least 6 characters" }, 400);
        }

        const email = username.includes("@")
          ? username
          : `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;

        const { data: created, error: createErr } =
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name, username },
          });
        if (createErr) return json({ error: createErr.message }, 400);

        const userId = created.user?.id;
        if (!userId) return json({ error: "Failed to create user" }, 500);

        // Overwrite the trigger-created profile with the intended role/access.
        const { error: profileErr } = await admin.from("profiles").upsert({
          id: userId,
          email,
          username,
          full_name,
          role,
          restaurant_access: restaurant_access ?? [],
        });
        if (profileErr) {
          // Roll back the auth user so a failed profile write doesn't orphan a login.
          await admin.auth.admin.deleteUser(userId);
          return json({ error: profileErr.message }, 400);
        }

        return json({ id: userId });
      }

      case "reset_password": {
        const { id, password } = body;
        if (!id || !password) {
          return json({ error: "User and password are required" }, 400);
        }
        if (password.length < 6) {
          return json({ error: "Password must be at least 6 characters" }, 400);
        }
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case "delete": {
        const { id } = body;
        if (!id) return json({ error: "User is required" }, 400);
        if (id === userData.user.id) {
          return json({ error: "You cannot delete your own account" }, 400);
        }
        // profiles row cascades via `on delete cascade` on the auth.users FK.
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
