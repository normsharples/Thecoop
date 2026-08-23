import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toISODate } from "@/lib/roster";
import type { Profile, Shift, TimeEntry } from "@/types";

// ── Clock state machine ───────────────────────────────────────────────────────
export type ClockState = "out" | "in" | "on_break" | "done";

/** Derive the punch state of an (open) time entry. */
export function clockState(entry?: TimeEntry | null): ClockState {
  if (!entry) return "out";
  if (entry.clock_out) return "done";
  if (entry.break_start && !entry.break_end) return "on_break";
  return "in";
}

const nowISO = () => new Date().toISOString();

// ============================================================================
// PERSONAL PHONE CLOCK  (the signed-in team member clocks themselves)
// ============================================================================
export function useMyClock(profile?: Profile | null) {
  const qc = useQueryClient();
  const today = toISODate(new Date());
  const employeeId = profile?.id;

  // The single open punch, if any.
  const { data: openEntry = null } = useQuery({
    queryKey: ["my-clock-open", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("employee_id", employeeId!)
        .is("clock_out", null)
        .maybeSingle();
      if (error) throw error;
      return (data as TimeEntry) ?? null;
    },
    enabled: !!employeeId,
    refetchInterval: 60_000,
  });

  // Today's shift (context + which store to clock into).
  const { data: todayShift = null } = useQuery({
    queryKey: ["my-clock-shift", employeeId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*, position:positions(name,colour), restaurant:restaurants(name)")
        .eq("employee_id", employeeId!)
        .eq("date", today)
        .order("start_time")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Shift & { restaurant?: { name: string } }) ?? null;
    },
    enabled: !!employeeId,
  });

  // Today's completed punches (for the day summary).
  const { data: todayEntries = [] } = useQuery({
    queryKey: ["my-clock-today", employeeId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("employee_id", employeeId!)
        .eq("work_date", today)
        .order("clock_in");
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
    enabled: !!employeeId,
  });

  const invalidate = () =>
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("my-clock") });

  const clockIn = useMutation({
    mutationFn: async () => {
      const restaurantId = todayShift?.restaurant_id ?? profile?.home_restaurant_id;
      if (!restaurantId) throw new Error("No store set — ask your manager to set your home store.");
      const { error } = await supabase.from("time_entries").insert({
        restaurant_id: restaurantId,
        employee_id: employeeId,
        shift_id: todayShift?.id ?? null,
        work_date: today,
        clock_in: nowISO(),
        source: "app",
        created_by: employeeId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  async function patchOpen(patch: Partial<TimeEntry>) {
    const id = openEntry?.id;
    if (!id) throw new Error("Not clocked in");
    const { error } = await supabase.from("time_entries").update(patch).eq("id", id);
    if (error) throw error;
  }

  const startBreak = useMutation({
    mutationFn: () => patchOpen({ break_start: nowISO() }),
    onSuccess: invalidate,
  });
  const endBreak = useMutation({
    mutationFn: () => patchOpen({ break_end: nowISO() }),
    onSuccess: invalidate,
  });
  const clockOut = useMutation({
    mutationFn: () => patchOpen({ clock_out: nowISO() }),
    onSuccess: invalidate,
  });

  return {
    openEntry,
    todayShift,
    todayEntries,
    state: clockState(openEntry),
    clockIn: clockIn.mutateAsync,
    startBreak: startBreak.mutateAsync,
    endBreak: endBreak.mutateAsync,
    clockOut: clockOut.mutateAsync,
    busy:
      clockIn.isPending ||
      startBreak.isPending ||
      endBreak.isPending ||
      clockOut.isPending,
  };
}

// ============================================================================
// KIOSK  (shared venue tablet under a manager session; staff confirm via PIN)
// ============================================================================
export interface KioskStaff {
  profile: Profile;
  shift: Shift | null;   // today's shift at this store, if any
  entry: TimeEntry | null; // current open entry, if any
}

export function useKiosk(restaurantId?: string) {
  const qc = useQueryClient();
  const today = toISODate(new Date());

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["kiosk-staff", restaurantId, today],
    queryFn: async () => {
      // Rosterable people + today's shifts at this store + open entries at this store.
      const [{ data: profiles, error: pErr }, { data: shifts, error: sErr }, { data: entries, error: eErr }] =
        await Promise.all([
          supabase.from("profiles").select("*").eq("is_rosterable", true).order("full_name"),
          supabase
            .from("shifts")
            .select("*")
            .eq("restaurant_id", restaurantId!)
            .eq("date", today),
          supabase
            .from("time_entries")
            .select("*")
            .eq("restaurant_id", restaurantId!)
            .is("clock_out", null),
        ]);
      if (pErr) throw pErr;
      if (sErr) throw sErr;
      if (eErr) throw eErr;

      const shiftByEmp = new Map<string, Shift>();
      (shifts ?? []).forEach((s) => {
        if (s.employee_id) shiftByEmp.set(s.employee_id, s as Shift);
      });
      const entryByEmp = new Map<string, TimeEntry>();
      (entries ?? []).forEach((e) => entryByEmp.set((e as TimeEntry).employee_id, e as TimeEntry));

      // Show: anyone rostered today at this store, anyone whose home is this store,
      // plus anyone already clocked in here.
      const list: KioskStaff[] = (profiles as Profile[])
        .filter(
          (p) =>
            shiftByEmp.has(p.id) ||
            p.home_restaurant_id === restaurantId ||
            entryByEmp.has(p.id)
        )
        .map((p) => ({
          profile: p,
          shift: shiftByEmp.get(p.id) ?? null,
          entry: entryByEmp.get(p.id) ?? null,
        }));
      return list;
    },
    enabled: !!restaurantId,
    refetchInterval: 30_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]) === "kiosk-staff" });

  async function verifyPin(employeeId: string, pin: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("verify_pin", { target: employeeId, pin });
    if (error) throw error;
    return data === true;
  }

  const punch = useMutation({
    mutationFn: async (p: {
      employeeId: string;
      action: "in" | "break_start" | "break_end" | "out";
      shiftId?: string | null;
      entryId?: string | null;
    }) => {
      if (p.action === "in") {
        const { error } = await supabase.from("time_entries").insert({
          restaurant_id: restaurantId,
          employee_id: p.employeeId,
          shift_id: p.shiftId ?? null,
          work_date: today,
          clock_in: nowISO(),
          source: "kiosk",
        });
        if (error) throw error;
        return;
      }
      if (!p.entryId) throw new Error("No open entry");
      const patch =
        p.action === "break_start"
          ? { break_start: nowISO() }
          : p.action === "break_end"
          ? { break_end: nowISO() }
          : { clock_out: nowISO() };
      const { error } = await supabase.from("time_entries").update(patch).eq("id", p.entryId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { staff, isLoading, verifyPin, punch: punch.mutateAsync, refresh: invalidate };
}
