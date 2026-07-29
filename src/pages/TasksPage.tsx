import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { ListChecks, Plus, Trash2, Check, ShoppingCart, ClipboardList, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Restaurant } from "@/types";

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// JS getDay(): 0=Sun..6=Sat → our 0=Mon..6=Sun
const jsToMonday0 = (d: Date) => (d.getDay() === 0 ? 6 : d.getDay() - 1);

type TaskKind = "order" | "recurring" | "builtin";
interface TaskItem {
  key: string;
  label: string;
  kind: TaskKind;
  done: boolean;
  auto: boolean; // completion is derived (PO exists / data present) rather than a manual tick
  link?: string;
  recurringId?: string; // for delete
}

export default function TasksPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { data: restaurants = [] } = useRestaurants();
  const { selectedRestaurantIds } = useSelectedRestaurant();

  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const dow = jsToMonday0(today);
  const lastWeekStart = format(startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const lastWeekEnd = format(endOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }), "yyyy-MM-dd");

  // Venues to show: the selected subset, else all accessible.
  const venues = useMemo<Restaurant[]>(
    () =>
      selectedRestaurantIds.length
        ? restaurants.filter((r) => selectedRestaurantIds.includes(r.id))
        : restaurants,
    [restaurants, selectedRestaurantIds]
  );
  const venueIds = venues.map((v) => v.id);

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: schedule = [] } = useQuery({
    queryKey: ["tasks-ordering", venueIds.join(","), dow],
    enabled: venueIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordering_schedule")
        .select("restaurant_id, supplier_name")
        .in("restaurant_id", venueIds)
        .eq("day_of_week", dow);
      if (error) throw error;
      return (data ?? []) as { restaurant_id: string; supplier_name: string }[];
    },
  });

  const { data: recurring = [] } = useQuery({
    queryKey: ["tasks-recurring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_tasks")
        .select("id, restaurant_id, day_of_week, title, sort_order")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        restaurant_id: string | null;
        day_of_week: number | null;
        title: string;
        sort_order: number;
      }[];
    },
  });

  const { data: posToday = [] } = useQuery({
    queryKey: ["tasks-pos-today", venueIds.join(","), todayStr],
    enabled: venueIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("restaurant_id, supplier_name")
        .in("restaurant_id", venueIds)
        .eq("order_date", todayStr);
      if (error) throw error;
      return (data ?? []) as { restaurant_id: string; supplier_name: string }[];
    },
  });

  const { data: labourVenueIds = [] } = useQuery({
    queryKey: ["tasks-labour-lastweek", venueIds.join(","), lastWeekStart],
    enabled: venueIds.length > 0 && dow === 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_daily")
        .select("restaurant_id")
        .in("restaurant_id", venueIds)
        .gte("date", lastWeekStart)
        .lte("date", lastWeekEnd);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.restaurant_id as string))];
    },
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["tasks-completions", venueIds.join(","), todayStr],
    enabled: venueIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_completions")
        .select("restaurant_id, task_key")
        .in("restaurant_id", venueIds)
        .eq("task_date", todayStr);
      if (error) throw error;
      return (data ?? []) as { restaurant_id: string; task_key: string }[];
    },
  });

  const completedSet = useMemo(
    () => new Set(completions.map((c) => `${c.restaurant_id}:${c.task_key}`)),
    [completions]
  );
  const poSet = useMemo(
    () => new Set(posToday.map((p) => `${p.restaurant_id}:${p.supplier_name}`)),
    [posToday]
  );
  const labourDone = useMemo(() => new Set(labourVenueIds), [labourVenueIds]);

  // ── Build per-venue task lists ────────────────────────────────────────────
  const tasksByVenue = ((): Map<string, TaskItem[]> => {
    const map = new Map<string, TaskItem[]>();
    for (const v of venues) {
      const items: TaskItem[] = [];

      // Ordering-schedule tasks
      for (const s of schedule.filter((r) => r.restaurant_id === v.id)) {
        const key = `order:${s.supplier_name}`;
        const auto = poSet.has(`${v.id}:${s.supplier_name}`);
        items.push({
          key,
          label: `Order from ${s.supplier_name}`,
          kind: "order",
          auto,
          done: auto || completedSet.has(`${v.id}:${key}`),
          link: "/admin/purchase-orders",
        });
      }

      // Recurring tasks (this venue or all venues; this weekday or every day)
      for (const t of recurring) {
        if (t.restaurant_id && t.restaurant_id !== v.id) continue;
        if (t.day_of_week !== null && t.day_of_week !== dow) continue;
        const key = `recurring:${t.id}`;
        items.push({
          key,
          label: t.title,
          kind: "recurring",
          auto: false,
          done: completedSet.has(`${v.id}:${key}`),
          recurringId: t.id,
        });
      }

      // Built-in: Monday labour check
      if (dow === 0 && !labourDone.has(v.id)) {
        const key = "builtin:labour";
        items.push({
          key,
          label: "Enter last week's labour data",
          kind: "builtin",
          auto: false,
          done: completedSet.has(`${v.id}:${key}`),
          link: "/reports/labour/manual-entry",
        });
      }

      map.set(v.id, items);
    }
    return map;
  })();

  // ── Mutations ─────────────────────────────────────────────────────────────
  const toggle = useMutation({
    mutationFn: async ({ venueId, key, done }: { venueId: string; key: string; done: boolean }) => {
      if (done) {
        const { error } = await supabase
          .from("task_completions")
          .delete()
          .eq("restaurant_id", venueId)
          .eq("task_key", key)
          .eq("task_date", todayStr);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("task_completions").insert({
          restaurant_id: venueId,
          task_key: key,
          task_date: todayStr,
          completed_by: profile?.id ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["tasks-completions", venueIds.join(","), todayStr] }),
    onError: () => toast.error("Failed to update task"),
  });

  const deleteRecurring = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recurring_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-recurring"] });
      toast.success("Task removed");
    },
    onError: () => toast.error("Failed to remove task"),
  });

  // ── Add-task form ─────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDay, setNewDay] = useState<string>(String(dow));
  const [newScope, setNewScope] = useState<string>("all");

  const addTask = useMutation({
    mutationFn: async () => {
      const title = newTitle.trim();
      if (!title) throw new Error("Enter a task");
      const { error } = await supabase.from("recurring_tasks").insert({
        title,
        day_of_week: newDay === "any" ? null : Number(newDay),
        restaurant_id: newScope === "all" ? null : newScope,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-recurring"] });
      setNewTitle("");
      setShowAdd(false);
      toast.success("Task added");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to add task"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ListChecks className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Today&apos;s Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {DAY_LABELS[dow]}, {format(today, "d MMM yyyy")}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowAdd((s) => !s)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Task
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task, e.g. Enter previous week's invoices"
            onKeyDown={(e) => e.key === "Enter" && addTask.mutate()}
          />
          <div className="flex flex-wrap gap-2">
            <Select value={newDay} onValueChange={setNewDay}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Every day</SelectItem>
                {DAY_LABELS.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newScope} onValueChange={setNewScope}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All venues</SelectItem>
                {restaurants.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => addTask.mutate()} disabled={addTask.isPending}>
              {addTask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Recurring tasks reappear automatically on their day. Ticking a task only clears it for today.
          </p>
        </div>
      )}

      {venues.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
          No venue selected or accessible.
        </div>
      ) : (
        venues.map((v) => {
          const items = tasksByVenue.get(v.id) ?? [];
          const remaining = items.filter((i) => !i.done).length;
          return (
            <div key={v.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-card-foreground">{v.name}</h2>
                <span className="text-xs text-muted-foreground">
                  {remaining === 0 ? "All done 🎉" : `${remaining} to do`}
                </span>
              </div>

              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks scheduled for today.</p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li
                      key={item.key}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 group",
                        item.done && "opacity-60"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggle.mutate({ venueId: v.id, key: item.key, done: item.done })}
                        disabled={item.auto && item.done}
                        title={item.auto && item.done ? "Automatically completed" : undefined}
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                          item.done
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:border-primary",
                          item.auto && item.done && "cursor-default"
                        )}
                        aria-label={item.done ? "Mark not done" : "Mark done"}
                      >
                        {item.done && <Check className="h-3.5 w-3.5" />}
                      </button>

                      {item.kind === "order" ? (
                        <ShoppingCart className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}

                      <span className={cn("flex-1 text-sm", item.done && "line-through")}>
                        {item.label}
                        {item.auto && item.done && (
                          <span className="ml-2 text-[11px] text-muted-foreground">(auto)</span>
                        )}
                      </span>

                      {item.link && !item.done && (
                        <Link
                          to={item.link}
                          className="text-xs text-primary hover:underline shrink-0"
                        >
                          Open
                        </Link>
                      )}

                      {item.recurringId && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Remove this recurring task from all days it appears?"))
                              deleteRecurring.mutate(item.recurringId!);
                          }}
                          className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0"
                          aria-label="Delete recurring task"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
