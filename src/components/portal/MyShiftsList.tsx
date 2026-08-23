import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarRange, Clock, Coffee, MapPin, StickyNote } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { mondayOf, toISODate, formatTime, shiftHours } from "@/lib/roster";
import type { Shift } from "@/types";

type MyShift = Shift & {
  position?: { name: string; colour: string | null } | null;
  restaurant?: { name: string } | null;
};

/** The logged-in person's own upcoming published shifts. */
export default function MyShiftsList({
  profileId,
  greetingName,
}: {
  profileId: string;
  greetingName?: string;
}) {
  const fromISO = toISODate(mondayOf(new Date()));

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ["my-roster", profileId, fromISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*, position:positions(name,colour), restaurant:restaurants(name)")
        .eq("employee_id", profileId)
        .gte("date", fromISO)
        .order("date")
        .order("start_time");
      if (error) throw error;
      return data as MyShift[];
    },
  });

  const byDate = useMemo(() => {
    const m = new Map<string, MyShift[]>();
    for (const s of shifts) {
      if (!m.has(s.date)) m.set(s.date, []);
      m.get(s.date)!.push(s);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shifts]);

  const totalHours = shifts.reduce(
    (t, s) => t + shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes),
    0
  );

  return (
    <div className="space-y-4">
      <div>
        {greetingName && (
          <p className="text-sm text-muted-foreground">Hi {greetingName} — here are your upcoming shifts.</p>
        )}
        {shifts.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {shifts.length} shift{shifts.length === 1 ? "" : "s"} · {totalHours.toFixed(1)} h from this week on
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : byDate.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-14 text-center">
          <CalendarRange className="mx-auto h-9 w-9 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium text-foreground">No published shifts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            When the roster is published, your shifts show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {byDate.map(([date, dayShifts]) => (
            <div key={date}>
              <h2 className="mb-1.5 text-sm font-semibold text-foreground">
                {format(parseISO(date), "EEEE d MMM")}
              </h2>
              <div className="space-y-2">
                {dayShifts.map((s) => {
                  const colour = s.position?.colour ?? "#6366f1";
                  const hours = shiftHours(s.start_time, s.end_time, s.unpaid_break_minutes);
                  return (
                    <div key={s.id} className="flex gap-3 rounded-xl border border-border bg-card p-3">
                      <span
                        className="mt-0.5 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: colour, minHeight: "2.5rem" }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {formatTime(s.start_time)} – {formatTime(s.end_time)}
                          <span className="text-xs font-normal text-muted-foreground">({hours.toFixed(1)} h)</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {s.restaurant?.name ?? "—"}
                          </span>
                          {s.position?.name && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                              style={{ backgroundColor: colour }}
                            >
                              {s.position.name}
                            </span>
                          )}
                          {s.unpaid_break_minutes > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Coffee className="h-3.5 w-3.5" />
                              {s.unpaid_break_minutes} min break
                            </span>
                          )}
                        </div>
                        {s.note && (
                          <div className="mt-1.5 inline-flex items-start gap-1 rounded-lg bg-muted/50 px-2 py-1 text-xs text-foreground">
                            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {s.note}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
