import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Star, MessageSquare, TrendingUp, Loader2, RefreshCw } from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { cn } from "@/lib/utils";
import type { GoogleReview } from "@/types";

// ─── Star display ─────────────────────────────────────────────────────────────

function StarRating({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(cls, i < rating ? "fill-yellow-400 text-yellow-400" : "fill-muted text-muted")}
        />
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon, suffix = "",
}: {
  label: string; value: string | null; icon: React.ReactNode; suffix?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</div>
      </div>
      <p className="mt-3 text-3xl font-bold">{value ?? "—"}{value && suffix}</p>
    </div>
  );
}

// ─── Star distribution donut colours ─────────────────────────────────────────

const STAR_COLORS = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#22c55e"];

// ─── Preset range ─────────────────────────────────────────────────────────────

type DatePreset = "30d" | "90d" | "6m" | "1y" | "all";

function getPresetFrom(preset: DatePreset): string | null {
  const today = new Date();
  switch (preset) {
    case "30d": return format(subDays(today, 30), "yyyy-MM-dd");
    case "90d": return format(subDays(today, 90), "yyyy-MM-dd");
    case "6m":  return format(subDays(today, 180), "yyyy-MM-dd");
    case "1y":  return format(subDays(today, 365), "yyyy-MM-dd");
    case "all": return null;
  }
}

export default function ReviewsReport() {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const [datePreset, setDatePreset] = useState<DatePreset>("90d");
  const [filterStars, setFilterStars] = useState<number | null>(null);
  const [filterNeedsReply, setFilterNeedsReply] = useState(false);

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants?.map((r) => r.id) ?? [];

  const fromDate = getPresetFrom(datePreset);

  const { data: reviews, isLoading } = useQuery({
    queryKey: ["reviews-report", fromDate, restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      let query = supabase
        .from("google_reviews")
        .select("*")
        .in("restaurant_id", restaurantIds)
        .order("review_date", { ascending: false });
      if (fromDate) query = query.gte("review_date", fromDate);
      const { data, error } = await query;
      if (error) throw error;
      return data as GoogleReview[];
    },
    enabled: !!restaurantIds.length,
  });

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!reviews?.length) return null;
    const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    const withReply = reviews.filter((r) => r.reply).length;
    const responseRate = reviews.length > 0 ? (withReply / reviews.length) * 100 : 0;

    // Rating trend: compare first half vs second half
    const mid = Math.floor(reviews.length / 2);
    const recent = reviews.slice(0, mid);
    const older  = reviews.slice(mid);
    const recentAvg = recent.length > 0
      ? recent.reduce((s, r) => s + r.rating, 0) / recent.length : avgRating;
    const olderAvg  = older.length > 0
      ? older.reduce((s, r) => s + r.rating, 0) / older.length : avgRating;
    const trendDelta = recentAvg - olderAvg;

    return { avgRating, responseRate, count: reviews.length, trendDelta };
  }, [reviews]);

  // ── Rating trend over time (rolling 30-day avg) ───────────────────────────
  const trendData = useMemo(() => {
    if (!reviews?.length) return [];
    const sorted = [...reviews].sort(
      (a, b) => new Date(a.review_date).getTime() - new Date(b.review_date).getTime()
    );
    // Group by month
    const monthMap = new Map<string, number[]>();
    for (const r of sorted) {
      const key = format(parseISO(r.review_date as string), "MMM yyyy");
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key)!.push(r.rating);
    }
    return Array.from(monthMap.entries()).map(([month, ratings]) => ({
      month,
      avg: Math.round((ratings.reduce((s, v) => s + v, 0) / ratings.length) * 10) / 10,
      count: ratings.length,
    }));
  }, [reviews]);

  // ── Star distribution ─────────────────────────────────────────────────────
  const starDist = useMemo(() => {
    if (!reviews?.length) return [];
    return [1, 2, 3, 4, 5].map((stars) => ({
      name: `${stars}★`,
      value: reviews.filter((r) => r.rating === stars).length,
    }));
  }, [reviews]);

  // ── Filtered review feed ──────────────────────────────────────────────────
  const filteredReviews = useMemo(() => {
    if (!reviews) return [];
    return reviews.filter((r) => {
      if (filterStars !== null && r.rating !== filterStars) return false;
      if (filterNeedsReply && r.reply) return false;
      return true;
    });
  }, [reviews, filterStars, filterNeedsReply]);

  const datePresets: { key: DatePreset; label: string }[] = [
    { key: "30d", label: "30 days" },
    { key: "90d", label: "90 days" },
    { key: "6m",  label: "6 months" },
    { key: "1y",  label: "1 year" },
    { key: "all", label: "All time" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!reviews?.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
        <Star className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-base font-semibold text-foreground mb-2">No reviews yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Connect Google Business Profile in Settings → Integrations to start syncing reviews.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Date presets ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        {datePresets.map((p) => (
          <button
            key={p.key}
            onClick={() => setDatePreset(p.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              datePreset === p.key
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Avg Rating</p>
            <div className="rounded-lg bg-muted p-2 text-muted-foreground">
              <Star className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold">{kpis ? kpis.avgRating.toFixed(1) : "—"}</p>
          {kpis && (
            <div className="mt-2">
              <StarRating rating={Math.round(kpis.avgRating)} />
            </div>
          )}
        </div>
        <KpiCard
          label="Review Count"
          value={kpis ? String(kpis.count) : null}
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Response Rate</p>
            <div className="rounded-lg bg-muted p-2 text-muted-foreground">
              <RefreshCw className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-3xl font-bold">
            {kpis ? `${kpis.responseRate.toFixed(0)}%` : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Rating Trend</p>
            <div className="rounded-lg bg-muted p-2 text-muted-foreground">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <p className={cn(
            "mt-3 text-3xl font-bold",
            kpis && kpis.trendDelta > 0  && "text-green-500",
            kpis && kpis.trendDelta < 0  && "text-red-500",
            kpis && kpis.trendDelta === 0 && "text-foreground",
          )}>
            {kpis
              ? `${kpis.trendDelta >= 0 ? "+" : ""}${kpis.trendDelta.toFixed(1)}`
              : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">recent vs older</p>
        </div>
      </div>

      {/* ── Trend + Donut charts ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {trendData.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold mb-4">Rating Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  domain={[1, 5]}
                  tickFormatter={(v) => v.toFixed(1)}
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip
                  formatter={(v) => [Number(v).toFixed(1), "Avg Rating"]}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke="#eab308"
                  strokeWidth={2}
                  dot={{ fill: "#eab308", r: 3 }}
                  activeDot={{ r: 5 }}
                  name="Avg Rating"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {starDist.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold mb-4">Star Distribution</h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie
                    data={starDist}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {starDist.map((_, i) => (
                      <Cell key={i} fill={STAR_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [Number(v), String(name)]}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {[5, 4, 3, 2, 1].map((stars) => {
                  const count = reviews?.filter((r) => r.rating === stars).length ?? 0;
                  const total = reviews?.length ?? 1;
                  const pct   = Math.round((count / total) * 100);
                  return (
                    <div key={stars} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-4">{stars}</span>
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400 shrink-0" />
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: STAR_COLORS[stars - 1],
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Review Feed ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Reviews ({filteredReviews.length})</h3>
          <div className="flex items-center gap-2">
            {/* Star filter */}
            <div className="flex items-center gap-1">
              {[null, 1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s ?? "all"}
                  onClick={() => setFilterStars(s)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    filterStars === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {s === null ? "All" : `${s}★`}
                </button>
              ))}
            </div>
            <button
              onClick={() => setFilterNeedsReply((v) => !v)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                filterNeedsReply
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              Needs Reply
            </button>
          </div>
        </div>
        <div className="divide-y divide-border">
          {filteredReviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2" />
              <p className="text-sm">No reviews match the selected filters</p>
            </div>
          ) : (
            filteredReviews.slice(0, 50).map((review) => {
              const restaurant = restaurants?.find((r) => r.id === review.restaurant_id);
              const isLowRating = review.rating <= 3;
              return (
                <div
                  key={review.id}
                  className={cn(
                    "px-6 py-4 hover:bg-muted/10 transition-colors",
                    isLowRating && "border-l-2 border-red-500"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <StarRating rating={review.rating} />
                        <span className="text-xs text-muted-foreground">
                          {review.review_date
                            ? format(parseISO(review.review_date as string), "d MMM yyyy")
                            : ""}
                        </span>
                        {restaurant && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {restaurant.name}
                          </span>
                        )}
                        {isLowRating && (
                          <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-500">
                            Low rating
                          </span>
                        )}
                        {!review.reply && (
                          <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-500">
                            No reply
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium">{review.reviewer_name ?? "Anonymous"}</p>
                      {review.comment && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                          {review.comment}
                        </p>
                      )}
                      {review.reply && (
                        <div className="mt-2 rounded-lg bg-muted/30 px-3 py-2">
                          <p className="text-xs font-medium text-foreground mb-1">Owner reply</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">{review.reply}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {filteredReviews.length > 50 && (
          <div className="px-6 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing 50 of {filteredReviews.length} reviews. Export to see all.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
