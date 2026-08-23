import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { format, parseISO, addDays } from "date-fns";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useEmployees } from "@/hooks/useEmployees";
import { usePositions } from "@/hooks/usePositions";
import { useShifts } from "@/hooks/useShifts";
import {
  mondayOf,
  toISODate,
  weekDates,
  weekStartOf,
  DAY_LABELS,
  shiftHours,
  formatTime,
} from "@/lib/roster";
import { effectiveColour } from "@/lib/positions";
import type { Shift } from "@/types";

export default function RosterViewPage() {
  const { data: restaurants = [] } = useRestaurants();
  const [storeId, setStoreId] = useState<string | null>(null);
  const activeStore = storeId ?? restaurants[0]?.id ?? null;
  const store = restaurants.find((r) => r.id === activeStore);

  const [weekStart, setWeekStart] = useState(() => toISODate(mondayOf(new Date())));
  const days = weekDates(weekStart);

  const { data: employees = [] } = useEmployees();
  const { activePositions } = usePositions();
  const { shifts } = useShifts(activeStore, weekStart);

  const posById = useMemo(
    () => new Map(activePositions.map((p) => [p.id, p])),
    [activePositions]
  );

  const shiftWeek = (delta: number) =>
    setWeekStart(toISODate(addDays(parseISO(weekStart), delta * 7)));

  const isThisWeek = weekStartOf(toISODate(new Date())) === weekStart;
  const hasOpen = shifts.some((s) => !s.employee_id);

  const Chip = ({ s }: { s: Shift }) => {
    const pos = s.position_id ? posById.get(s.position_id) : null;
    const colour = effectiveColour(s.position_id, posById);
    return (
      <div
        className="rounded-md px-2 py-1 text-left text-xs font-medium text-white"
        style={{ backgroundColor: colour }}
        title={s.note ?? undefined}
      >
        {formatTime(s.start_time)}–{formatTime(s.end_time)}
        {pos && <span className="block text-[10px] font-normal opacity-90">{pos.name}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CalendarRange className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Roster</h1>
            <p className="text-sm text-muted-foreground">{store?.name}</p>
          </div>
        </div>
        {restaurants.length > 1 && (
          <select
            value={activeStore ?? ""}
            onChange={(e) => setStoreId(e.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => shiftWeek(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[190px] text-center text-sm font-medium text-foreground">
          {format(parseISO(days[0]), "d MMM")} – {format(parseISO(days[6]), "d MMM yyyy")}
        </span>
        <button
          onClick={() => shiftWeek(1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {!isThisWeek && (
          <button
            onClick={() => setWeekStart(toISODate(mondayOf(new Date())))}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            This week
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Team member
              </th>
              {days.map((d, i) => (
                <th key={d} className="min-w-[120px] px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {DAY_LABELS[i]} {format(parseISO(d), "d/M")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {employees.map((emp) => {
              const empHours = shifts
                .filter((s) => s.employee_id === emp.id)
                .reduce((t, s) => t + shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes), 0);
              return (
                <tr key={emp.id} className="hover:bg-muted/10">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: emp.display_colour ?? "#94a3b8" }}
                      />
                      <div className="leading-tight">
                        <div className="text-sm font-medium text-foreground">{emp.full_name}</div>
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {empHours > 0 ? `${empHours.toFixed(1)} h` : "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  {days.map((d) => (
                    <td key={d} className="px-1.5 py-1.5 align-top">
                      <div className="space-y-1">
                        {shifts
                          .filter((s) => s.employee_id === emp.id && s.date === d)
                          .map((s) => <Chip key={s.id} s={s} />)}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}

            {hasOpen && (
              <tr className="hover:bg-muted/10">
                <td className="sticky left-0 z-10 bg-card px-3 py-2 text-sm font-medium text-muted-foreground whitespace-nowrap">
                  Open shifts
                </td>
                {days.map((d) => (
                  <td key={d} className="px-1.5 py-1.5 align-top">
                    <div className="space-y-1">
                      {shifts
                        .filter((s) => !s.employee_id && s.date === d)
                        .map((s) => <Chip key={s.id} s={s} />)}
                    </div>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
