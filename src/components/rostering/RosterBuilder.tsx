import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Copy,
  Send,
  Undo2,
  Loader2,
  CalendarRange,
  Users,
  Layers,
  LayoutGrid,
  Clock,
  AlertTriangle,
  Wand2,
  TrendingUp,
  MoreVertical,
  Printer,
  Trash2,
  X,
  LayoutTemplate,
  CalendarPlus,
  LineChart,
  ArrowUp,
  ArrowDown,
  Search,
  Info,
  ShieldAlert,
} from "lucide-react";
import { format, parseISO, addDays, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useEmployees } from "@/hooks/useEmployees";
import { usePositions } from "@/hooks/usePositions";
import { useShifts } from "@/hooks/useShifts";
import { useRosterWeek } from "@/hooks/useRosterWeek";
import { useTargets } from "@/hooks/useTargets";
import { useDailyProjections } from "@/hooks/useDailyProjections";
import {
  mondayOf,
  toISODate,
  weekDates,
  weekStartOf,
  DAY_LABELS,
  shiftHours,
  requiredHours,
  varianceColor,
  formatTime,
  timeToMinutes,
  minutesToTime,
} from "@/lib/roster";
import { cn, formatCurrency } from "@/lib/utils";
import { effectiveColour, positionLabel, type AreaLayout } from "@/lib/positions";
import {
  useWeekConflicts,
  type Conflict,
  type ConflictFn,
  type DayStatus,
  type DayStatusFn,
} from "@/hooks/useWeekConflicts";
import type { Shift, Profile, Position } from "@/types";
import { ShiftModal, type ShiftDraft } from "./ShiftModal";
import { useAwardConfig } from "@/hooks/useAward";
import { effectiveHourlyRate } from "@/lib/award";
import { useStationTraining } from "@/hooks/useStationTraining";
import { autoAssignWeek } from "@/lib/autoRoster";
import { useStaffingMatrix } from "@/hooks/useStaffingMatrix";
import { useStaffingConfig } from "@/hooks/useStaffingConfig";
import { useSalesProjection, type DayProjection } from "@/hooks/useSalesProjection";
import { generateDayShifts } from "@/lib/staffing";
import { demandParamsFrom } from "@/lib/rosterForecast";
import ForecastGraph from "@/components/rostering/ForecastGraph";
import PositionsSettings from "@/components/settings/PositionsSettings";
import TemplateEditor from "@/components/rostering/TemplateEditor";
import { useShiftTemplate } from "@/hooks/useShiftTemplate";
import { useRosterIssues } from "@/hooks/useRosterIssues";
import {
  weeklyHoursBand,
  hoursBandColor,
  hoursBandTitle,
  hoursCeiling,
  worstSeverity,
  ISSUE_LABELS,
  type RosterIssue,
  type IssueSeverity,
} from "@/lib/rosterCompliance";

type SortKey = "name" | "hours";

// The forecast toggle is a per-browser view preference, not roster data.
const FORECAST_PREF_KEY = "coop.roster.forecastGraph";

function readForecastPref(): boolean {
  try {
    return localStorage.getItem(FORECAST_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writeForecastPref(on: boolean): void {
  try {
    localStorage.setItem(FORECAST_PREF_KEY, on ? "1" : "0");
  } catch {
    // Private mode / blocked storage — the toggle just won't persist.
  }
}

export default function RosterBuilder() {
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const [weekStart, setWeekStart] = useState(() => toISODate(mondayOf(new Date())));
  const [view, setView] = useState<"week" | "day">("week");
  const [groupBy, setGroupBy] = useState<"employee" | "area">("employee");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [dayIndex, setDayIndex] = useState(() => {
    const todayWeek = weekStartOf(toISODate(new Date()));
    const isThisWeek = todayWeek === toISODate(mondayOf(new Date()));
    return isThisWeek ? Math.min((new Date().getDay() + 6) % 7, 6) : 0;
  });
  const [modal, setModal] = useState<ShiftDraft | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [editAreasOpen, setEditAreasOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [showInsights, setShowInsights] = useState(false); // mobile: hidden by default
  // Team list sort / filter (applies to the week grid, day timeline and mobile)
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [stationFilter, setStationFilter] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  // Compliance issues panel + week-grid drag state
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [dragShift, setDragShift] = useState<Shift | null>(null);
  // Day-view forecast graph — off by default, remembered per browser.
  const [showForecast, setShowForecast] = useState(() => readForecastPref());
  const toggleForecast = () =>
    setShowForecast((v) => {
      writeForecastPref(!v);
      return !v;
    });

  const days = weekDates(weekStart);
  const storeId = selectedRestaurantId;
  const store = restaurants.find((r) => r.id === storeId);

  const { data: employees = [] } = useEmployees();
  const { activePositions } = usePositions(storeId);
  const {
    shifts,
    save,
    isSaving,
    remove,
    copyFromWeek,
    bulkAssign,
    deleteOpenWeek,
    bulkInsert,
    isGenerating,
    deleteAllWeek,
    isDeletingAll,
  } = useShifts(storeId, weekStart);
  const { training } = useStationTraining();
  const { lines: templateLines } = useShiftTemplate(storeId);
  const { rows: staffingMatrix } = useStaffingMatrix(storeId);
  const { config: staffingConfig } = useStaffingConfig(storeId);
  const {
    projectedByDate,
    detailByDate,
    refWeekLabel,
    isLoading: projLoading,
  } = useSalesProjection(storeId, days, staffingConfig);
  const { status, isPublished, publish, unpublish, week, isUpdating } =
    useRosterWeek(storeId, weekStart);
  const { getSpmhTarget, getMinRosterHours } = useTargets(storeId);
  const { getProjection } = useDailyProjections(
    storeId ? [storeId] : [],
    days[0],
    days[6]
  );
  const { conflictFor, dayStatusFor } = useWeekConflicts(weekStart, !!storeId);
  const awardCfg = useAwardConfig();
  // Compliance: double-bookings across venues, rest breaks, meal breaks,
  // overtime, under-18 hours, public-holiday cost notes.
  const issues = useRosterIssues(storeId, weekStart, shifts, employees);

  // Actual sales + actual labour hours for the week (from the existing feeds).
  const { data: salesRows = [] } = useQuery({
    queryKey: ["roster-actual-sales", storeId, weekStart],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("date,total_sales")
        .eq("restaurant_id", storeId)
        .gte("date", days[0])
        .lte("date", days[6]);
      if (error) throw error;
      return data as { date: string; total_sales: number }[];
    },
    enabled: !!storeId,
  });
  const { data: labourRows = [] } = useQuery({
    queryKey: ["roster-actual-labour", storeId, weekStart],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await supabase
        .from("labour_daily")
        .select("date,total_hours")
        .eq("restaurant_id", storeId)
        .gte("date", days[0])
        .lte("date", days[6]);
      if (error) throw error;
      return data as { date: string; total_hours: number }[];
    },
    enabled: !!storeId,
  });

  const empById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees]
  );
  const posById = useMemo(
    () => new Map(activePositions.map((p) => [p.id, p])),
    [activePositions]
  );
  // All areas with their sub-areas, in configured order (used by area grouping).
  const areaLayout = useMemo(
    () =>
      activePositions
        .filter((p) => !p.parent_id)
        .map((area) => ({
          area,
          subs: activePositions.filter((s) => s.parent_id === area.id),
        })),
    [activePositions]
  );

  // Paid hours each person has at THIS venue this week (drives the Wkly hrs
  // column and the "hide people with nothing on" filter).
  const hoursByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shifts) {
      if (!s.employee_id) continue;
      map.set(
        s.employee_id,
        (map.get(s.employee_id) ?? 0) +
          shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes)
      );
    }
    return map;
  }, [shifts]);

  // Which people the grid shows, and in what order. Applies to the week grid,
  // the day timeline and the mobile list so they never disagree. Assignment
  // (the shift modal) and Auto-build always see the full team.
  const visibleEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    // A station filter matches the area itself or any of its sub-areas.
    const stationIds = new Set<string>();
    if (stationFilter) {
      stationIds.add(stationFilter);
      for (const p of activePositions)
        if (p.parent_id === stationFilter) stationIds.add(p.id);
    }
    const trained = new Set(
      stationFilter
        ? training.filter((t) => stationIds.has(t.position_id)).map((t) => t.employee_id)
        : []
    );

    const list = employees.filter((e) => {
      if (term && !e.full_name.toLowerCase().includes(term)) return false;
      if (stationFilter && !trained.has(e.id)) return false;
      if (hideEmpty && (hoursByEmployee.get(e.id) ?? 0) <= 0) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortBy === "hours") {
        const diff = (hoursByEmployee.get(a.id) ?? 0) - (hoursByEmployee.get(b.id) ?? 0);
        if (diff !== 0) return diff * dir;
        return a.full_name.localeCompare(b.full_name);
      }
      return a.full_name.localeCompare(b.full_name) * dir;
    });
  }, [
    employees,
    search,
    stationFilter,
    hideEmpty,
    hoursByEmployee,
    sortBy,
    sortDir,
    training,
    activePositions,
  ]);

  const filtersActive =
    search.trim() !== "" || stationFilter !== "" || hideEmpty;

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir(key === "hours" ? "desc" : "asc");
    }
  };

  // Per-day metrics: projected/actual sales, projected(rostered)/actual labour
  // hours, and projected/actual SPMH (sales per man-hour).
  const coverage = useMemo(() => {
    const spmh = getSpmhTarget();
    const minH = getMinRosterHours();
    const salesByDate = new Map(salesRows.map((r) => [r.date, r.total_sales]));
    const labourByDate = new Map(labourRows.map((r) => [r.date, r.total_hours]));

    // A salaried person's cost per hour = (annual salary ÷ 52) ÷ their contracted
    // hours/week (set in Payroll). Hourly staff use the award-derived base rate
    // (level × junior %, or a manual override) — a planning estimate at the
    // ordinary rate, before penalties.
    const shiftCost = (s: Shift): number => {
      if (!s.employee_id) return 0; // open shift — no assigned cost yet
      const emp = empById.get(s.employee_id);
      if (!emp) return 0;
      const h = shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes);
      if (emp.pay_type === "salary") {
        const weekly = (emp.salary_annual ?? 0) / 52;
        const contracted = emp.contracted_hours ?? 0;
        return contracted > 0 ? h * (weekly / contracted) : 0;
      }
      return h * (effectiveHourlyRate(emp, s.date, awardCfg).rate ?? 0);
    };

    return days.map((d) => {
      const dayShifts = shifts.filter((s) => s.date === d);
      const rostered = dayShifts.reduce(
        (sum, s) => sum + shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes),
        0
      );
      const projCost = dayShifts.reduce((sum, s) => sum + shiftCost(s), 0);
      // Calculated hourly projection is the source of truth; fall back to the
      // manually-entered daily projection only when there's no history yet.
      const calc = projectedByDate.get(d)?.reduce((a, b) => a + b, 0) ?? 0;
      const projSales = calc > 0 ? calc : getProjection(storeId ?? "", d);
      const actSales = salesByDate.get(d) ?? null;
      const actLabour = labourByDate.get(d) ?? null;
      const required = requiredHours(projSales, spmh, minH);
      const projSpmh = projSales != null && rostered > 0 ? projSales / rostered : null;
      const actSpmh = actSales != null && actLabour ? actSales / actLabour : null;
      return {
        date: d,
        rostered,
        required,
        projSales,
        actSales,
        projLabour: rostered,
        actLabour,
        projCost,
        projSpmh,
        actSpmh,
      };
    });
  }, [days, shifts, empById, getSpmhTarget, getMinRosterHours, getProjection, storeId, salesRows, labourRows, awardCfg, projectedByDate]);

  // Weekly totals for the summary card next to Sunday.
  const weekTotals = useMemo(() => {
    const sum = (fn: (c: (typeof coverage)[number]) => number | null) =>
      coverage.reduce((t, c) => t + (fn(c) ?? 0), 0);
    const projSales = sum((c) => c.projSales);
    const actSales = sum((c) => c.actSales);
    const projLabour = sum((c) => c.projLabour);
    const actLabour = sum((c) => c.actLabour);
    const projCost = sum((c) => c.projCost);
    return {
      projSales,
      actSales,
      projLabour,
      actLabour,
      projCost,
      projSpmh: projLabour > 0 ? projSales / projLabour : null,
      actSpmh: actLabour > 0 ? actSales / actLabour : null,
    };
  }, [coverage]);

  if (!storeId) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Pick a single venue"
        body="Choose one venue from the switcher at the top to build its roster. The builder works one store at a time."
      />
    );
  }

  const weekLabel = `${format(parseISO(days[0]), "d MMM")} – ${format(
    parseISO(days[6]),
    "d MMM yyyy"
  )}`;

  const shiftWeek = (delta: number) =>
    setWeekStart(toISODate(addDays(parseISO(weekStart), delta * 7)));

  const openAdd = (date: string, employeeId = "") =>
    setModal({
      employee_id: employeeId,
      date,
      start_time: "09:00",
      end_time: "17:00",
      unpaid_break_minutes: 0,
      position_id: null,
      note: null,
    });

  // Area view: the cell already knows both the area and the person.
  const openAddAreaCell = (
    date: string,
    positionId: string | null,
    employeeId: string
  ) =>
    setModal({
      employee_id: employeeId,
      date,
      start_time: "09:00",
      end_time: "17:00",
      unpaid_break_minutes: 0,
      break_start: null,
      position_id: positionId,
      note: null,
    });

  // Drag-to-create on the day timeline: prefill times + the lane's context.
  const openAddRange = (
    prefill: { employee_id?: string; position_id?: string | null },
    startMinutes: number,
    endMinutes: number
  ) =>
    setModal({
      employee_id: prefill.employee_id ?? "",
      date: days[dayIndex],
      start_time: minutesToTime(startMinutes),
      end_time: minutesToTime(endMinutes),
      unpaid_break_minutes: 0,
      break_start: null,
      position_id: prefill.position_id ?? null,
      note: null,
    });

  const openEdit = (s: Shift) =>
    setModal({
      id: s.id,
      employee_id: s.employee_id ?? "",
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
      unpaid_break_minutes: s.unpaid_break_minutes,
      break_start: s.break_start,
      position_id: s.position_id,
      note: s.note,
    });

  // Persist a dragged shift move (time and/or lane) from the day-view timeline.
  const saveMove = async (
    shift: Shift,
    patch: {
      startMinutes: number;
      endMinutes: number;
      employee_id?: string | null;
      position_id?: string | null;
    }
  ) => {
    try {
      const delta = patch.startMinutes - timeToMinutes(shift.start_time);
      const break_start = shift.break_start
        ? minutesToTime(timeToMinutes(shift.break_start) + delta)
        : null;
      await save({
        id: shift.id,
        restaurant_id: shift.restaurant_id,
        employee_id:
          patch.employee_id !== undefined ? patch.employee_id : shift.employee_id,
        date: shift.date,
        start_time: minutesToTime(patch.startMinutes),
        end_time: minutesToTime(patch.endMinutes),
        unpaid_break_minutes: shift.unpaid_break_minutes,
        break_start,
        position_id:
          patch.position_id !== undefined ? patch.position_id : shift.position_id,
        note: shift.note,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move shift");
    }
  };

  // Persist a dragged break position (day-view timeline) without opening the modal.
  const saveBreak = async (shift: Shift, breakStartMinutes: number) => {
    try {
      await save({
        id: shift.id,
        restaurant_id: shift.restaurant_id,
        employee_id: shift.employee_id,
        date: shift.date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        unpaid_break_minutes: shift.unpaid_break_minutes,
        break_start: minutesToTime(breakStartMinutes),
        position_id: shift.position_id,
        note: shift.note,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move break");
    }
  };

  // ── Week-grid drag & drop ───────────────────────────────────────────────────
  // Drop a shift on another cell to move it to that day / person / area. Hold
  // Alt (⌥) while dropping to leave the original in place and copy instead.
  const handleCellDrop = async (
    shift: Shift,
    target: { date: string; employee_id?: string | null; position_id?: string | null },
    copy: boolean
  ) => {
    setDragShift(null);
    const nextEmp =
      target.employee_id !== undefined ? target.employee_id : shift.employee_id;
    const nextPos =
      target.position_id !== undefined ? target.position_id : shift.position_id;
    const unchanged =
      target.date === shift.date &&
      nextEmp === shift.employee_id &&
      nextPos === shift.position_id;
    if (unchanged && !copy) return;
    try {
      await save({
        ...(copy ? {} : { id: shift.id }),
        restaurant_id: shift.restaurant_id,
        employee_id: nextEmp,
        date: target.date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        unpaid_break_minutes: shift.unpaid_break_minutes,
        break_start: shift.break_start,
        position_id: nextPos,
        note: shift.note,
      });
      const idx = days.indexOf(target.date);
      const dayLabel = idx >= 0 ? DAY_LABELS[idx] : format(parseISO(target.date), "d MMM");
      toast.success(copy ? `Copied to ${dayLabel}` : `Moved to ${dayLabel}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move shift");
    }
  };

  // The forecast graph, in whichever scope the current view calls for.
  const forecastFor = (scope: "day" | "week") => (
    <ForecastGraph
      scope={scope}
      date={days[dayIndex]}
      days={days}
      shifts={scope === "day" ? shifts.filter((s) => s.date === days[dayIndex]) : shifts}
      matrix={staffingMatrix}
      config={staffingConfig}
      detailByDate={detailByDate}
      projectedByDate={projectedByDate}
      areaLayout={areaLayout}
      loading={projLoading}
      onHide={toggleForecast}
    />
  );

  // Jump from the issues panel straight to the shift that caused it.
  const openIssue = (issue: RosterIssue) => {
    const target = shifts.find((s) => issue.shiftIds.includes(s.id));
    if (!target) return;
    setIssuesOpen(false);
    openEdit(target);
  };

  const handleCopyLastWeek = async () => {
    const prev = toISODate(addDays(parseISO(weekStart), -7));
    if (shifts.length > 0 && !window.confirm(
      "This week already has shifts. Copy last week's shifts on top of them?"
    )) return;
    try {
      const n = await copyFromWeek(prev);
      toast.success(n ? `Copied ${n} shifts from last week` : "Last week was empty");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Copy failed");
    }
  };

  const handleAutoBuild = async () => {
    if (!storeId) return;
    const openCount = shifts.filter((s) => !s.employee_id).length;
    if (openCount === 0) {
      toast.error(
        shifts.length === 0
          ? "No shifts to fill yet — add shifts or copy last week first."
          : "No empty shifts to fill — every shift already has someone."
      );
      return;
    }
    if (
      !window.confirm(
        `Auto-build will fill the ${openCount} empty shift${
          openCount === 1 ? "" : "s"
        } this week using who's trained on each station and available. Shifts you've already assigned stay as they are. Continue?`
      )
    )
      return;
    try {
      const { assignments, filled, leftOpen } = autoAssignWeek({
        shifts,
        employees,
        training,
        conflictFor,
        venueId: storeId,
      });
      // Only write the ones we actually filled; left-open slots stay open.
      const toWrite = assignments
        .filter((a) => a.employeeId)
        .map((a) => ({ id: a.shiftId, employee_id: a.employeeId }));
      await bulkAssign(toWrite);
      if (filled === 0) {
        toast.error(
          "Couldn't fill any — nobody trained and available for the empty shifts."
        );
      } else if (leftOpen > 0) {
        toast.success(
          `Auto-build done — filled ${filled}, left ${leftOpen} open (no trained, available staff).`
        );
      } else {
        toast.success(`Auto-build done — filled all ${filled} empty shifts.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-build failed");
    }
  };

  const handleBuildFromSales = async () => {
    if (!storeId || !staffingConfig) return;
    if (staffingMatrix.length === 0) {
      toast.error("No staffing matrix yet — set it in Settings → Staffing first.");
      return;
    }
    if (projLoading) {
      toast.error("Still loading projected sales — try again in a moment.");
      return;
    }
    const params = demandParamsFrom(staffingConfig);

    // Generate open-shift slots for every day from its projected hourly sales.
    const genSlots: {
      id: string;
      date: string;
      start_time: string;
      end_time: string;
      unpaid_break_minutes: number;
      position_id: string | null;
      note: string | null;
      employee_id: null;
    }[] = [];
    let idx = 0;
    let projTotal = 0;
    for (const d of days) {
      const hourly = projectedByDate.get(d) ?? new Array(24).fill(0);
      projTotal += hourly.reduce((a, b) => a + b, 0);
      for (const g of generateDayShifts(staffingMatrix, hourly, params)) {
        genSlots.push({
          id: `gen-${idx++}`,
          date: d,
          start_time: minutesToTime(g.startHour * 60),
          end_time: minutesToTime(g.endHour * 60),
          unpaid_break_minutes: g.breakMinutes,
          position_id: g.position_id,
          note: g.station_name,
          employee_id: null,
        });
      }
    }

    if (genSlots.length === 0) {
      toast.error(
        "No shifts generated — no projected sales for this week yet, or the staffing matrix is empty."
      );
      return;
    }

    if (
      !window.confirm(
        `Build from sales will replace this week's OPEN shifts with ${
          genSlots.length
        } shifts generated from projected sales (~${formatCurrency(
          projTotal
        )} for the week), then assign trained & available people. Shifts you've already assigned stay as they are. Continue?`
      )
    )
      return;

    try {
      // Assign people to the generated slots, treating already-assigned shifts
      // as fixed (so they're not double-booked and their hours still count).
      const fixed = shifts.filter((s) => s.employee_id);
      const { assignments, filled, leftOpen } = autoAssignWeek({
        shifts: [...fixed, ...(genSlots as unknown as Shift[])],
        employees,
        training,
        conflictFor,
        venueId: storeId,
      });
      const assignedBySlot = new Map(
        assignments.map((a) => [a.shiftId, a.employeeId])
      );
      const insertRows = genSlots.map((g) => ({
        restaurant_id: storeId,
        employee_id: assignedBySlot.get(g.id) ?? null,
        date: g.date,
        start_time: g.start_time,
        end_time: g.end_time,
        unpaid_break_minutes: g.unpaid_break_minutes,
        break_start: null,
        position_id: g.position_id,
        note: g.note,
      }));

      await deleteOpenWeek();
      await bulkInsert(insertRows);
      toast.success(
        `Built ${insertRows.length} shifts from sales — filled ${filled}${
          leftOpen > 0 ? `, ${leftOpen} left open` : ""
        }.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Build from sales failed");
    }
  };

  const handlePublish = async () => {
    try {
      if (isPublished) {
        await unpublish();
        toast.success("Roster unpublished — hidden from the team again");
      } else {
        await publish();
        toast.success("Roster published — the team can see it now");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update publish state");
    }
  };

  const handleDeleteAll = async () => {
    if (shifts.length === 0) {
      toast.error("No shifts to delete this week.");
      return;
    }
    if (
      !window.confirm(
        `Delete ALL ${shifts.length} shifts on this week's roster? This can't be undone.`
      )
    )
      return;
    try {
      await deleteAllWeek();
      toast.success("All shifts deleted for the week");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete shifts");
    }
  };

  const handleCopyToWeek = async (
    targetWeekISO: string,
    opts: { areaIds: string[]; includeUnassigned: boolean; includeNames: boolean }
  ) => {
    const includeIds = new Set<string>();
    for (const areaId of opts.areaIds) {
      includeIds.add(areaId);
      for (const sub of activePositions.filter((p) => p.parent_id === areaId))
        includeIds.add(sub.id);
    }
    const offset = differenceInCalendarDays(parseISO(targetWeekISO), parseISO(weekStart));
    const rows = shifts
      .filter((s) => (s.position_id ? includeIds.has(s.position_id) : opts.includeUnassigned))
      .map((s) => ({
        restaurant_id: s.restaurant_id,
        employee_id: opts.includeNames ? s.employee_id : null,
        date: toISODate(addDays(parseISO(s.date), offset)),
        start_time: s.start_time,
        end_time: s.end_time,
        unpaid_break_minutes: s.unpaid_break_minutes,
        break_start: s.break_start ?? null,
        position_id: s.position_id,
        note: s.note,
      }));
    if (!rows.length) {
      toast.error("No shifts match the selected areas.");
      return;
    }
    try {
      await bulkInsert(rows);
      toast.success(
        `Copied ${rows.length} shifts to week of ${format(parseISO(targetWeekISO), "d MMM")}`
      );
      setCopyOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to copy shifts");
    }
  };

  const handlePrint = () =>
    printRoster({ storeName: store?.name ?? "Roster", weekLabel, days, employees, shifts, posById });

  const handleGenerateTemplate = async () => {
    if (!storeId) return;
    if (templateLines.length === 0) {
      toast.error("Your roster template is empty — edit it first.");
      return;
    }
    if (
      !window.confirm(
        `Add the template's ${templateLines.length} shifts to the week of ${weekLabel}? Existing shifts are kept.`
      )
    )
      return;
    const rows = templateLines.map((l) => ({
      restaurant_id: storeId,
      employee_id: l.employee_id ?? null,
      date: days[l.day_of_week] ?? days[0],
      start_time: l.start_time,
      end_time: l.end_time,
      unpaid_break_minutes: l.unpaid_break_minutes,
      break_start: null,
      position_id: l.position_id,
      note: l.note,
    }));
    try {
      await bulkInsert(rows);
      toast.success(`Generated ${rows.length} shifts from the template`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate from template");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header / toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarRange className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Rostering</h1>
            <p className="text-sm text-muted-foreground">{store?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} publishedAt={week?.published_at ?? null} />
          {issues.actionable > 0 && (
            <button
              onClick={() => setIssuesOpen(true)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium",
                issues.counts.error > 0
                  ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                  : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
              )}
              title="Rostering problems found this week"
            >
              {issues.counts.error > 0 ? (
                <ShieldAlert className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              {issues.actionable} issue{issues.actionable === 1 ? "" : "s"}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setOptionsOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <MoreVertical className="h-4 w-4" /> Options
            </button>
            {optionsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOptionsOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-60 rounded-lg border border-border bg-card p-1 shadow-lg">
                  <OptionItem
                    icon={TrendingUp}
                    onClick={() => {
                      setOptionsOpen(false);
                      handleBuildFromSales();
                    }}
                  >
                    Build from sales
                  </OptionItem>
                  <OptionItem
                    icon={Wand2}
                    onClick={() => {
                      setOptionsOpen(false);
                      handleAutoBuild();
                    }}
                  >
                    Auto-build (fill empty)
                  </OptionItem>
                  <OptionItem
                    icon={LineChart}
                    onClick={() => {
                      setOptionsOpen(false);
                      toggleForecast();
                    }}
                  >
                    {showForecast ? "Hide forecast graph" : "Show forecast graph"}
                  </OptionItem>
                  <OptionItem
                    icon={Copy}
                    onClick={() => {
                      setOptionsOpen(false);
                      handleCopyLastWeek();
                    }}
                  >
                    Copy last week
                  </OptionItem>
                  <div className="my-1 h-px bg-border" />
                  <OptionItem
                    icon={CalendarPlus}
                    onClick={() => {
                      setOptionsOpen(false);
                      handleGenerateTemplate();
                    }}
                  >
                    Generate template into this week
                  </OptionItem>
                  <OptionItem
                    icon={LayoutTemplate}
                    onClick={() => {
                      setOptionsOpen(false);
                      setTemplateOpen(true);
                    }}
                  >
                    Edit roster template…
                  </OptionItem>
                  <div className="my-1 h-px bg-border" />
                  <OptionItem
                    icon={CalendarRange}
                    onClick={() => {
                      setOptionsOpen(false);
                      setCopyOpen(true);
                    }}
                  >
                    Copy shifts to another week…
                  </OptionItem>
                  <OptionItem
                    icon={Printer}
                    onClick={() => {
                      setOptionsOpen(false);
                      handlePrint();
                    }}
                  >
                    Print schedule
                  </OptionItem>
                  <OptionItem
                    icon={Layers}
                    onClick={() => {
                      setOptionsOpen(false);
                      setEditAreasOpen(true);
                    }}
                  >
                    Edit areas &amp; sub-areas…
                  </OptionItem>
                  <div className="my-1 h-px bg-border" />
                  <OptionItem
                    icon={Trash2}
                    destructive
                    onClick={() => {
                      setOptionsOpen(false);
                      handleDeleteAll();
                    }}
                  >
                    {isDeletingAll ? "Deleting…" : "Delete all shifts"}
                  </OptionItem>
                </div>
              </>
            )}
          </div>
          <button
            onClick={handlePublish}
            disabled={isUpdating}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50",
              isPublished
                ? "border border-border text-foreground hover:bg-accent"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {isUpdating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPublished ? (
              <Undo2 className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isPublished ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      {/* Week nav + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftWeek(-1)} className={iconBtn}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[190px] text-center text-sm font-medium text-foreground">
            {weekLabel}
          </span>
          <button onClick={() => shiftWeek(1)} className={iconBtn}>
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekStart(toISODate(mondayOf(new Date())))}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            This week
          </button>
        </div>
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <ToggleBtn active={groupBy === "employee"} onClick={() => setGroupBy("employee")} icon={Users}>
              Staff
            </ToggleBtn>
            <ToggleBtn active={groupBy === "area"} onClick={() => setGroupBy("area")} icon={Layers}>
              Area
            </ToggleBtn>
          </div>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <ToggleBtn active={view === "week"} onClick={() => setView("week")} icon={LayoutGrid}>
              Week
            </ToggleBtn>
            <ToggleBtn active={view === "day"} onClick={() => setView("day")} icon={Clock}>
              Day
            </ToggleBtn>
          </div>
          <button
            onClick={() => openAdd(days[view === "day" ? dayIndex : 0])}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Add shift
          </button>
        </div>
      </div>

      {/* Coverage strip */}
      {/* Insights — hidden by default on mobile, always shown on desktop */}
      <button
        onClick={() => setShowInsights((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground md:hidden"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", !showInsights && "-rotate-90")} />
        {showInsights ? "Hide insights" : "Show insights"}
      </button>

      <div className={cn("space-y-4", showInsights ? "block" : "hidden", "md:block")}>
        <AvailabilitySummary days={days} employees={visibleEmployees} dayStatusFor={dayStatusFor} />

        <ProjectedSalesPanel
          days={days}
          detailByDate={detailByDate}
          refWeekLabel={refWeekLabel}
          openHour={staffingConfig?.open_hour ?? 10}
          closeHour={staffingConfig?.close_hour ?? 21}
          loading={projLoading}
        />

        <CoverageStrip coverage={coverage} totals={weekTotals} />
      </div>

      {(
        <TeamFilterBar
          search={search}
          setSearch={setSearch}
          stationFilter={stationFilter}
          setStationFilter={setStationFilter}
          hideEmpty={hideEmpty}
          setHideEmpty={setHideEmpty}
          areaLayout={areaLayout}
          shown={visibleEmployees.length}
          total={employees.length}
          onClear={() => {
            setSearch("");
            setStationFilter("");
            setHideEmpty(false);
          }}
          filtersActive={filtersActive}
        />
      )}

      <div className="hidden md:block">
      {view === "week" ? (
        <div className="space-y-3">
        {showForecast && forecastFor("week")}
        {groupBy === "employee" ? (
          <WeekGrid
            days={days}
            shifts={shifts}
            employees={visibleEmployees}
            posById={posById}
            conflictFor={conflictFor}
            dayStatusFor={dayStatusFor}
            onCellAdd={openAdd}
            onEdit={openEdit}
            hoursByEmployee={hoursByEmployee}
            otherHoursByEmployee={issues.otherHoursByEmployee}
            issuesByShift={issues.byShift}
            issuesByEmployee={issues.byEmployee}
            weeklyOrdinary={issues.options.weeklyHours}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={toggleSort}
            dragShift={dragShift}
            onDragStart={setDragShift}
            onDragEnd={() => setDragShift(null)}
            onDrop={handleCellDrop}
            filtersActive={filtersActive}
          />
        ) : (
          <WeekByArea
            days={days}
            shifts={shifts}
            areaLayout={areaLayout}
            posById={posById}
            employees={visibleEmployees}
            collapsed={collapsed}
            toggleCollapse={toggleCollapse}
            onCellAdd={openAddAreaCell}
            onEdit={openEdit}
            conflictFor={conflictFor}
            dayStatusFor={dayStatusFor}
            hoursByEmployee={hoursByEmployee}
            otherHoursByEmployee={issues.otherHoursByEmployee}
            issuesByShift={issues.byShift}
            issuesByEmployee={issues.byEmployee}
            weeklyOrdinary={issues.options.weeklyHours}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={toggleSort}
            dragShift={dragShift}
            onDragStart={setDragShift}
            onDragEnd={() => setDragShift(null)}
            onDrop={handleCellDrop}
            filtersActive={filtersActive}
          />
        )}
        </div>
      ) : (
        <div className="space-y-3">
        {showForecast && forecastFor("day")}
        <DayTimeline
          date={days[dayIndex]}
          dayIndex={dayIndex}
          setDayIndex={setDayIndex}
          shifts={shifts.filter((s) => s.date === days[dayIndex])}
          groupBy={groupBy}
          employees={visibleEmployees}
          empById={empById}
          positions={activePositions}
          areaLayout={areaLayout}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          onEdit={openEdit}
          onSaveBreak={saveBreak}
          onMoveShift={saveMove}
          onDragCreate={openAddRange}
          onAdd={() => openAdd(days[dayIndex])}
        />
        </div>
      )}
      </div>

      {showForecast && <div className="md:hidden">{forecastFor("day")}</div>}

      <MobileRoster
        days={days}
        dayIndex={dayIndex}
        setDayIndex={setDayIndex}
        shifts={shifts}
        employees={visibleEmployees}
        posById={posById}
        conflictFor={conflictFor}
        coverage={coverage}
        onAdd={openAdd}
        onEdit={openEdit}
      />

      {modal && (
        <ShiftModal
          restaurantId={storeId}
          weekDays={days}
          employees={employees}
          positions={activePositions}
          draft={modal}
          conflictFor={conflictFor}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={remove}
          isSaving={isSaving}
        />
      )}

      {copyOpen && (
        <CopyShiftsDialog
          areas={activePositions.filter((p) => !p.parent_id)}
          hasUnassigned={shifts.some((s) => !s.position_id)}
          weekStart={weekStart}
          onClose={() => setCopyOpen(false)}
          onCopy={handleCopyToWeek}
          isCopying={isGenerating}
        />
      )}

      {editAreasOpen && (
        <EditAreasModal restaurantId={storeId ?? undefined} onClose={() => setEditAreasOpen(false)} />
      )}

      {issuesOpen && (
        <IssuesPanel
          issues={issues.issues}
          counts={issues.counts}
          onOpenIssue={openIssue}
          onClose={() => setIssuesOpen(false)}
        />
      )}

      {templateOpen && storeId && (
        <TemplateEditor restaurantId={storeId} onClose={() => setTemplateOpen(false)} />
      )}
    </div>
  );
}

// ── Options menu item ────────────────────────────────────────────────────────
function OptionItem({
  icon: Icon,
  children,
  onClick,
  destructive,
}: {
  icon: typeof Copy;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium hover:bg-accent",
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </button>
  );
}

// ── Copy-to-another-week dialog ───────────────────────────────────────────────
function CopyShiftsDialog({
  areas,
  hasUnassigned,
  weekStart,
  onClose,
  onCopy,
  isCopying,
}: {
  areas: Position[];
  hasUnassigned: boolean;
  weekStart: string;
  onClose: () => void;
  onCopy: (
    targetWeekISO: string,
    opts: { areaIds: string[]; includeUnassigned: boolean; includeNames: boolean }
  ) => void;
  isCopying: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(areas.map((a) => a.id)));
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [includeNames, setIncludeNames] = useState(true);
  const [target, setTarget] = useState(() => toISODate(addDays(parseISO(weekStart), 7)));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const targetLabel = `${format(parseISO(target), "d MMM")} – ${format(
    addDays(parseISO(target), 6),
    "d MMM yyyy"
  )}`;
  const shiftTarget = (delta: number) =>
    setTarget((t) => toISODate(addDays(parseISO(t), delta * 7)));

  const nothingSelected = selected.size === 0 && !(hasUnassigned && includeUnassigned);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Copy shifts to another week</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Copy to week</label>
            <div className="flex items-center gap-2">
              <button onClick={() => shiftTarget(-1)} className={iconBtn}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[190px] flex-1 text-center text-sm font-medium text-foreground">
                {targetLabel}
              </span>
              <button onClick={() => shiftTarget(1)} className={iconBtn}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Areas to copy</label>
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              {areas.length === 0 && !hasUnassigned && (
                <p className="text-sm text-muted-foreground">No areas to copy.</p>
              )}
              {areas.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                    className="rounded border-input"
                  />
                  {a.name}
                </label>
              ))}
              {hasUnassigned && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={includeUnassigned}
                    onChange={(e) => setIncludeUnassigned(e.target.checked)}
                    className="rounded border-input"
                  />
                  Unassigned (no area)
                </label>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={includeNames}
              onChange={(e) => setIncludeNames(e.target.checked)}
              className="rounded border-input"
            />
            Keep people assigned (uncheck to copy as open shifts)
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                onCopy(target, {
                  areaIds: [...selected],
                  includeUnassigned,
                  includeNames,
                })
              }
              disabled={isCopying || nothingSelected}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isCopying && <Loader2 className="h-4 w-4 animate-spin" />}
              Copy shifts
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit areas modal (wraps the Positions settings editor) ────────────────────
function EditAreasModal({
  restaurantId,
  onClose,
}: {
  restaurantId?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-8">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 mx-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Edit areas &amp; sub-areas</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <PositionsSettings restaurantId={restaurantId} />
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Print-friendly schedule ───────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printRoster({
  storeName,
  weekLabel,
  days,
  employees,
  shifts,
  posById,
}: {
  storeName: string;
  weekLabel: string;
  days: string[];
  employees: Profile[];
  shifts: Shift[];
  posById: Map<string, Position>;
}) {
  const cellHtml = (list: Shift[]) =>
    list.length
      ? list
          .map((s) => {
            const pos = s.position_id ? posById.get(s.position_id)?.name : null;
            return `<div>${formatTime(s.start_time)}–${formatTime(s.end_time)}${
              pos ? ` <span class="pos">${escapeHtml(pos)}</span>` : ""
            }</div>`;
          })
          .join("")
      : "—";

  const headCells = days
    .map((d, i) => `<th>${DAY_LABELS[i]} ${format(parseISO(d), "d/M")}</th>`)
    .join("");

  const empRows = employees
    .filter((e) => shifts.some((s) => s.employee_id === e.id))
    .map((e) => {
      const cells = days
        .map((d) => `<td>${cellHtml(shifts.filter((s) => s.employee_id === e.id && s.date === d))}</td>`)
        .join("");
      return `<tr><td class="name">${escapeHtml(e.full_name)}</td>${cells}</tr>`;
    })
    .join("");

  const openRow = shifts.some((s) => !s.employee_id)
    ? `<tr><td class="name">Open shifts</td>${days
        .map((d) => `<td>${cellHtml(shifts.filter((s) => !s.employee_id && s.date === d))}</td>`)
        .join("")}</tr>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Roster ${escapeHtml(
    weekLabel
  )}</title><style>
    *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
    body{margin:16px;color:#111}
    h1{font-size:18px;margin:0 0 2px}
    .sub{color:#555;font-size:12px;margin:0 0 12px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border:1px solid #ccc;padding:4px 6px;vertical-align:top;text-align:left}
    th{background:#f3f3f3}
    td.name,th:first-child{white-space:nowrap;font-weight:bold;background:#fafafa}
    td div{padding:1px 0}
    .pos{color:#666;font-size:9px}
    @media print{body{margin:0}}
  </style></head><body>
    <h1>${escapeHtml(storeName)} — Roster</h1>
    <p class="sub">${escapeHtml(weekLabel)}</p>
    <table><thead><tr><th>Team member</th>${headCells}</tr></thead><tbody>${empRows}${openRow ||
    (empRows ? "" : '<tr><td colspan="8">No shifts rostered.</td></tr>')}</tbody></table>
    <script>window.onload=function(){window.focus();window.print();}</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) {
    alert("Please allow pop-ups to print the schedule.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ── Coverage strip ─────────────────────────────────────────────────────────────
interface DayMetrics {
  date: string;
  rostered: number;
  required: number;
  projSales: number | null;
  actSales: number | null;
  projLabour: number;
  actLabour: number | null;
  projCost: number;
  projSpmh: number | null;
  actSpmh: number | null;
}

interface WeekMetrics {
  projSales: number;
  actSales: number;
  projLabour: number;
  actLabour: number;
  projCost: number;
  projSpmh: number | null;
  actSpmh: number | null;
}

const money = (v: number | null) => (v == null ? "–" : formatCurrency(v));
const hrs = (v: number | null) => (v == null ? "–" : `${v.toFixed(1)}h`);
const spmh = (v: number | null) => (v == null ? "–" : `$${Math.round(v)}`);
const wagePct = (cost: number, sales: number | null) =>
  sales && sales > 0 ? `${((cost / sales) * 100).toFixed(1)}%` : "–";

function MetricRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums text-[11px]", strong ? "font-semibold text-foreground" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function AvailabilitySummary({
  days,
  employees,
  dayStatusFor,
}: {
  days: string[];
  employees: Profile[];
  dayStatusFor: DayStatusFn;
}) {
  const [open, setOpen] = useState(false);

  const perDay = days.map((d) => ({
    date: d,
    entries: employees
      .map((e) => ({ e, status: dayStatusFor(e.id, d) }))
      .filter((x): x is { e: Profile; status: NonNullable<DayStatus> } => x.status != null),
  }));
  const total = perDay.reduce((n, p) => n + p.entries.length, 0);

  const label = (s: NonNullable<DayStatus>) =>
    s.kind === "leave"
      ? "leave"
      : s.kind === "unavailable"
      ? "unavailable"
      : `${formatTime(s.start)}–${formatTime(s.end)}`;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
          Unavailability &amp; leave this week
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            total > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"
          )}
        >
          {total > 0 ? `${total} flagged` : "all clear"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone is available this week.</p>
          ) : (
            perDay
              .filter((p) => p.entries.length > 0)
              .map((p) => (
                <div key={p.date} className="flex flex-wrap items-start gap-2">
                  <span className="w-20 shrink-0 pt-0.5 text-xs font-semibold text-foreground">
                    {format(parseISO(p.date), "EEE d/M")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {p.entries.map(({ e, status }) => (
                      <span
                        key={e.id}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          status.kind === "partial"
                            ? "bg-warning/15 text-warning"
                            : "bg-destructive/15 text-destructive"
                        )}
                      >
                        {e.full_name}: {label(status)}
                      </span>
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}

function projHourLabel(h: number): string {
  const p = h < 12 ? "a" : "p";
  const t = h % 12 === 0 ? 12 : h % 12;
  return `${t}${p}`;
}

function ProjectedSalesPanel({
  days,
  detailByDate,
  refWeekLabel,
  openHour,
  closeHour,
  loading,
}: {
  days: string[];
  detailByDate: Map<string, DayProjection>;
  refWeekLabel: string;
  openHour: number;
  closeHour: number;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const weekTotal = days.reduce((s, d) => s + (detailByDate.get(d)?.total ?? 0), 0);
  const hours: number[] = [];
  for (let h = openHour; h < closeHour; h++) hours.push(h);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
          Projected sales (your projection × the last 2 weeks' average hourly split)
        </span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {formatCurrency(weekTotal)} / wk
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            shape: 2-wk avg to w/c {refWeekLabel}
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          {loading ? (
            <div className="py-6 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">Day</th>
                    {hours.map((h) => (
                      <th key={h} className="px-1 py-1 text-right font-medium">{projHourLabel(h)}</th>
                    ))}
                    <th className="px-2 py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const det = detailByDate.get(d);
                    return (
                      <tr key={d} className="border-t border-border/50">
                        <td className="whitespace-nowrap px-2 py-1 font-medium text-foreground">
                          {format(parseISO(d), "EEE d/M")}
                        </td>
                        {hours.map((h) => {
                          const v = det?.hours[h] ?? 0;
                          return (
                            <td
                              key={h}
                              className={cn(
                                "px-1 py-1 text-right tabular-nums",
                                v > 0 ? "text-foreground" : "text-muted-foreground/40"
                              )}
                            >
                              {v > 0 ? `$${Math.round(v)}` : "–"}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1 text-right tabular-nums font-semibold text-foreground">
                          {det && det.hasProjection ? (
                            <span>
                              {formatCurrency(det.total)}
                              {det.evenSpread ? (
                                <span className="ml-1 text-[10px] font-normal text-warning">even</span>
                              ) : det.estimated ? (
                                <span className="ml-1 text-[10px] font-normal text-warning">est</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-warning">no projection</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Day total comes from Projections; hours are shaped from the average of the
            two most recent same-weekdays' sales splits — last week and the week before
            (most recent week commencing {refWeekLabel}). “no projection”
            = nothing entered in Projections for that day, so Build from sales skips it.
            “est” = no history for that weekday, shaped from the week's average curve;
            “even” = no hourly history at all, spread evenly.
          </p>
        </div>
      )}
    </div>
  );
}

function CoverageStrip({
  coverage,
  totals,
}: {
  coverage: DayMetrics[];
  totals: WeekMetrics;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {coverage.map((c, i) => {
        const colour = varianceColor(c.rostered, c.required);
        const pct = c.required > 0 ? Math.min(c.rostered / c.required, 1) : 0;
        return (
          <div key={c.date} className="rounded-lg border border-border bg-card p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {DAY_LABELS[i]} {format(parseISO(c.date), "d/M")}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct * 100}%`, backgroundColor: colour }}
              />
            </div>
            <MetricRow label="Proj sales" value={money(c.projSales)} />
            <MetricRow label="Act sales" value={money(c.actSales)} />
            <MetricRow label="Proj lab" value={hrs(c.projLabour)} />
            <MetricRow label="Act lab" value={hrs(c.actLabour)} />
            <MetricRow label="Proj cost" value={money(c.projCost)} />
            <MetricRow label="Wage %" value={wagePct(c.projCost, c.projSales)} />
            <MetricRow label="Proj SPMH" value={spmh(c.projSpmh)} />
            <MetricRow label="Act SPMH" value={spmh(c.actSpmh)} />
          </div>
        );
      })}

      {/* Weekly totals card next to Sunday */}
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-2 space-y-1">
        <div className="text-xs font-semibold text-primary">Week total</div>
        <div className="h-1 w-full" />
        <MetricRow label="Proj sales" value={money(totals.projSales)} strong />
        <MetricRow label="Act sales" value={money(totals.actSales)} strong />
        <MetricRow label="Proj lab" value={hrs(totals.projLabour)} strong />
        <MetricRow label="Act lab" value={hrs(totals.actLabour)} strong />
        <MetricRow label="Proj cost" value={money(totals.projCost)} strong />
        <MetricRow label="Wage %" value={wagePct(totals.projCost, totals.projSales)} strong />
        <MetricRow label="Proj SPMH" value={spmh(totals.projSpmh)} strong />
        <MetricRow label="Act SPMH" value={spmh(totals.actSpmh)} strong />
      </div>
    </div>
  );
}

// ── Week grid ───────────────────────────────────────────────────────────────────

// Sticky-column widths. Two columns pin to the left, so their offsets have to
// be explicit — `left: NAME_W` for the hours column only lines up if the name
// column really is NAME_W wide.
const NAME_W = 208;
const HRS_W = 92;

function SortHeader({
  label,
  active,
  dir,
  align = "left",
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  align?: "left" | "right";
  onClick: () => void;
}) {
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex w-full items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
        align === "right" && "justify-end"
      )}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      <Arrow className={cn("h-3 w-3", active ? "opacity-100" : "opacity-0")} />
    </button>
  );
}

/** The red / amber / blue triangle shown against a person or a shift. */
function IssueIcon({
  issues,
  className,
}: {
  issues: RosterIssue[] | undefined;
  className?: string;
}) {
  const severity = worstSeverity(issues);
  if (!severity || !issues) return null;
  const Icon = severity === "error" ? ShieldAlert : severity === "warning" ? AlertTriangle : Info;
  return (
    <Icon
      className={cn(
        "h-3.5 w-3.5 shrink-0",
        severity === "error"
          ? "text-destructive"
          : severity === "warning"
          ? "text-warning"
          : "text-blue-500",
        className
      )}
      aria-label={`${issues.length} issue${issues.length === 1 ? "" : "s"}`}
    />
  );
}

/** One tooltip line per issue — what the manager sees on hover. */
function issueTitle(issues: RosterIssue[] | undefined): string | undefined {
  if (!issues?.length) return undefined;
  return issues.map((i) => `${ISSUE_LABELS[i.code]}: ${i.message}`).join("\n");
}

export interface CellTarget {
  date: string;
  employee_id?: string | null;
  position_id?: string | null;
}

function WeekGrid({
  days,
  shifts,
  employees,
  posById,
  conflictFor,
  dayStatusFor,
  onCellAdd,
  onEdit,
  hoursByEmployee,
  otherHoursByEmployee,
  issuesByShift,
  issuesByEmployee,
  weeklyOrdinary,
  sortBy,
  sortDir,
  onSort,
  dragShift,
  onDragStart,
  onDragEnd,
  onDrop,
  filtersActive,
}: {
  days: string[];
  shifts: Shift[];
  employees: Profile[];
  posById: Map<string, Position>;
  conflictFor: ConflictFn;
  dayStatusFor: DayStatusFn;
  onCellAdd: (date: string, employeeId: string) => void;
  onEdit: (s: Shift) => void;
  hoursByEmployee: Map<string, number>;
  otherHoursByEmployee: Map<string, number>;
  issuesByShift: Map<string, RosterIssue[]>;
  issuesByEmployee: Map<string, RosterIssue[]>;
  weeklyOrdinary: number;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  dragShift: Shift | null;
  onDragStart: (s: Shift) => void;
  onDragEnd: () => void;
  onDrop: (s: Shift, target: CellTarget, copy: boolean) => void;
  filtersActive: boolean;
}) {
  const [overKey, setOverKey] = useState<string | null>(null);

  if (employees.length === 0) {
    return filtersActive ? (
      <EmptyState
        icon={Search}
        title="Nobody matches these filters"
        body="Clear the search, station or hours filters to see the rest of the team."
      />
    ) : (
      <EmptyState
        icon={Users}
        title="No team members yet"
        body="Flag people as rosterable in Settings → Team to see them here."
      />
    );
  }

  // Shared drop plumbing for every cell in the grid.
  const dropProps = (key: string, target: CellTarget) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragShift) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
      if (overKey !== key) setOverKey(key);
    },
    onDragLeave: () => setOverKey((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      if (!dragShift) return;
      e.preventDefault();
      setOverKey(null);
      onDrop(dragShift, target, e.altKey);
    },
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th
              className="sticky z-20 bg-muted/30 px-3 py-2 text-left"
              style={{ left: 0, width: NAME_W, minWidth: NAME_W }}
            >
              <SortHeader
                label="Team member"
                active={sortBy === "name"}
                dir={sortDir}
                onClick={() => onSort("name")}
              />
            </th>
            <th
              className="sticky z-20 border-r border-border bg-muted/30 px-2 py-2 text-right"
              style={{ left: NAME_W, width: HRS_W, minWidth: HRS_W }}
            >
              <SortHeader
                label="Wkly hrs"
                align="right"
                active={sortBy === "hours"}
                dir={sortDir}
                onClick={() => onSort("hours")}
              />
            </th>
            {days.map((d, i) => (
              <th
                key={d}
                className="min-w-[130px] px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {DAY_LABELS[i]} {format(parseISO(d), "d/M")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {employees.map((emp) => {
            const empHours = hoursByEmployee.get(emp.id) ?? 0;
            const otherHours = otherHoursByEmployee.get(emp.id) ?? 0;
            const combined = empHours + otherHours;
            const band = weeklyHoursBand(combined, emp, weeklyOrdinary);
            const colour = hoursBandColor(band);
            const ceiling = hoursCeiling(emp, weeklyOrdinary);
            const contracted =
              emp.employment_type !== "casual" && (emp.contracted_hours ?? 0) > 0;
            const empIssues = issuesByEmployee.get(emp.id);
            return (
              <tr key={emp.id} className="hover:bg-muted/10">
                <td
                  className="sticky z-10 bg-card px-3 py-2"
                  style={{ left: 0, width: NAME_W, minWidth: NAME_W }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: emp.display_colour ?? "#94a3b8" }}
                    />
                    <div className="min-w-0 leading-tight">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-sm font-medium text-foreground">
                          {emp.full_name}
                        </span>
                        <span title={issueTitle(empIssues)}>
                          <IssueIcon issues={empIssues} />
                        </span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {employmentLabel(emp)}
                      </div>
                    </div>
                  </div>
                </td>
                <td
                  className={cn(
                    "sticky z-10 border-r border-border px-2 py-2 text-right align-middle",
                    band === "over" ? "" : "bg-card"
                  )}
                  style={{
                    left: NAME_W,
                    width: HRS_W,
                    minWidth: HRS_W,
                    backgroundColor: band === "over" ? colour : undefined,
                  }}
                  title={hoursBandTitle(band, combined, emp, weeklyOrdinary)}
                >
                  <div
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: band === "over" ? "#fff" : colour }}
                  >
                    {empHours > 0 || otherHours > 0 ? empHours.toFixed(2) : "—"}
                  </div>
                  {otherHours > 0 ? (
                    <div
                      className="text-[10px] tabular-nums"
                      style={{ color: band === "over" ? "#fff" : undefined }}
                    >
                      +{otherHours.toFixed(2)} elsewhere
                    </div>
                  ) : contracted ? (
                    <div
                      className={cn(
                        "text-[10px] tabular-nums",
                        band === "over" ? "" : "text-muted-foreground"
                      )}
                      style={{ color: band === "over" ? "#fff" : undefined }}
                    >
                      of {ceiling}
                    </div>
                  ) : null}
                </td>
                {days.map((d) => {
                  const cell = shifts.filter(
                    (s) => s.employee_id === emp.id && s.date === d
                  );
                  const status = dayStatusFor(emp.id, d);
                  const key = `${emp.id}|${d}`;
                  return (
                    <td
                      key={d}
                      {...dropProps(key, { date: d, employee_id: emp.id })}
                      className={cn(
                        "px-1.5 py-1.5 align-top transition-colors",
                        (status?.kind === "unavailable" || status?.kind === "leave") &&
                          "bg-destructive/[0.06]",
                        overKey === key && "bg-primary/10 ring-2 ring-inset ring-primary/60"
                      )}
                    >
                      <div className="space-y-1">
                        {status?.kind === "leave" && (
                          <div className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                            On leave
                          </div>
                        )}
                        {status?.kind === "unavailable" && (
                          <div className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                            Unavailable
                          </div>
                        )}
                        {status?.kind === "partial" && (
                          <div className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                            Avail {formatTime(status.start)}–{formatTime(status.end)}
                          </div>
                        )}
                        {cell.map((s) => (
                          <ShiftChip
                            key={s.id}
                            shift={s}
                            posById={posById}
                            conflict={conflictFor(
                              s.employee_id,
                              s.date,
                              s.start_time,
                              s.end_time
                            )}
                            issues={issuesByShift.get(s.id)}
                            dragging={dragShift?.id === s.id}
                            onDragStart={() => onDragStart(s)}
                            onDragEnd={onDragEnd}
                            onClick={() => onEdit(s)}
                          />
                        ))}
                        <button
                          onClick={() => onCellAdd(d, emp.id)}
                          className="w-full rounded-md border border-dashed border-border/60 py-1 text-xs text-muted-foreground/60 opacity-0 hover:opacity-100 hover:text-foreground transition-opacity"
                        >
                          + add
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {shifts.some((s) => !s.employee_id) && (
            <tr className="hover:bg-muted/10">
              <td
                className="sticky z-10 bg-card px-3 py-2"
                style={{ left: 0, width: NAME_W, minWidth: NAME_W }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground/60" />
                  <div className="text-sm font-medium text-muted-foreground">Open shifts</div>
                </div>
              </td>
              <td
                className="sticky z-10 border-r border-border bg-card px-2 py-2 text-right text-sm tabular-nums text-muted-foreground"
                style={{ left: NAME_W, width: HRS_W, minWidth: HRS_W }}
              >
                {shifts
                  .filter((s) => !s.employee_id)
                  .reduce(
                    (sum, s) =>
                      sum + shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes),
                    0
                  )
                  .toFixed(2)}
              </td>
              {days.map((d) => {
                const cell = shifts.filter((s) => !s.employee_id && s.date === d);
                const key = `open|${d}`;
                return (
                  <td
                    key={d}
                    {...dropProps(key, { date: d, employee_id: null })}
                    className={cn(
                      "px-1.5 py-1.5 align-top transition-colors",
                      overKey === key && "bg-primary/10 ring-2 ring-inset ring-primary/60"
                    )}
                  >
                    <div className="space-y-1">
                      {cell.map((s) => (
                        <ShiftChip
                          key={s.id}
                          shift={s}
                          posById={posById}
                          issues={issuesByShift.get(s.id)}
                          dragging={dragShift?.id === s.id}
                          onDragStart={() => onDragStart(s)}
                          onDragEnd={onDragEnd}
                          onClick={() => onEdit(s)}
                        />
                      ))}
                      <button
                        onClick={() => onCellAdd(d, "")}
                        className="w-full rounded-md border border-dashed border-border/60 py-1 text-xs text-muted-foreground/60 opacity-0 hover:opacity-100 hover:text-foreground transition-opacity"
                      >
                        + add
                      </button>
                    </div>
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** "Casual" / "Part-time 20 h" / "Full-time" under the person's name. */
function employmentLabel(emp: Profile): string {
  const h = emp.contracted_hours ?? 0;
  switch (emp.employment_type) {
    case "part_time":
      return h > 0 ? `Part-time · ${h} h` : "Part-time";
    case "full_time":
      return "Full-time";
    case "casual":
      return "Casual";
    default:
      return "—";
  }
}

// ── Week grid grouped by Area → team member ────────────────────────────────────
// Same two sticky columns as the Staff view (name + weekly hours, both
// sortable), but the rows are nested under each area — so you can read a
// station's coverage without losing sight of who is on and how full their week
// already is.
function WeekByArea({
  days,
  shifts,
  areaLayout,
  posById,
  employees,
  collapsed,
  toggleCollapse,
  onCellAdd,
  onEdit,
  conflictFor,
  dayStatusFor,
  hoursByEmployee,
  otherHoursByEmployee,
  issuesByShift,
  issuesByEmployee,
  weeklyOrdinary,
  sortBy,
  sortDir,
  onSort,
  dragShift,
  onDragStart,
  onDragEnd,
  onDrop,
  filtersActive,
}: {
  days: string[];
  shifts: Shift[];
  areaLayout: AreaLayout;
  posById: Map<string, Position>;
  employees: Profile[];
  collapsed: Set<string>;
  toggleCollapse: (key: string) => void;
  onCellAdd: (date: string, positionId: string | null, employeeId: string) => void;
  onEdit: (s: Shift) => void;
  conflictFor: ConflictFn;
  dayStatusFor: DayStatusFn;
  hoursByEmployee: Map<string, number>;
  otherHoursByEmployee: Map<string, number>;
  issuesByShift: Map<string, RosterIssue[]>;
  issuesByEmployee: Map<string, RosterIssue[]>;
  weeklyOrdinary: number;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  dragShift: Shift | null;
  onDragStart: (s: Shift) => void;
  onDragEnd: () => void;
  onDrop: (s: Shift, target: CellTarget, copy: boolean) => void;
  filtersActive: boolean;
}) {
  const [overKey, setOverKey] = useState<string | null>(null);
  const hasUnassigned = shifts.some((s) => !s.position_id);

  if (areaLayout.length === 0 && !hasUnassigned) {
    return (
      <EmptyState
        icon={Layers}
        title="No areas yet"
        body="Add areas and sub-areas in Settings → Positions to group the roster this way."
      />
    );
  }

  // An area owns its own shifts plus every sub-area's. `scope: null` is the
  // catch-all group for shifts with no position at all.
  const groups: {
    key: string;
    name: string;
    colour: string;
    positionId: string | null;
    scope: Set<string> | null;
  }[] = areaLayout.map(({ area, subs }) => ({
    key: area.id,
    name: area.name,
    colour: effectiveColour(area.id, posById),
    positionId: area.id,
    scope: new Set([area.id, ...subs.map((sub) => sub.id)]),
  }));
  if (hasUnassigned) {
    groups.push({
      key: "__none__",
      name: "Unassigned",
      colour: "#94a3b8",
      positionId: null,
      scope: null,
    });
  }

  const inGroup = (s: Shift, scope: Set<string> | null) =>
    scope ? !!s.position_id && scope.has(s.position_id) : !s.position_id;

  const hoursOf = (list: Shift[]) =>
    list.reduce(
      (sum, s) => sum + shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes),
      0
    );

  // Dropping into an area keeps a shift's sub-area when it already belongs to
  // that area — moving Nick from Tue to Wed inside Kitchen shouldn't silently
  // demote his shift from "Fryers" to plain "Kitchen".
  const dropTarget = (
    shift: Shift,
    scope: Set<string> | null,
    positionId: string | null,
    date: string,
    employeeId: string | null
  ): CellTarget => {
    const keepsPosition = inGroup(shift, scope);
    return {
      date,
      employee_id: employeeId,
      ...(keepsPosition ? {} : { position_id: positionId }),
    };
  };

  const dropProps = (key: string, target: () => CellTarget) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragShift) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
      if (overKey !== key) setOverKey(key);
    },
    onDragLeave: () => setOverKey((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      if (!dragShift) return;
      e.preventDefault();
      setOverKey(null);
      onDrop(dragShift, target(), e.altKey);
    },
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th
              className="sticky z-20 bg-muted/30 px-3 py-2 text-left"
              style={{ left: 0, width: NAME_W, minWidth: NAME_W }}
            >
              <SortHeader
                label="Area / team member"
                active={sortBy === "name"}
                dir={sortDir}
                onClick={() => onSort("name")}
              />
            </th>
            <th
              className="sticky z-20 border-r border-border bg-muted/30 px-2 py-2 text-right"
              style={{ left: NAME_W, width: HRS_W, minWidth: HRS_W }}
            >
              <SortHeader
                label="Wkly hrs"
                align="right"
                active={sortBy === "hours"}
                dir={sortDir}
                onClick={() => onSort("hours")}
              />
            </th>
            {days.map((d, i) => (
              <th
                key={d}
                className="min-w-[130px] px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {DAY_LABELS[i]} {format(parseISO(d), "d/M")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map((g) => {
            const groupShifts = shifts.filter((s) => inGroup(s, g.scope));
            const isCollapsed = collapsed.has(g.key);
            // Parent order is already the chosen sort, so filtering preserves it.
            const groupEmployees = employees.filter((emp) =>
              groupShifts.some((s) => s.employee_id === emp.id)
            );
            const hiddenPeople =
              new Set(groupShifts.filter((s) => s.employee_id).map((s) => s.employee_id)).size -
              groupEmployees.length;

            return (
              <Fragment key={g.key}>
                <tr className="bg-muted/20">
                  <td
                    className="sticky z-10 bg-muted/20 px-2 py-1.5"
                    style={{ left: 0, width: NAME_W, minWidth: NAME_W }}
                  >
                    <button
                      onClick={() => toggleCollapse(g.key)}
                      className="flex items-center gap-2 text-sm font-semibold text-foreground"
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: g.colour }}
                      />
                      {g.name}
                    </button>
                  </td>
                  <td
                    className="sticky z-10 border-r border-border bg-muted/20 px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-foreground"
                    style={{ left: NAME_W, width: HRS_W, minWidth: HRS_W }}
                    title={`Hours rostered in ${g.name} this week`}
                  >
                    {hoursOf(groupShifts).toFixed(2)}
                  </td>
                  <td colSpan={days.length} className="px-2 py-1.5 text-xs text-muted-foreground">
                    {groupEmployees.length}{" "}
                    {groupEmployees.length === 1 ? "person" : "people"}
                    {hiddenPeople > 0 && ` · ${hiddenPeople} hidden by filters`}
                  </td>
                </tr>

                {!isCollapsed && (
                  <>
                    {groupEmployees.map((emp) => {
                      const areaHours = hoursOf(
                        groupShifts.filter((s) => s.employee_id === emp.id)
                      );
                      const weekHours = hoursByEmployee.get(emp.id) ?? 0;
                      const otherHours = otherHoursByEmployee.get(emp.id) ?? 0;
                      const band = weeklyHoursBand(weekHours + otherHours, emp, weeklyOrdinary);
                      const colour = hoursBandColor(band);
                      const empIssues = issuesByEmployee.get(emp.id);
                      return (
                        <tr key={`${g.key}:${emp.id}`} className="hover:bg-muted/10">
                          <td
                            className="sticky z-10 bg-card px-3 py-2"
                            style={{ left: 0, width: NAME_W, minWidth: NAME_W }}
                          >
                            <div className="flex items-center gap-2 pl-5">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: emp.display_colour ?? "#94a3b8" }}
                              />
                              <div className="min-w-0 leading-tight">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {emp.full_name}
                                  </span>
                                  <span title={issueTitle(empIssues)}>
                                    <IssueIcon issues={empIssues} />
                                  </span>
                                </div>
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {employmentLabel(emp)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td
                            className={cn(
                              "sticky z-10 border-r border-border px-2 py-2 text-right align-middle",
                              band === "over" ? "" : "bg-card"
                            )}
                            style={{
                              left: NAME_W,
                              width: HRS_W,
                              minWidth: HRS_W,
                              backgroundColor: band === "over" ? colour : undefined,
                            }}
                            title={`${hoursBandTitle(
                              band,
                              weekHours + otherHours,
                              emp,
                              weeklyOrdinary
                            )} · ${areaHours.toFixed(2)} h in ${g.name}`}
                          >
                            <div
                              className="text-sm font-semibold tabular-nums"
                              style={{ color: band === "over" ? "#fff" : colour }}
                            >
                              {weekHours.toFixed(2)}
                            </div>
                            {Math.abs(areaHours - weekHours) > 0.005 && (
                              <div
                                className={cn(
                                  "text-[10px] tabular-nums",
                                  band === "over" ? "" : "text-muted-foreground"
                                )}
                                style={{ color: band === "over" ? "#fff" : undefined }}
                              >
                                {areaHours.toFixed(2)} here
                              </div>
                            )}
                          </td>
                          {days.map((d) => {
                            const cell = groupShifts.filter(
                              (s) => s.employee_id === emp.id && s.date === d
                            );
                            const status = dayStatusFor(emp.id, d);
                            const key = `${g.key}|${emp.id}|${d}`;
                            return (
                              <td
                                key={d}
                                {...dropProps(key, () =>
                                  dropTarget(dragShift!, g.scope, g.positionId, d, emp.id)
                                )}
                                className={cn(
                                  "px-1.5 py-1.5 align-top transition-colors",
                                  (status?.kind === "unavailable" || status?.kind === "leave") &&
                                    "bg-destructive/[0.06]",
                                  overKey === key &&
                                    "bg-primary/10 ring-2 ring-inset ring-primary/60"
                                )}
                              >
                                <div className="space-y-1">
                                  {cell.map((s) => (
                                    <ShiftChip
                                      key={s.id}
                                      shift={s}
                                      posById={posById}
                                      conflict={conflictFor(
                                        s.employee_id,
                                        s.date,
                                        s.start_time,
                                        s.end_time
                                      )}
                                      issues={issuesByShift.get(s.id)}
                                      dragging={dragShift?.id === s.id}
                                      onDragStart={() => onDragStart(s)}
                                      onDragEnd={onDragEnd}
                                      onClick={() => onEdit(s)}
                                    />
                                  ))}
                                  <button
                                    onClick={() => onCellAdd(d, g.positionId, emp.id)}
                                    className="w-full rounded-md border border-dashed border-border/60 py-1 text-xs text-muted-foreground/60 opacity-0 hover:opacity-100 hover:text-foreground transition-opacity"
                                  >
                                    + add
                                  </button>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}

                    {/* Always present: where open shifts live, and how you add
                        one to this area on a given day. */}
                    <tr className="hover:bg-muted/10">
                      <td
                        className="sticky z-10 bg-card px-3 py-2"
                        style={{ left: 0, width: NAME_W, minWidth: NAME_W }}
                      >
                        <div className="flex items-center gap-2 pl-5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground/60" />
                          <span className="text-sm font-medium text-muted-foreground">
                            Open shifts
                          </span>
                        </div>
                      </td>
                      <td
                        className="sticky z-10 border-r border-border bg-card px-2 py-2 text-right text-sm tabular-nums text-muted-foreground"
                        style={{ left: NAME_W, width: HRS_W, minWidth: HRS_W }}
                      >
                        {hoursOf(groupShifts.filter((s) => !s.employee_id)).toFixed(2)}
                      </td>
                      {days.map((d) => {
                        const cell = groupShifts.filter((s) => !s.employee_id && s.date === d);
                        const key = `${g.key}|open|${d}`;
                        return (
                          <td
                            key={d}
                            {...dropProps(key, () =>
                              dropTarget(dragShift!, g.scope, g.positionId, d, null)
                            )}
                            className={cn(
                              "px-1.5 py-1.5 align-top transition-colors",
                              overKey === key && "bg-primary/10 ring-2 ring-inset ring-primary/60"
                            )}
                          >
                            <div className="space-y-1">
                              {cell.map((s) => (
                                <ShiftChip
                                  key={s.id}
                                  shift={s}
                                  posById={posById}
                                  issues={issuesByShift.get(s.id)}
                                  dragging={dragShift?.id === s.id}
                                  onDragStart={() => onDragStart(s)}
                                  onDragEnd={onDragEnd}
                                  onClick={() => onEdit(s)}
                                />
                              ))}
                              <button
                                onClick={() => onCellAdd(d, g.positionId, "")}
                                className="w-full rounded-md border border-dashed border-border/60 py-1 text-xs text-muted-foreground/60 opacity-0 hover:opacity-100 hover:text-foreground transition-opacity"
                              >
                                + add
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>

                    {groupEmployees.length === 0 &&
                      groupShifts.filter((s) => !s.employee_id).length === 0 && (
                        <tr>
                          <td
                            colSpan={days.length + 2}
                            className="px-3 py-2 text-xs text-muted-foreground"
                          >
                            {filtersActive
                              ? "Nobody in this area matches the current filters."
                              : `Nothing rostered in ${g.name} this week.`}
                          </td>
                        </tr>
                      )}
                  </>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShiftChip({
  shift,
  posById,
  conflict,
  issues,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  shift: Shift;
  posById: Map<string, Position>;
  conflict?: Conflict;
  issues?: RosterIssue[];
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onClick: () => void;
}) {
  const pos = shift.position_id ? posById.get(shift.position_id) : null;
  const colour = effectiveColour(shift.position_id, posById);
  const severity: IssueSeverity | null = conflict ? "error" : worstSeverity(issues);
  const conflictText =
    conflict === "leave"
      ? "On approved leave this day"
      : conflict === "unavailable"
      ? "Marked unavailable this day"
      : null;
  const title = [conflictText, issueTitle(issues), shift.note]
    .filter(Boolean)
    .join("\n");
  return (
    <button
      draggable={!!onDragStart}
      onDragStart={(e) => {
        // Firefox refuses to start a drag unless some data is set.
        e.dataTransfer.setData("text/plain", shift.id);
        e.dataTransfer.effectAllowed = "copyMove";
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "relative block w-full rounded-md px-2 py-1 text-left text-xs font-medium text-white hover:opacity-90",
        onDragStart && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        severity === "error" && "ring-2 ring-destructive",
        severity === "warning" && "ring-2 ring-warning"
      )}
      style={{ backgroundColor: colour }}
      title={title || undefined}
    >
      {conflict ? (
        <AlertTriangle className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-white text-destructive" />
      ) : (
        <IssueIcon issues={issues} className="absolute -right-1 -top-1 rounded-full bg-white" />
      )}
      {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
      {pos && <span className="block text-[10px] font-normal opacity-90">{pos.name}</span>}
    </button>
  );
}

// ── Mobile roster (day-by-day list, tap to edit) ───────────────────────────────
function MobileRoster({
  days,
  dayIndex,
  setDayIndex,
  shifts,
  employees,
  posById,
  conflictFor,
  coverage,
  onAdd,
  onEdit,
}: {
  days: string[];
  dayIndex: number;
  setDayIndex: (i: number) => void;
  shifts: Shift[];
  employees: Profile[];
  posById: Map<string, Position>;
  conflictFor: ConflictFn;
  coverage: DayMetrics[];
  onAdd: (date: string, employeeId?: string) => void;
  onEdit: (s: Shift) => void;
}) {
  const date = days[dayIndex];
  const cov = coverage[dayIndex];
  const dayShifts = shifts
    .filter((s) => s.date === date)
    .sort((a, b) => (a.start_time < b.start_time ? -1 : 1));
  const empsWith = employees.filter((e) => dayShifts.some((s) => s.employee_id === e.id));
  const open = dayShifts.filter((s) => !s.employee_id);

  const ShiftRow = (s: Shift) => {
    const pos = s.position_id ? posById.get(s.position_id) : null;
    const conflict = conflictFor(s.employee_id, s.date, s.start_time, s.end_time);
    return (
      <button
        key={s.id}
        onClick={() => onEdit(s)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left",
          conflict ? "border-destructive/50 bg-destructive/5" : "border-border bg-card"
        )}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: effectiveColour(s.position_id, posById) }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {formatTime(s.start_time)}–{formatTime(s.end_time)}
            {s.unpaid_break_minutes > 0 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                · {s.unpaid_break_minutes}m break
              </span>
            )}
          </div>
          {pos && <div className="truncate text-xs text-muted-foreground">{pos.name}</div>}
          {s.note && <div className="truncate text-xs text-muted-foreground/80">{s.note}</div>}
        </div>
        {conflict && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    );
  };

  return (
    <div className="space-y-3 md:hidden">
      {/* Day selector */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {days.map((d, i) => (
          <button
            key={d}
            onClick={() => setDayIndex(i)}
            className={cn(
              "flex min-w-[44px] shrink-0 flex-col items-center rounded-lg border px-2 py-1.5 text-xs",
              i === dayIndex
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-foreground"
            )}
          >
            <span className="font-medium">{DAY_LABELS[i]}</span>
            <span className="tabular-nums">{format(parseISO(d), "d/M")}</span>
          </button>
        ))}
      </div>

      {/* Day summary */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-sm font-semibold text-foreground">
          {format(parseISO(date), "EEEE d MMM")}
        </span>
        <span className="text-xs text-muted-foreground">
          Proj {money(cov?.projSales ?? null)} · {(cov?.rostered ?? 0).toFixed(1)}h
        </span>
      </div>

      <button
        onClick={() => onAdd(date)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" /> Add shift
      </button>

      {dayShifts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card py-8 text-center text-sm text-muted-foreground">
          No shifts on this day yet.
        </div>
      ) : (
        <div className="space-y-4">
          {empsWith.map((emp) => {
            const es = dayShifts.filter((s) => s.employee_id === emp.id);
            const h = es.reduce(
              (sum, s) => sum + shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes),
              0
            );
            return (
              <div key={emp.id} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: emp.display_colour ?? "#94a3b8" }}
                  />
                  <span className="text-sm font-semibold text-foreground">{emp.full_name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{h.toFixed(1)}h</span>
                  <button
                    onClick={() => onAdd(date, emp.id)}
                    className="ml-auto text-xs font-medium text-primary"
                  >
                    + add
                  </button>
                </div>
                {es.map(ShiftRow)}
              </div>
            );
          })}
          {open.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground/60" />
                <span className="text-sm font-semibold text-muted-foreground">Open shifts</span>
              </div>
              {open.map(ShiftRow)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Day timeline ────────────────────────────────────────────────────────────────
function DayTimeline({
  date,
  dayIndex,
  setDayIndex,
  shifts,
  groupBy,
  employees,
  empById,
  positions,
  areaLayout,
  collapsed,
  toggleCollapse,
  onEdit,
  onSaveBreak,
  onMoveShift,
  onDragCreate,
  onAdd,
}: {
  date: string;
  dayIndex: number;
  setDayIndex: (i: number) => void;
  shifts: Shift[];
  groupBy: "employee" | "area";
  employees: Profile[];
  empById: Map<string, Profile>;
  positions: Position[];
  areaLayout: AreaLayout;
  collapsed: Set<string>;
  toggleCollapse: (key: string) => void;
  onEdit: (s: Shift) => void;
  onSaveBreak: (shift: Shift, breakStartMinutes: number) => void;
  onMoveShift: (
    shift: Shift,
    patch: {
      startMinutes: number;
      endMinutes: number;
      employee_id?: string | null;
      position_id?: string | null;
    }
  ) => void;
  onDragCreate: (
    prefill: { employee_id?: string; position_id?: string | null },
    startMinutes: number,
    endMinutes: number
  ) => void;
  onAdd: () => void;
}) {
  // Axis bounds: default 6:00–24:00, widened to fit any earlier/later shift.
  const starts = shifts.map((s) => timeToMinutes(s.start_time));
  const ends = shifts.map((s) => {
    const e = timeToMinutes(s.end_time);
    const st = timeToMinutes(s.start_time);
    return e <= st ? e + 1440 : e;
  });
  const axisMin = Math.min(6 * 60, ...(starts.length ? starts : [6 * 60]));
  const axisMax = Math.max(24 * 60, ...(ends.length ? ends : [24 * 60]));
  const span = axisMax - axisMin || 1;
  const hourTicks: number[] = [];
  for (let m = Math.ceil(axisMin / 60) * 60; m <= axisMax; m += 60) hourTicks.push(m);

  const byId = new Map(positions.map((p) => [p.id, p]));
  const pos = (mins: number) => ((mins - axisMin) / span) * 100;
  const empName = (id: string | null) =>
    id ? empById.get(id)?.full_name ?? "—" : "Open";

  const hasUnassigned = shifts.some((s) => !s.position_id);
  const nothingToShow =
    employees.length === 0 && areaLayout.length === 0 && !hasUnassigned;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {DAY_LABELS.map((lbl, i) => (
            <button
              key={lbl}
              onClick={() => setDayIndex(i)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                i === dayIndex
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {lbl}
            </button>
          ))}
        </div>
        <span className="text-sm font-medium text-foreground">
          {format(parseISO(date), "EEEE d MMM")}
        </span>
      </div>

      {nothingToShow ? (
        <EmptyState
          icon={Clock}
          title="Nothing to roster yet"
          body="Flag team members as rosterable and add areas in Settings first."
          action={onAdd}
          actionLabel="Add shift"
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-3 overflow-x-auto">
          <div className="min-w-[720px] relative">
            {/* Faint hour gridlines spanning the full height (behind the bars). */}
            <div className="pointer-events-none absolute inset-y-0 left-40 right-0">
              {hourTicks.map((m) => (
                <div
                  key={m}
                  className="absolute top-0 bottom-0 w-px bg-border/40"
                  style={{ left: `${pos(m)}%` }}
                />
              ))}
            </div>
            <p className="mb-2 ml-40 text-[11px] text-muted-foreground">
              Tip: click and drag across an empty lane to create a shift.
            </p>
            {/* Hour axis */}
            <div className="relative ml-40 h-5 border-b border-border">
              {hourTicks.map((m) => (
                <div
                  key={m}
                  className="absolute -translate-x-1/2 text-[10px] text-muted-foreground"
                  style={{ left: `${pos(m)}%` }}
                >
                  {formatTime(`${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:00`)}
                </div>
              ))}
            </div>

            {groupBy === "employee"
              ? (
                <>
                  {employees.map((emp) => (
                  <div key={emp.id} className="mt-4" data-drop-kind="employee" data-drop-value={emp.id}>
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-foreground">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: emp.display_colour ?? "#94a3b8" }}
                      />
                      {emp.full_name}
                    </div>
                    {shifts
                      .filter((s) => s.employee_id === emp.id)
                      .map((s) => (
                        <DayShiftBar
                          key={s.id}
                          shift={s}
                          colour={effectiveColour(s.position_id, byId)}
                          leftLabel={positionLabel(s.position_id, byId)}
                          axisMin={axisMin}
                          span={span}
                          onEdit={() => onEdit(s)}
                          onSaveBreak={onSaveBreak}
                          onMoveShift={onMoveShift}
                        />
                      ))}
                    <DayAddLane
                      axisMin={axisMin}
                      span={span}
                      onCreate={(a, b) => onDragCreate({ employee_id: emp.id }, a, b)}
                    />
                  </div>
                  ))}
                  {shifts.some((s) => !s.employee_id) && (
                    <div className="mt-4" data-drop-kind="employee" data-drop-value="">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <span className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground/60" />
                        Open shifts
                      </div>
                      {shifts
                        .filter((s) => !s.employee_id)
                        .map((s) => (
                          <DayShiftBar
                            key={s.id}
                            shift={s}
                            colour={effectiveColour(s.position_id, byId)}
                            leftLabel={positionLabel(s.position_id, byId)}
                            axisMin={axisMin}
                            span={span}
                            onEdit={() => onEdit(s)}
                            onSaveBreak={onSaveBreak}
                          onMoveShift={onMoveShift}
                          />
                        ))}
                      <DayAddLane
                        axisMin={axisMin}
                        span={span}
                        onCreate={(a, b) => onDragCreate({}, a, b)}
                      />
                    </div>
                  )}
                </>
              )
              : (
                <>
                  {areaLayout.map(({ area, subs }) => {
                    const isCollapsed = collapsed.has(area.id);
                    const areaUsed = shifts.some((s) => s.position_id === area.id);
                    const rows: { key: string; label: string | null; colour: string; positionId: string }[] = [];
                    if (subs.length === 0 || areaUsed) {
                      rows.push({
                        key: `${area.id}:general`,
                        label: subs.length === 0 ? null : "General",
                        colour: effectiveColour(area.id, byId),
                        positionId: area.id,
                      });
                    }
                    for (const sub of subs)
                      rows.push({
                        key: sub.id,
                        label: sub.name,
                        colour: effectiveColour(sub.id, byId),
                        positionId: sub.id,
                      });
                    return (
                      <div key={area.id} className="mt-4">
                        <button
                          onClick={() => toggleCollapse(area.id)}
                          className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          <ChevronDown
                            className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")}
                          />
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: effectiveColour(area.id, byId) }} />
                          {area.name}
                        </button>
                        {!isCollapsed &&
                          rows.map((row) => (
                            <div
                              key={row.key}
                              className="mb-1"
                              data-drop-kind="position"
                              data-drop-value={row.positionId}
                            >
                              {row.label && (
                                <div className="ml-6 flex items-center gap-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: row.colour }} />
                                  {row.label}
                                </div>
                              )}
                              {shifts
                                .filter((s) => s.position_id === row.positionId)
                                .map((s) => (
                                  <DayShiftBar
                                    key={s.id}
                                    shift={s}
                                    colour={row.colour}
                                    leftLabel={empName(s.employee_id)}
                                    axisMin={axisMin}
                                    span={span}
                                    onEdit={() => onEdit(s)}
                                    onSaveBreak={onSaveBreak}
                          onMoveShift={onMoveShift}
                                  />
                                ))}
                              <DayAddLane
                                axisMin={axisMin}
                                span={span}
                                onCreate={(a, b) =>
                                  onDragCreate({ position_id: row.positionId }, a, b)
                                }
                              />
                            </div>
                          ))}
                      </div>
                    );
                  })}
                  {hasUnassigned && (
                    <div className="mt-4" data-drop-kind="position" data-drop-value="">
                      <button
                        onClick={() => toggleCollapse("__none__")}
                        className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        <ChevronDown
                          className={cn("h-4 w-4 transition-transform", collapsed.has("__none__") && "-rotate-90")}
                        />
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#94a3b8" }} />
                        Unassigned
                      </button>
                      {!collapsed.has("__none__") &&
                        shifts
                          .filter((s) => !s.position_id)
                          .map((s) => (
                            <DayShiftBar
                              key={s.id}
                              shift={s}
                              colour="#94a3b8"
                              leftLabel={empName(s.employee_id)}
                              axisMin={axisMin}
                              span={span}
                              onEdit={() => onEdit(s)}
                              onSaveBreak={onSaveBreak}
                          onMoveShift={onMoveShift}
                            />
                          ))}
                    </div>
                  )}
                </>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Day-view shift bar with a draggable unpaid break ───────────────────────────
function DayShiftBar({
  shift,
  colour,
  leftLabel,
  axisMin,
  span,
  onEdit,
  onSaveBreak,
  onMoveShift,
}: {
  shift: Shift;
  colour: string;
  leftLabel: string;
  axisMin: number;
  span: number;
  onEdit: () => void;
  onSaveBreak: (shift: Shift, breakStartMinutes: number) => void;
  onMoveShift: (
    shift: Shift,
    patch: {
      startMinutes: number;
      endMinutes: number;
      employee_id?: string | null;
      position_id?: string | null;
    }
  ) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const st = timeToMinutes(shift.start_time);
  let en = timeToMinutes(shift.end_time);
  if (en <= st) en += 1440;
  const shiftLen = en - st;
  const breakLen = shift.unpaid_break_minutes || 0;
  const hasBreak = breakLen > 0 && breakLen < shiftLen;

  const centred = Math.round(st + shiftLen / 2 - breakLen / 2);
  const stored = shift.break_start != null ? timeToMinutes(shift.break_start) : null;
  const normalisedStored = stored != null ? (stored < st ? stored + 1440 : stored) : null;
  const clampBreak = (v: number) => Math.max(st, Math.min(en - breakLen, v));
  const initialBreak = clampBreak(normalisedStored ?? centred);

  const [breakStart, setBreakStart] = useState(initialBreak);
  const [dragging, setDragging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveOffset, setMoveOffset] = useState(0);
  const valueRef = useRef(initialBreak);

  useEffect(() => {
    const v = clampBreak(normalisedStored ?? centred);
    setBreakStart(v);
    valueRef.current = v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.break_start, shift.unpaid_break_minutes, shift.start_time, shift.end_time]);

  const pos = (m: number) => ((m - axisMin) / span) * 100;
  const rel = (m: number) => ((m - st) / shiftLen) * 100;

  const bStart = clampBreak(breakStart);
  const bEnd = bStart + breakLen;

  // Drag the break within the shift.
  const startBreakDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    const track = trackRef.current;
    const move = (ev: PointerEvent) => {
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      const pointerMin = axisMin + frac * span;
      const ns = clampBreak(Math.round((pointerMin - breakLen / 2) / 5) * 5);
      valueRef.current = ns;
      setBreakStart(ns);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      if (valueRef.current !== initialBreak) onSaveBreak(shift, valueRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag the whole shift: horizontally to change time, vertically onto another
  // lane to reassign employee (Staff view) or position (Area view).
  const startMove = (e: React.PointerEvent) => {
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let deltaMin = 0;
    let lastX = startX;
    let lastY = startY;
    const maxStart = axisMin + span - shiftLen;
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) moved = true;
      const dxMin = ((ev.clientX - startX) / rect.width) * span;
      const wantStart = st + Math.round(dxMin / 15) * 15;
      const clampedStart = Math.max(axisMin, Math.min(maxStart, wantStart));
      deltaMin = clampedStart - st;
      if (moved) {
        setMoving(true);
        setMoveOffset(deltaMin);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMoving(false);
      setMoveOffset(0);
      if (!moved) {
        onEdit();
        return;
      }
      const startMinutes = st + deltaMin;
      const endMinutes = startMinutes + shiftLen;
      const patch: {
        startMinutes: number;
        endMinutes: number;
        employee_id?: string | null;
        position_id?: string | null;
      } = { startMinutes, endMinutes };
      const el = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
      const drop = el?.closest("[data-drop-kind]") as HTMLElement | null;
      if (drop) {
        const kind = drop.getAttribute("data-drop-kind");
        const value = drop.getAttribute("data-drop-value") || null;
        if (kind === "employee" && value !== shift.employee_id) patch.employee_id = value;
        else if (kind === "position" && value !== shift.position_id) patch.position_id = value;
      }
      if (deltaMin !== 0 || patch.employee_id !== undefined || patch.position_id !== undefined) {
        onMoveShift(shift, patch);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const left = pos(st + moveOffset);
  const width = Math.max(pos(en) - pos(st), 3);

  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-40 shrink-0 truncate text-xs text-foreground">{leftLabel}</div>
      <div ref={trackRef} className="relative h-7 flex-1">
        <div
          onPointerDown={startMove}
          className={cn(
            "absolute top-0 h-7 cursor-grab active:cursor-grabbing",
            moving && "z-20 opacity-90 ring-2 ring-primary rounded"
          )}
          style={{ left: `${left}%`, width: `${width}%` }}
          title="Drag to move · click to edit"
        >
          {hasBreak ? (
            <>
              <div
                className="absolute top-0 flex h-7 items-center rounded-l-md px-2 text-[11px] font-medium text-white overflow-hidden whitespace-nowrap"
                style={{ left: 0, width: `${rel(bStart)}%`, backgroundColor: colour }}
              >
                {formatTime(minutesToTime(st + moveOffset))}
              </div>
              <div
                className="absolute top-0 flex h-7 items-center justify-end rounded-r-md px-2 text-[11px] font-medium text-white overflow-hidden whitespace-nowrap"
                style={{ left: `${rel(bEnd)}%`, width: `${100 - rel(bEnd)}%`, backgroundColor: colour }}
              >
                {formatTime(minutesToTime(en + moveOffset))}
              </div>
              <div
                onPointerDown={startBreakDrag}
                className={cn(
                  "absolute top-0 flex h-7 cursor-ew-resize items-center justify-center rounded border border-dashed select-none",
                  dragging
                    ? "border-foreground bg-background"
                    : "border-muted-foreground/50 bg-background/80"
                )}
                style={{ left: `${rel(bStart)}%`, width: `${Math.max(rel(bEnd) - rel(bStart), 4)}%` }}
                title={`Break ${breakLen} min — drag to move (starts ${formatTime(minutesToTime(bStart + moveOffset))})`}
              >
                <span className="text-[10px] leading-none text-muted-foreground">⋮⋮</span>
              </div>
            </>
          ) : (
            <div
              className="absolute inset-0 flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-white overflow-hidden whitespace-nowrap"
              style={{ backgroundColor: colour }}
              title={shift.note ?? undefined}
            >
              {formatTime(minutesToTime(st + moveOffset))}–{formatTime(minutesToTime(en + moveOffset))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Drag-to-create lane (day view) ─────────────────────────────────────────────
function DayAddLane({
  axisMin,
  span,
  onCreate,
}: {
  axisMin: number;
  span: number;
  onCreate: (startMinutes: number, endMinutes: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const pos = (m: number) => ((m - axisMin) / span) * 100;

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const toMin = (clientX: number) => {
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      return Math.round((axisMin + frac * span) / 15) * 15;
    };
    const a = toMin(e.clientX);
    let last = a;
    setSel({ a, b: a });
    const move = (ev: PointerEvent) => {
      last = toMin(ev.clientX);
      setSel({ a, b: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSel(null);
      const lo = Math.min(a, last);
      const hi = Math.max(a, last);
      if (hi - lo >= 15) onCreate(lo, hi);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const lo = sel ? Math.min(sel.a, sel.b) : 0;
  const hi = sel ? Math.max(sel.a, sel.b) : 0;

  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-40 shrink-0" />
      <div
        ref={trackRef}
        onPointerDown={start}
        className="relative h-6 flex-1 cursor-crosshair rounded bg-muted/25 hover:bg-muted/40"
      >
        {sel ? (
          <div
            className="absolute top-0 flex h-6 items-center justify-center rounded border border-primary bg-primary/40"
            style={{ left: `${pos(lo)}%`, width: `${Math.max(pos(hi) - pos(lo), 0)}%` }}
          >
            <span className="whitespace-nowrap text-[9px] font-medium text-primary-foreground">
              {formatTime(minutesToTime(lo))}–{formatTime(minutesToTime(hi))}
            </span>
          </div>
        ) : (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/50">
            drag to add
          </span>
        )}
      </div>
    </div>
  );
}

// ── Team sort / filter bar ────────────────────────────────────────────────────
// Sits above the grid in Staff grouping. Narrowing the list here also narrows
// the day timeline and the mobile list, so the three views never disagree about
// who is on screen.
function TeamFilterBar({
  search,
  setSearch,
  stationFilter,
  setStationFilter,
  hideEmpty,
  setHideEmpty,
  areaLayout,
  shown,
  total,
  onClear,
  filtersActive,
}: {
  search: string;
  setSearch: (v: string) => void;
  stationFilter: string;
  setStationFilter: (v: string) => void;
  hideEmpty: boolean;
  setHideEmpty: (v: boolean) => void;
  areaLayout: AreaLayout;
  shown: number;
  total: number;
  onClear: () => void;
  filtersActive: boolean;
}) {
  // Shown on mobile too — the filters drive the mobile list as well, so hiding
  // the controls there would leave people filtered out with no way back.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find someone…"
          className="w-40 rounded-lg border border-border bg-card py-2 pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 sm:w-48"
        />
      </div>

      <select
        value={stationFilter}
        onChange={(e) => setStationFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        title="Show only people trained on this station"
      >
        <option value="">All stations</option>
        {areaLayout.map(({ area, subs }) => (
          <Fragment key={area.id}>
            <option value={area.id}>{area.name}</option>
            {subs.map((sub) => (
              <option key={sub.id} value={sub.id}>
                &nbsp;&nbsp;{sub.name}
              </option>
            ))}
          </Fragment>
        ))}
      </select>

      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={hideEmpty}
          onChange={(e) => setHideEmpty(e.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        Hide nobody-on
      </label>

      <span className="text-xs text-muted-foreground">
        {shown} of {total}
      </span>

      {filtersActive && (
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}

// ── Compliance issues panel ───────────────────────────────────────────────────
function IssuesPanel({
  issues,
  counts,
  onOpenIssue,
  onClose,
}: {
  issues: RosterIssue[];
  counts: { error: number; warning: number; info: number };
  onOpenIssue: (issue: RosterIssue) => void;
  onClose: () => void;
}) {
  const groups: { severity: IssueSeverity; label: string; list: RosterIssue[] }[] = [
    { severity: "error", label: "Must fix", list: issues.filter((i) => i.severity === "error") },
    { severity: "warning", label: "Check", list: issues.filter((i) => i.severity === "warning") },
    { severity: "info", label: "Cost notes", list: issues.filter((i) => i.severity === "info") },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Roster check</h2>
            <p className="text-xs text-muted-foreground">
              {counts.error} must fix · {counts.warning} to check · {counts.info} cost notes
            </p>
          </div>
          <button onClick={onClose} className={iconBtn}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {issues.length === 0 && (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              Nothing to flag — this week is clean.
            </p>
          )}
          {groups.map(
            (g) =>
              g.list.length > 0 && (
                <div key={g.severity} className="mb-4">
                  <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.label} ({g.list.length})
                  </div>
                  <div className="space-y-1.5">
                    {g.list.map((issue, i) => (
                      <button
                        key={`${issue.code}-${issue.employeeId}-${issue.date}-${i}`}
                        onClick={() => onOpenIssue(issue)}
                        className={cn(
                          "block w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-accent",
                          issue.severity === "error"
                            ? "border-destructive/40 bg-destructive/[0.06]"
                            : issue.severity === "warning"
                            ? "border-warning/40 bg-warning/[0.06]"
                            : "border-border"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {issue.employeeName}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {format(parseISO(issue.date), "EEE d MMM")}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {ISSUE_LABELS[issue.code]}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{issue.message}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small shared bits ────────────────────────────────────────────────────────────
function StatusBadge({
  status,
  publishedAt,
}: {
  status: "draft" | "published";
  publishedAt: string | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        status === "published"
          ? "bg-success/15 text-success"
          : "bg-warning/15 text-warning"
      )}
      title={publishedAt ? `Published ${format(parseISO(publishedAt), "d MMM h:mma")}` : undefined}
    >
      {status === "published" ? "Published" : "Draft"}
    </span>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Clock;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  actionLabel,
}: {
  icon: typeof Clock;
  title: string;
  body: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-14 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/60" />
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && actionLabel && (
        <button
          onClick={action}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> {actionLabel}
        </button>
      )}
    </div>
  );
}

const iconBtn =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-accent";
