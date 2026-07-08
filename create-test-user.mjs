// Run this once from your own Terminal:
//   node create-test-user.mjs

const SUPABASE_URL = "https://xivsbczrdnexxrrzdlxc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpdnNiY3pyZG5leHhycnpkbHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MDk2NDksImV4cCI6MjA5MTM4NTY0OX0.zSMNH65qHRN65XKlm9iCF7pzPPijqLJOggOYb2b6aVE";

const EMAIL    = "admin@thecoop.com.au";
const PASSWORD = "Coop2025!";
const FULL_NAME = "Norm Sharples";

async function main() {
  console.log("1/3  Signing up auth user…");
  const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const signup = await signupRes.json();

  if (signup.error) {
    // User probably already exists — try signing in to get the ID
    if (signup.error.includes?.("already") || signup.msg?.includes?.("already")) {
      console.log("   User already exists, signing in to get ID…");
    } else {
      console.error("Signup error:", signup);
      process.exit(1);
    }
  }

  // Sign in to get an access token + user ID
  console.log("2/3  Signing in to get access token…");
  const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const signin = await signinRes.json();

  if (!signin.access_token) {
    console.error("Sign-in failed:", signin);
    process.exit(1);
  }

  const userId = signin.user.id;
  console.log(`   User ID: ${userId}`);

  // Upsert the profile row as superadmin
  console.log("3/3  Setting superadmin profile…");
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${signin.access_token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: userId,
      email: EMAIL,
      full_name: FULL_NAME,
      role: "superadmin",
      restaurant_access: [],
    }),
  });

  if (!profileRes.ok) {
    const err = await profileRes.text();
    console.error("Profile upsert failed:", err);
    process.exit(1);
  }

  console.log("\n✅  Done! Login with:");
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log("\n   Role: superadmin — full access to all stores.");
}

main();
