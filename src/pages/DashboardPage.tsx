import { useState } from "react";
import { format, subDays, addDays, subWeeks, startOfWeek, endOfWeek, parseISO, differenceInCalendarDays } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Loader2, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { triggerRefresh, refreshErrorMessage } from "@/lib/refresh";
import { CustomisableDashboard } from "@/components/dashboard/CustomisableDashboard";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import type { DashboardPeriod } from "@/lib/dashboardWidgets";
import { useSetPageContextLine } from "@/contexts/PageContextLine";

type Mode = "daily" | "weekly" | "custom";

const todayStr = format(new Date(), "yyyy-MM-dd");
const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");
const weekAgoStr = format(subDays(new Date(), 7), "yyyy-MM-dd");

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

  function prevDay() {
    setSelectedDate(format(subDays(anchor, 1), "yyyy-MM-dd"));
  }
  function nextDay() {
    setSelectedDate(format(addDays(anchor, 1), "yyyy-MM-dd"));
  }

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

  // The topbar's second line: which period is on screen, and what it is
  // measured against. Nothing in the body repeats it.
  useSetPageContextLine(
    mode === "daily"
      ? `${format(anchor, "EEEE d MMMM yyyy")} · against the previous day`
      : mode === "weekly"
        ? `Week of ${weekLabel} · against the previous week`
        : customValid
          ? `${customLabel} · against the previous ${customLen} days`
          : "Choose a valid date range"
  );

  return (
    <div className="space-y-6">

      {/* ── Controls bar ────────────────────────────────────────
          Three objects, not nine: the period segment, the stepper for the
          chosen period, and the actions. Which day or week is on screen is
          spelled out in the topbar's context line, so nothing restates it
          here. */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Period */}
        <div
          role="group"
          aria-label="Period"
          className="flex gap-0.5 rounded-lg border border-border-strong bg-card p-0.5"
        >
          {([
            { value: "daily" as Mode, label: "Day" },
            { value: "weekly" as Mode, label: "Week" },
            { value: "custom" as Mode, label: "Custom" },
          ]).map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              aria-pressed={mode === m.value}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-[13px] transition-colors",
                mode === m.value
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-secondary-foreground hover:bg-accent"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Stepper — one control, whichever period is chosen */}
        {mode === "daily" ? (
          <div className="flex items-center gap-0.5 rounded-lg border border-border-strong bg-card p-0.5">
            <button
              onClick={prevDay}
              aria-label="Previous day"
              className="rounded-md p-1.5 text-secondary-foreground transition-colors hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[132px] text-center text-[13px] font-medium tabular-nums text-foreground">
              {dailyDisplayDate === "Today" || dailyDisplayDate === "Yesterday"
                ? `${dailyDisplayDate}, ${format(anchor, "d MMM")}`
                : format(anchor, "EEE d MMM yyyy")}
            </span>
            <button
              onClick={nextDay}
              aria-label="Next day"
              disabled={selectedDate >= todayStr}
              className="rounded-md p-1.5 text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : mode === "weekly" ? (
          <div className="flex items-center gap-0.5 rounded-lg border border-border-strong bg-card p-0.5">
            <button
              onClick={prevWeek}
              aria-label="Previous week"
              className="rounded-md p-1.5 text-secondary-foreground transition-colors hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[160px] text-center text-[13px] font-medium tabular-nums text-foreground">
              {weekLabel}
            </span>
            <button
              onClick={nextWeek}
              aria-label="Next week"
              className="rounded-md p-1.5 text-secondary-foreground transition-colors hover:bg-accent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="range-from" className="sr-only">Range start</label>
            <input
              id="range-from"
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => e.target.value && setCustomFrom(e.target.value)}
              className="rounded-lg border border-border-strong bg-card px-2.5 py-1.5 text-[13px] tabular-nums text-foreground [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-ring/40 dark:[color-scheme:dark]"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <label htmlFor="range-to" className="sr-only">Range end</label>
            <input
              id="range-to"
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(e) => e.target.value && setCustomTo(e.target.value)}
              className="rounded-lg border border-border-strong bg-card px-2.5 py-1.5 text-[13px] tabular-nums text-foreground [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-ring/40 dark:[color-scheme:dark]"
            />
            {!customValid && (
              <span className="text-xs text-destructive">Start date must be before end date</span>
            )}
          </div>
        )}

        {/* The picker stays available in day mode — quietly, as an icon. */}
        {mode === "daily" && (
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="dashboard-date" className="sr-only">Choose a date</label>
            <input
              id="dashboard-date"
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="rounded-lg border border-border-strong bg-card py-1.5 pl-8 pr-2.5 text-[13px] tabular-nums text-foreground [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-ring/40 dark:[color-scheme:dark]"
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canCustomise && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-card px-3 py-2 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-accent"
              title="Choose, arrange and size the widgets on this dashboard"
            >
              <LayoutGrid className="h-4 w-4" />
              Customise
            </button>
          )}
          <button
            onClick={handleRefreshData}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
            title="Reload the open Chrome tabs and pull the latest data into the dashboard"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh data
          </button>
        </div>
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
