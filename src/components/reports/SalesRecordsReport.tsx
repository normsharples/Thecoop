import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Crown, Calendar, TrendingUp, Loader2, Store, CalendarDays, CalendarRange } from "lucide-react";
import {
  format, parseISO, subYears,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
} from "date-fns";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import type { Restaurant } from "@/types";

// ─── Types ───────────────────────────────────────────────────────────────────

type Period = "day" | "week" | "month";

interface DailyRow {
  restaurant_id: string;
  date: string;
  total_sales: number;
  net_sales: number | null;
  transaction_count: number;
  average_transaction: number;
}

interface PeriodRecord {
  periodStart: string;
  periodEnd: string;
  total_sales: number;
  net_sales: number | null;
  transaction_count: number;
  average_transaction: number;
}

interface VenueRecords {
  restaurant: Restaurant;
  allTime: PeriodRecord | null;
  last12Months: PeriodRecord | null;
}

// ─── Period config ───────────────────────────────────────────────────────────

const PERIODS: { key: Period; label: string; icon: React.ReactNode; recordLabel: string }[] = [
  { key: "day",   label: "Best Day",   icon: <Calendar className="h-3.5 w-3.5" />,     recordLabel: "Day" },
  { key: "week",  label: "Best Week",  icon: <CalendarDays className="h-3.5 w-3.5" />, recordLabel: "Week" },
  { key: "month", label: "Best Month", icon: <CalendarRange className="h-3.5 w-3.5" />, recordLabel: "Month" },
];

function formatPeriodDate(record: PeriodRecord, period: Period): string {
  const start = parseISO(record.periodStart);
  if (period === "day") return format(start, "EEEE, d MMMM yyyy");
  if (period === "month") return format(start, "MMMM yyyy");
  const end = parseISO(record.periodEnd);
  const sameMonth = format(start, "MMM") === format(end, "MMM");
  return `Week of ${format(start, sameMonth ? "d" : "d MMM")} – ${format(end, "d MMM yyyy")}`;
}

// Groups raw daily rows into day/week/month buckets, summing totals.
// Incomplete (still in-progress) weeks/months are excluded so a partial
// period can't misleadingly outrank a genuinely complete record period.
function groupByPeriod(rows: DailyRow[], period: Period): PeriodRecord[] {
  if (period === "day") {
    return rows.map((r) => ({
      periodStart: r.date,
      periodEnd: r.date,
      total_sales: r.total_sales,
      net_sales: r.net_sales,
      transaction_count: r.transaction_count,
      average_transaction: r.average_transaction,
    }));
  }

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const buckets = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const d = parseISO(r.date);
    const key = format(
      period === "week" ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d),
      "yyyy-MM-dd"
    );
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  const records: PeriodRecord[] = [];
  for (const [key, group] of buckets) {
    const start = parseISO(key);
    const end = period === "week" ? endOfWeek(start, { weekStartsOn: 1 }) : endOfMonth(start);
    const endStr = format(end, "yyyy-MM-dd");
    if (endStr > todayStr) continue; // still in progress — not a complete period

    const total_sales = group.reduce((s, g) => s + g.total_sales, 0);
    const transaction_count = group.reduce((s, g) => s + g.transaction_count, 0);
    const netVals = group.map((g) => g.net_sales).filter((v): v is number => v != null);

    records.push({
      periodStart: key,
      periodEnd: endStr,
      total_sales,
      net_sales: netVals.length ? netVals.reduce((a, b) => a + b, 0) : null,
      transaction_count,
      average_transaction: transaction_count > 0 ? total_sales / transaction_count : 0,
    });
  }
  return records;
}

function bestOf(records: PeriodRecord[]): PeriodRecord | null {
  if (!records.length) return null;
  return records.reduce((best, curr) => (curr.total_sales > best.total_sales ? curr : best));
}

// ─── Venue colours ───────────────────────────────────────────────────────────

const VENUE_COLORS = [
  { gradient: "from-orange-500 to-amber-500", bg: "bg-orange-500/10", text: "text-orange-500", ring: "ring-orange-500/20", border: "border-orange-500/30" },
  { gradient: "from-blue-500 to-indigo-500",  bg: "bg-blue-500/10",   text: "text-blue-500",   ring: "ring-blue-500/20",   border: "border-blue-500/30"  },
  { gradient: "from-emerald-500 to-teal-500", bg: "bg-emerald-500/10",text: "text-emerald-500", ring: "ring-emerald-500/20", border: "border-emerald-500/30" },
];

// ─── Record card ─────────────────────────────────────────────────────────────

function RecordCard({
  title,
  icon,
  record,
  period,
  colorScheme,
}: {
  title: string;
  icon: React.ReactNode;
  record: PeriodRecord | null;
  period: Period;
  colorScheme: typeof VENUE_COLORS[0];
}) {
  if (!record) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 flex flex-col items-center justify-center text-center min-h-[180px]">
        <Calendar className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No data available</p>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-card p-6", colorScheme.border)}>
      {/* Subtle gradient accent at top */}
      <div className={cn("absolute top-0 left-0 right-0 h-1 bg-gradient-to-r", colorScheme.gradient)} />

      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={cn("rounded-lg p-2", colorScheme.bg)}>
            {icon}
          </div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            {title}
          </p>
        </div>
      </div>

      <p className={cn("text-4xl font-bold tabular-nums tracking-tight", colorScheme.text)}>
        {formatCurrency(record.total_sales)}
      </p>

      <p className="mt-2 text-sm font-medium text-foreground">
        {formatPeriodDate(record, period)}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3 pt-4 border-t border-border">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Transactions</p>
          <p className="text-sm font-semibold tabular-nums">{formatNumber(record.transaction_count)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Tx</p>
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(record.average_transaction)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Net Sales</p>
          <p className="text-sm font-semibold tabular-nums">
            {record.net_sales !== null ? formatCurrency(record.net_sales) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function SalesRecordsReport() {
  const { data: restaurants } = useRestaurants();
  const [period, setPeriod] = useState<Period>("day");

  const twelveMonthsAgo = useMemo(() => {
    return format(subYears(new Date(), 1), "yyyy-MM-dd");
  }, []);

  // Fetch full sales history for all restaurants once; day/week/month
  // records are derived client-side so switching tabs is instant.
  const { data: rows, isLoading } = useQuery({
    queryKey: ["sales-records-history", restaurants?.map((r) => r.id)],
    queryFn: async () => {
      if (!restaurants?.length) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("restaurant_id, date, total_sales, net_sales, transaction_count, average_transaction")
        .in("restaurant_id", restaurants.map((r) => r.id))
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DailyRow[];
    },
    enabled: !!restaurants?.length,
  });

  const venueRecords: VenueRecords[] = useMemo(() => {
    if (!restaurants || !rows) return [];
    return restaurants.map((r) => {
      const restaurantRows = rows.filter((row) => row.restaurant_id === r.id);
      const allBuckets = groupByPeriod(restaurantRows, period);
      const last12Buckets = allBuckets.filter((b) => b.periodStart >= twelveMonthsAgo);
      return {
        restaurant: r,
        allTime: bestOf(allBuckets),
        last12Months: bestOf(last12Buckets),
      };
    });
  }, [restaurants, rows, period, twelveMonthsAgo]);

  const overallAllTime = useMemo(() => {
    const withRecords = venueRecords.filter((v): v is VenueRecords & { allTime: PeriodRecord } => v.allTime !== null);
    if (!withRecords.length) return null;
    return withRecords.reduce((best, curr) =>
      curr.allTime.total_sales > best.allTime.total_sales ? curr : best
    );
  }, [venueRecords]);

  const overallLast12 = useMemo(() => {
    const withRecords = venueRecords.filter((v): v is VenueRecords & { last12Months: PeriodRecord } => v.last12Months !== null);
    if (!withRecords.length) return null;
    return withRecords.reduce((best, curr) =>
      curr.last12Months.total_sales > best.last12Months.total_sales ? curr : best
    );
  }, [venueRecords]);

  const periodConfig = PERIODS.find((p) => p.key === period)!;

  return (
    <div className="space-y-6">
      {/* ── Period selector ─────────────────────────────────────────────── */}
      <nav className="flex gap-1 rounded-xl border border-border bg-card p-1 overflow-x-auto w-fit">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
              period === p.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </nav>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* No data */}
      {!isLoading && venueRecords.every((v) => !v.allTime) && (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center text-center">
          <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-base font-semibold mb-2">No sales records</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Sales records will appear here once daily sales data has been captured.
          </p>
        </div>
      )}

      {!isLoading && venueRecords.some((v) => v.allTime) && (
        <>
          {/* ── Group highs banner ───────────────────────────────────────── */}
          {overallAllTime && (
            <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-card to-orange-500/5 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Crown className="h-5 w-5 text-amber-500" />
                <h3 className="text-sm font-semibold text-foreground">Group Record {periodConfig.recordLabel}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">All-Time Highest</p>
                  <p className="text-3xl font-bold text-amber-500 tabular-nums">
                    {formatCurrency(overallAllTime.allTime.total_sales)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {overallAllTime.restaurant.name} — {formatPeriodDate(overallAllTime.allTime, period)}
                  </p>
                </div>
                {overallLast12 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Last 12 Months Highest</p>
                    <p className="text-3xl font-bold text-orange-500 tabular-nums">
                      {formatCurrency(overallLast12.last12Months.total_sales)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {overallLast12.restaurant.name} — {formatPeriodDate(overallLast12.last12Months, period)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Per-venue records ────────────────────────────────────────── */}
          {venueRecords.map((venue, idx) => {
            const colors = VENUE_COLORS[idx % VENUE_COLORS.length];
            const isSameRecord =
              venue.allTime && venue.last12Months && venue.allTime.periodStart === venue.last12Months.periodStart;

            return (
              <div key={venue.restaurant.id} className="space-y-4">
                <div className="flex items-center gap-2">
                  <Store className={cn("h-4.5 w-4.5", colors.text)} />
                  <h3 className="text-base font-semibold text-foreground">
                    {venue.restaurant.name}
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <RecordCard
                    title={`All-Time Record ${periodConfig.recordLabel}`}
                    icon={<Trophy className={cn("h-4 w-4", colors.text)} />}
                    record={venue.allTime}
                    period={period}
                    colorScheme={colors}
                  />
                  <RecordCard
                    title={`Last 12 Months Record ${periodConfig.recordLabel}`}
                    icon={<TrendingUp className={cn("h-4 w-4", colors.text)} />}
                    record={venue.last12Months}
                    period={period}
                    colorScheme={colors}
                  />
                </div>

                {isSameRecord && (
                  <p className="text-xs text-muted-foreground italic pl-1">
                    The all-time record was set within the last 12 months — same {period} for both!
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
