import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useGoogleRatings, combineRatings, totalReviewCount } from "@/hooks/useGoogleRatings";
import { formatDistanceToNow } from "date-fns";

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            "h-4 w-4",
            i < rating ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted"
          )}
        />
      ))}
    </div>
  );
}

export function RecentReviews() {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants?.map((r) => r.id) ?? [];

  // Current overall Google rating across the shown store(s).
  const { data: ratingMap } = useGoogleRatings(restaurantIds);
  const storeRatings = Object.values(ratingMap ?? {});
  const overallRating = combineRatings(storeRatings);
  const overallReviews = totalReviewCount(storeRatings);

  const { data: reviews, isLoading } = useQuery({
    queryKey: ["recent-reviews", selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("google_reviews")
        .select("*")
        .in("restaurant_id", restaurantIds)
        .order("review_date", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantIds.length,
  });

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Recent Reviews</h3>
        {overallRating !== null && (
          <div className="flex items-center gap-1.5 text-sm">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="font-semibold">{overallRating.toFixed(1)}</span>
            <span className="text-xs text-muted-foreground">
              Google{overallReviews !== null ? ` · ${overallReviews.toLocaleString()} reviews` : ""}
            </span>
          </div>
        )}
      </div>
      <div className="mt-4 space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-2 border-b border-border pb-4">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          ))
        ) : reviews && reviews.length > 0 ? (
          reviews.map((review) => {
            const restaurant = restaurants?.find((r) => r.id === review.restaurant_id);
            return (
              <div
                key={review.id}
                className="border-b border-border pb-4 last:border-b-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StarRating rating={review.rating} />
                      <span className="text-xs text-muted-foreground">
                        {review.review_date
                          ? formatDistanceToNow(new Date(review.review_date), { addSuffix: true })
                          : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{review.reviewer_name}</p>
                    {review.comment && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {review.comment}
                      </p>
                    )}
                  </div>
                  {restaurant && (
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                      {restaurant.name}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">No reviews yet</p>
        )}
      </div>
    </div>
  );
}
