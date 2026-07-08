// sync-google-reviews
// Fetches reviews from Google My Business API for each restaurant's google_place_id.
// Upserts into google_reviews table. Designed to run every 4 hours.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GMB_BASE = "https://mybusiness.googleapis.com/v4";
const RATE_LIMIT_DELAY_MS = 500;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface GmbReview {
  reviewId: string;
  reviewer: { displayName: string; profilePhotoUrl?: string };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
}

const starMap: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Load Google Business global settings
  const { data: setting, error: settingError } = await supabase
    .from("integration_settings")
    .select("*")
    .eq("provider", "google_business")
    .maybeSingle();

  if (settingError || !setting) {
    return new Response(
      JSON.stringify({ error: "Google Business not configured" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  const { api_key, account_id } = setting.credentials as {
    api_key: string;
    account_id: string;
  };

  if (!api_key || !account_id) {
    return new Response(
      JSON.stringify({ error: "Google Business credentials incomplete" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  // Load restaurants with google_place_id
  const { data: restaurants, error: restError } = await supabase
    .from("restaurants")
    .select("id, name, google_place_id")
    .not("google_place_id", "is", null);

  if (restError) {
    return new Response(
      JSON.stringify({ error: restError.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }

  const results = [];

  for (const restaurant of restaurants ?? []) {
    if (!restaurant.google_place_id) continue;

    const logEntry = {
      provider: "google_reviews",
      restaurant_id: restaurant.id,
      started_at: new Date().toISOString(),
      status: "success" as const,
      records_synced: 0,
      error_message: null as string | null,
      completed_at: null as string | null,
    };

    try {
      // GMB API: list reviews for a location
      // account_id format: accounts/123456
      // location name: accounts/123456/locations/ChIJ...
      const locationName = `${account_id}/locations/${restaurant.google_place_id}`;
      let pageToken: string | undefined;
      let allReviews: GmbReview[] = [];

      do {
        const url = new URL(`${GMB_BASE}/${locationName}/reviews`);
        url.searchParams.set("key", api_key);
        url.searchParams.set("pageSize", "100");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const res = await fetch(url.toString());
        if (res.status === 429) {
          await delay(10_000);
          continue;
        }
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`GMB API error ${res.status}: ${body}`);
        }

        const json = await res.json() as {
          reviews?: GmbReview[];
          nextPageToken?: string;
        };
        allReviews = allReviews.concat(json.reviews ?? []);
        pageToken = json.nextPageToken;
        if (pageToken) await delay(RATE_LIMIT_DELAY_MS);
      } while (pageToken);

      // Upsert reviews
      for (const review of allReviews) {
        const { error: upsertErr } = await supabase
          .from("google_reviews")
          .upsert(
            {
              restaurant_id: restaurant.id,
              google_review_id: review.reviewId,
              reviewer_name: review.reviewer.displayName,
              rating: starMap[review.starRating] ?? 3,
              comment: review.comment ?? null,
              review_date: review.createTime,
              reply: review.reviewReply?.comment ?? null,
              replied_at: review.reviewReply?.updateTime ?? null,
              source: "google",
            },
            { onConflict: "google_review_id" }
          );
        if (upsertErr) {
          console.error(`Failed to upsert review ${review.reviewId}:`, upsertErr.message);
        }
      }

      logEntry.records_synced = allReviews.length;
      logEntry.completed_at = new Date().toISOString();
      results.push({ restaurant_id: restaurant.id, status: "success", records: allReviews.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logEntry.status = "error" as const;
      logEntry.error_message = msg;
      logEntry.completed_at = new Date().toISOString();
      results.push({ restaurant_id: restaurant.id, status: "error", error: msg });
    }

    await supabase.from("sync_logs").insert(logEntry);
    await delay(RATE_LIMIT_DELAY_MS);
  }

  // Update Google Business sync status
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
    .eq("provider", "google_business");

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
