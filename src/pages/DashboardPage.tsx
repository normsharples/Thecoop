import { useState } from "react";
import { format, subDays, addDays, subWeeks, startOfWeek, endOfWeek, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertsBanner } from "@/components/dashboard/AlertsBanner";
import { DailySnapshot } from "@/components/dashboard/DailySnapshot";
import { DailySecondaryCards } from "@/components/dashboard/DailySecondaryCards";
import { QuickStatsCards } from "@/components/dashboard/QuickStatsCards";
import { WeeklySnapshot } from "@/components/dashboard/WeeklySnapshot";
import { WeeklyStatsCards } from "@/components/dashboard/WeeklyStatsCards";
import { WeeklySecondaryCards } from "@/components/dashboard/WeeklySecondaryCards";
import { DeliveryUptimeCard } from "@/components/dashboard/DeliveryUptimeCard";
import { WebAppSalesCard } from "@/components/dashboard/WebAppSalesCard";
import { WeeklyRevenueTrend } from "@/components/dashboard/WeeklyRevenueTrend";
import { RecentReviews } from "@/components/dashboard/RecentReviews";
import { QuickLinks } from "@/components/dashboard/QuickLinks";

type Mode = "daily" | "weekly";

const todayStr = format(new Date(), "yyyy-MM-dd");
const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");

const DAILY_PRESETS = [
  { label: "Yesterday", value: yesterdayStr },
  { label: "Today", value: todayStr },
];

export default function DashboardPage() {
  const [mode, setMode] = useState<Mode>("daily");
  const [selectedDate, setSelectedDate] = useState(yesterdayStr);

  // ── Week helpers ─────────────────────────────────────────────────────────
  const anchor = parseISO(selectedDate);
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const weekLabel = `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`;

  const prevDayStr = format(subDays(anchor, 1), "yyyy-MM-dd");
  const prevWeekStart = format(subWeeks(weekStart, 1), "yyyy-MM-dd");
  const prevWeekEnd = format(subWeeks(weekEnd, 1), "yyyy-MM-dd");
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  function prevWeek() {
    setSelectedDate(format(subWeeks(weekStart, 1), "yyyy-MM-dd"));
  }
  function nextWeek() {
    setSelectedDate(format(addDays(weekEnd, 1), "yyyy-MM-dd"));
  }

  // ── Daily label ──────────────────────────────────────────────────────────
  const dailyDisplayDate =
    selectedDate === todayStr ? "Today"
    : selectedDate === yesterdayStr ? "Yesterday"
    : format(anchor, "d MMM yyyy");

  return (
    <div className="space-y-6">
      <AlertsBanner />

      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-input overflow-hidden text-xs font-medium">
          <button
            onClick={() => setMode("daily")}
            className={cn(
              "px-3 py-1.5 transition-colors",
              mode === "daily"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            Daily
          </button>
          <button
            onClick={() => setMode("weekly")}
            className={cn(
              "px-3 py-1.5 transition-colors",
              mode === "weekly"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            Weekly
          </button>
        </div>

        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />

          {mode === "daily" ? (
            <>
              {DAILY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setSelectedDate(p.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    selectedDate === p.value
                      ? "bg-primary text-primary-foreground"
                      : "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">
                Showing {dailyDisplayDate}
              </span>
            </>
          ) : (
            /* Week navigation */
            <div className="flex items-center gap-1">
              <button
                onClick={prevWeek}
                className="rounded-md border border-input bg-background p-1.5 hover:bg-accent transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-2 text-xs font-medium text-foreground min-w-[160px] text-center">
                {weekLabel}
              </span>
              <button
                onClick={nextWeek}
                className="rounded-md border border-input bg-background p-1.5 hover:bg-accent transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Daily view ────────────────────────────────────────────────────── */}
      {mode === "daily" && (
        <>
          <DailySnapshot date={selectedDate} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <DailySecondaryCards date={selectedDate} />
            <WebAppSalesCard
              from={selectedDate} to={selectedDate}
              prevFrom={prevDayStr} prevTo={prevDayStr}
              comparisonLabel="vs prev day"
            />
            <DeliveryUptimeCard />
          </div>
          <QuickStatsCards date={selectedDate} />
        </>
      )}

      {/* ── Weekly view ───────────────────────────────────────────────────── */}
      {mode === "weekly" && (
        <>
          <WeeklySnapshot date={selectedDate} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <WeeklySecondaryCards date={selectedDate} />
            <WebAppSalesCard
              from={weekStartStr} to={weekEndStr}
              prevFrom={prevWeekStart} prevTo={prevWeekEnd}
              comparisonLabel="vs prev week"
            />
            <DeliveryUptimeCard />
          </div>
          <WeeklyStatsCards date={selectedDate} />
        </>
      )}

      {/* ── Shared ────────────────────────────────────────────────────────── */}
      <WeeklyRevenueTrend date={selectedDate} />
      <RecentReviews />
      <QuickLinks />
    </div>
  );
}
