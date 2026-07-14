import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { GoogleRatingDaily } from "@/types";

export interface StoreRating {
  restaurantId: string;
  /** The overall Google star rating as shown on the store's listing. */
  rating: number;
  /** Total number of Google reviews behind that rating (may be null). */
  reviewCount: number | null;
  /** Date of the snapshot the rating came from. */
  date: string;
}

/**
 * Latest overall Google rating for each restaurant, read from the
 * `google_rating_daily` snapshot table populated by the reviews sync.
 *
 * This is the real rating Google displays for the business — NOT an average
 * of the individual review rows we've scraped.
 *
 * Returns a map keyed by restaurant id.
 */
export function useGoogleRatings(restaurantIds: string[]) {
  const key = [...restaurantIds].sort();
  return useQuery({
    queryKey: ["google-ratings", key],
    queryFn: async () => {
      const map: Record<string, StoreRating> = {};
      if (!restaurantIds.length) return map;

      const { data, error } = await supabase
        .from("google_rating_daily")
        .select("restaurant_id, rating, review_count, date")
        .in("restaurant_id", restaurantIds)
        .order("date", { ascending: false });
      if (error) throw error;

      // Rows are newest-first, so the first one seen per restaurant is latest.
      for (const row of (data ?? []) as GoogleRatingDaily[]) {
        if (!map[row.restaurant_id]) {
          map[row.restaurant_id] = {
            restaurantId: row.restaurant_id,
            rating: Number(row.rating),
            reviewCount: row.review_count != null ? Number(row.review_count) : null,
            date: row.date,
          };
        }
      }
      return map;
    },
    enabled: restaurantIds.length > 0,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Combine several stores' Google ratings into one figure.
 * Weighted by each store's review count so a busier store counts for more;
 * falls back to a plain mean when review counts are missing.
 */
export function combineRatings(ratings: StoreRating[]): number | null {
  const valid = ratings.filter((r) => r.rating > 0);
  if (!valid.length) return null;

  const totalWeight = valid.reduce((s, r) => s + (r.reviewCount ?? 0), 0);
  if (totalWeight <= 0) {
    return valid.reduce((s, r) => s + r.rating, 0) / valid.length;
  }
  return valid.reduce((s, r) => s + r.rating * (r.reviewCount ?? 0), 0) / totalWeight;
}

/** Total number of Google reviews across the given stores. */
export function totalReviewCount(ratings: StoreRating[]): number | null {
  const counts = ratings.map((r) => r.reviewCount).filter((c): c is number => c != null);
  if (!counts.length) return null;
  return counts.reduce((s, c) => s + c, 0);
}
