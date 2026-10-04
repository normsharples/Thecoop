import { useState } from "react";
import { format, subDays, addDays, subWeeks, startOfWeek, endOfWeek, parseISO, differenceInCalendarDays } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Loader2, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { triggerRefresh, refreshErrorMessage } from "@/lib/refresh";
import { CustomisableDashboard } from "@/components/dashboard/CustomisableDashboard";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import type { DashboardPeriod } from "@/lib/dashboardWidgets";

type Mode = "daily" | "weekly" | "custom";

const todayStr = format(new Date(), "yyyy-MM-dd");
const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");
const weekAgoStr = format(subDays(new Date(), 7), "yyyy-MM-dd");

const DAILY_PRESETS = [
  { label: "Yesterday", value: yesterdayStr },
  { label: "Today", value: todayStr },
];

export default function DashboardPage() {
  const [mode, setMode] = useState<Mode>("daily");
  const [selectedDate, setSelectedDate] = useState(yesterdayStr);
  const [customFrom, setCustomFrom] = useState(weekAgoStr);
  const [customTo, setCustomTo] = useState(yesterdayStr);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const { canCustomise } = useDashboardLayout();

  async function handleRefreshData() {
    if (refreshing) return;
    setRefreshing(true);
    const toastId = toast.loading("Refreshing data… this can take a minute.");
    const res = await triggerRefresh("all");
    if (res.ok) toast.success("Data refreshed", { id: toastId });
    else toast.error(refreshErrorMessage(res), { id: toastId });
    setRefreshing(false);
  }

  // ── Custom range helpers ───────────────────────────────────────────────────
  // Previous comparison window = same-length range immediately before the selection.
  const customValid = customFrom <= customTo;
  const customLen = differenceInCalendarDays(parseISO(customTo), parseISO(customFrom)) + 1;
  const customPrevFrom = format(subDays(parseISO(customFrom), customLen), "yyyy-MM-dd");
  const customPrevTo = format(subDays(parseISO(customTo), customLen), "yyyy-MM-dd");
  const customLabel = `${format(parseISO(customFrom), "d MMM")} – ${format(parseISO(customTo), "d MMM yyyy")}`;

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

  // ── Resolved period, handed to every widget ───────────────────────────────
  const period: DashboardPeriod =
    mode === "daily"
      ? {
          mode, date: selectedDate, from: selectedDate, to: selectedDate,
          prevFrom: prevDayStr, prevTo: prevDayStr, comparisonLabel: "vs prev day",
        }
      : mode === "weekly"
        ? {
            mode, date: selectedDate, from: weekStartStr, to: weekEndStr,
            prevFrom: prevWeekStart, prevTo: prevWeekEnd, comparisonLabel: "vs prev week",
          }
        : {
            mode, date: customTo, from: customFrom, to: customTo,
            prevFrom: customPrevFrom, prevTo: customPrevTo, comparisonLabel: "vs prev period",
          };

  return (
    <div className="space-y-6">

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
          <button
            onClick={() => setMode("custom")}
            className={cn(
              "px-3 py-1.5 transition-colors",
              mode === "custom"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            Custom Range
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
          ) : mode === "weekly" ? (
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
          ) : (
            /* Custom range */
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => e.target.value && setCustomFrom(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => e.target.value && setCustomTo(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">
                {customValid ? customLabel : "Start date must be before end date"}
              </span>
            </div>
          )}
        </div>

        {canCustomise && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            title="Choose, arrange and size the widgets on this dashboard"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Customise
          </button>
        )}
        <button
          onClick={handleRefreshData}
          disabled={refreshing}
          className={cn(canCustomise && !editing ? "" : "ml-auto", "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors")}
          title="Reload the open Chrome tabs and pull the latest data into the dashboard"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh Data
        </button>
      </div>

      {mode === "custom" && !customValid ? null : (
        <CustomisableDashboard
          period={period}
          editing={editing}
          onDoneEditing={() => setEditing(false)}
        />
      )}
    </div>
  );
}
