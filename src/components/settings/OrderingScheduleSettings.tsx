import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Restaurant } from "@/types";

// 0 = Monday … 6 = Sunday
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type ScheduleRow = { id: string; day_of_week: number; supplier_name: string };

export default function OrderingScheduleSettings() {
  const queryClient = useQueryClient();
  const [venueId, setVenueId] = useState<string>("");

  const { data: venues = [] } = useQuery({
    queryKey: ["venues-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("*")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as Restaurant[];
    },
  });

  // Default the picker to the first venue once loaded.
  const activeVenueId = venueId || venues[0]?.id || "";

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((s) => s.name as string);
    },
  });

  const { data: schedule = [], isLoading } = useQuery({
    queryKey: ["ordering-schedule", activeVenueId],
    enabled: !!activeVenueId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordering_schedule")
        .select("id, day_of_week, supplier_name")
        .eq("restaurant_id", activeVenueId);
      if (error) throw error;
      return (data ?? []) as ScheduleRow[];
    },
  });

  const scheduled = new Set(schedule.map((r) => `${r.day_of_week}:${r.supplier_name}`));

  const toggle = useMutation({
    mutationFn: async ({ dow, supplier, on }: { dow: number; supplier: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("ordering_schedule").insert({
          restaurant_id: activeVenueId,
          day_of_week: dow,
          supplier_name: supplier,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("ordering_schedule")
          .delete()
          .eq("restaurant_id", activeVenueId)
          .eq("day_of_week", dow)
          .eq("supplier_name", supplier);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ordering-schedule", activeVenueId] }),
    onError: () => toast.error("Failed to update schedule"),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <CalendarClock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Ordering Schedule</h2>
        </div>
        <Select value={activeVenueId} onValueChange={setVenueId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select venue" />
          </SelectTrigger>
          <SelectContent>
            {venues.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Tick the days each supplier should be ordered from at this venue. These drive the ordering
        tasks shown on the Tasks page.
      </p>

      {isLoading ? (
        <div className="h-40 rounded bg-muted/30 animate-pulse" />
      ) : suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active suppliers yet. Add suppliers first, then set their ordering days here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                  Supplier
                </th>
                {DAY_LABELS.map((d) => (
                  <th key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground text-center w-14">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {suppliers.map((supplier) => (
                <tr key={supplier} className="hover:bg-accent/20">
                  <td className="px-3 py-2 text-foreground whitespace-nowrap">{supplier}</td>
                  {DAY_LABELS.map((_, dow) => {
                    const on = scheduled.has(`${dow}:${supplier}`);
                    return (
                      <td key={dow} className="px-2 py-2 text-center">
                        <button
                          type="button"
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate({ dow, supplier, on: !on })}
                          className={cn(
                            "h-6 w-6 rounded border transition-colors",
                            on
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border hover:bg-accent"
                          )}
                          aria-label={`${supplier} ${DAY_LABELS[dow]}`}
                        >
                          {on ? "✓" : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
