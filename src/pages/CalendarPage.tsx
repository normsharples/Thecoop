import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  differenceInCalendarDays,
  subDays,
  addDays,
  isWithinInterval,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Globe,
  MapPin,
  Clock,
  ChevronDown,
  LayoutList,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { CalendarEvent } from "@/types";

// ─── Event type config ────────────────────────────────────────────────────────

const EVENT_TYPES = {
  promotion:    { label: "Promotion",       chip: "bg-green-500/20 text-green-700 dark:text-green-400",   dot: "bg-green-500"   },
  game_day:     { label: "Game Day",         chip: "bg-blue-500/20 text-blue-700 dark:text-blue-400",     dot: "bg-blue-500"    },
  holiday:      { label: "Public Holiday",   chip: "bg-orange-400/20 text-orange-700 dark:text-orange-400", dot: "bg-orange-400" },
  training:     { label: "Training",         chip: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-400", dot: "bg-indigo-500" },
  store_event:  { label: "Store Event",      chip: "bg-purple-500/20 text-purple-700 dark:text-purple-400", dot: "bg-purple-500" },
  deadline:     { label: "Deadline",         chip: "bg-red-500/20 text-red-600 dark:text-red-400",        dot: "bg-red-500"     },
  milestone:    { label: "Milestone",        chip: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400", dot: "bg-yellow-500" },
  meeting:      { label: "Meeting",          chip: "bg-slate-500/20 text-slate-600 dark:text-slate-400",  dot: "bg-slate-500"   },
  catering:     { label: "Catering",         chip: "bg-teal-500/20 text-teal-700 dark:text-teal-400",     dot: "bg-teal-500"    },
  catering_prep:{ label: "Catering Prep",    chip: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400",     dot: "bg-cyan-500"    },
  maintenance:  { label: "Maintenance",      chip: "bg-orange-600/20 text-orange-700 dark:text-orange-400", dot: "bg-orange-600" },
} as const;

type EventTypeKey = keyof typeof EVENT_TYPES;

function typeInfo(type: string) {
  return EVENT_TYPES[type as EventTypeKey] ?? EVENT_TYPES.store_event;
}

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEK_OPTS = { weekStartsOn: 1 as const };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStr = format(day, "yyyy-MM-dd");
  return events.filter((e) => {
    const start = format(parseISO(e.start_date), "yyyy-MM-dd");
    const end = e.end_date ? format(parseISO(e.end_date), "yyyy-MM-dd") : start;
    return dayStr >= start && dayStr <= end;
  });
}

function eventDurationDays(event: CalendarEvent): number {
  if (!event.end_date) return 1;
  const start = parseISO(event.start_date);
  const end = parseISO(event.end_date);
  return Math.max(1, differenceInCalendarDays(end, start) + 1);
}

function isEventStart(event: CalendarEvent, day: Date): boolean {
  return isSameDay(parseISO(event.start_date), day);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const eventSchema = z.object({
  title:         z.string().min(1, "Title is required"),
  event_type:    z.string().min(1, "Type is required"),
  restaurant_id: z.string().nullable(),
  start_date:    z.string().min(1, "Start date required"),
  end_date:      z.string().optional(),
  all_day:       z.boolean(),
  start_time:    z.string().optional(),
  end_time:      z.string().optional(),
  description:   z.string().optional(),
});
type EventFormValues = z.infer<typeof eventSchema>;

// ─── Event Dialog ─────────────────────────────────────────────────────────────

function EventDialog({
  open,
  onClose,
  initial,
  defaultDate,
  defaultRestaurantId,
  restaurants,
  isSuperadmin,
}: {
  open: boolean;
  onClose: () => void;
  initial?: CalendarEvent;
  defaultDate?: string;
  defaultRestaurantId?: string | null;
  restaurants: { id: string; name: string }[];
  isSuperadmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isEdit = !!initial;

  function toFormDate(iso: string) {
    return format(parseISO(iso), "yyyy-MM-dd");
  }
  function toFormTime(iso: string) {
    return format(parseISO(iso), "HH:mm");
  }

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      title:         initial?.title ?? "",
      event_type:    initial?.event_type ?? "store_event",
      restaurant_id: initial !== undefined ? initial.restaurant_id : (defaultRestaurantId ?? null),
      start_date:    initial ? toFormDate(initial.start_date) : (defaultDate ?? format(new Date(), "yyyy-MM-dd")),
      end_date:      initial?.end_date ? toFormDate(initial.end_date) : "",
      all_day:       initial ? initial.all_day : true,
      start_time:    initial && !initial.all_day ? toFormTime(initial.start_date) : "09:00",
      end_time:      initial?.end_date && !initial.all_day ? toFormTime(initial.end_date) : "17:00",
      description:   initial?.description ?? "",
    },
  });

  const allDay = watch("all_day");

  const { mutate: save } = useMutation({
    mutationFn: async (values: EventFormValues) => {
      const startDateTime = values.all_day
        ? values.start_date
        : `${values.start_date}T${values.start_time ?? "00:00"}:00`;
      const endDateTime = values.end_date
        ? values.all_day
          ? values.end_date
          : `${values.end_date}T${values.end_time ?? "23:59"}:00`
        : null;

      const payload = {
        title:         values.title.trim(),
        event_type:    values.event_type,
        restaurant_id: values.restaurant_id || null,
        start_date:    startDateTime,
        end_date:      endDateTime,
        all_day:       values.all_day,
        description:   values.description?.trim() || null,
      };

      if (isEdit && initial) {
        const { error } = await supabase
          .from("calendar_events")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("calendar_events")
          .insert({ ...payload, created_by: profile!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Event updated" : "Event added");
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      reset();
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "Add Event"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4 pt-1">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="ev-title">Title <span className="text-destructive">*</span></Label>
            <Input
              id="ev-title"
              placeholder="e.g. Happy Hour Promo, AFL Grand Final"
              {...register("title")}
              className={cn(errors.title && "border-destructive")}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>Event Type <span className="text-destructive">*</span></Label>
            <Controller
              name="event_type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className={cn(errors.event_type && "border-destructive")}>
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EVENT_TYPES).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <span className={cn("w-2 h-2 rounded-full shrink-0", cfg.dot)} />
                          {cfg.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Restaurant — shown if superadmin or multiple restaurants accessible */}
          {(isSuperadmin || restaurants.length > 1) && (
            <div className="space-y-1.5">
              <Label>Restaurant</Label>
              <Controller
                name="restaurant_id"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value ?? "__all__"}
                    onValueChange={(v) => field.onChange(v === "__all__" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {isSuperadmin && (
                        <SelectItem value="__all__">
                          <div className="flex items-center gap-2">
                            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                            All Restaurants
                          </div>
                        </SelectItem>
                      )}
                      {restaurants.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {r.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground">
                "All Restaurants" shows this event across every location's calendar.
              </p>
            </div>
          )}

          {/* All Day toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">All Day</p>
              <p className="text-xs text-muted-foreground">No specific start/end time</p>
            </div>
            <Controller
              name="all_day"
              control={control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-start">Start Date <span className="text-destructive">*</span></Label>
              <Input
                id="ev-start"
                type="date"
                {...register("start_date")}
                className={cn(errors.start_date && "border-destructive")}
              />
            </div>
            {!allDay && (
              <div className="space-y-1.5">
                <Label htmlFor="ev-start-time">Start Time</Label>
                <Input id="ev-start-time" type="time" {...register("start_time")} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ev-end">End Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="ev-end" type="date" {...register("end_date")} />
            </div>
            {!allDay && (
              <div className="space-y-1.5">
                <Label htmlFor="ev-end-time">End Time</Label>
                <Input id="ev-end-time" type="time" {...register("end_time")} />
              </div>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ev-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="ev-desc"
              rows={2}
              placeholder="Extra details, links, notes..."
              {...register("description")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : isEdit ? "Save Changes" : "Add Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Event Detail Dialog ──────────────────────────────────────────────────────

function EventDetailDialog({
  event,
  onClose,
  onEdit,
  canEdit,
  restaurantName,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
  onEdit: () => void;
  canEdit: boolean;
  restaurantName?: string;
}) {
  const queryClient = useQueryClient();

  const { mutate: remove } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("calendar_events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event deleted");
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  if (!event) return null;

  const info   = typeInfo(event.event_type);
  const dur    = eventDurationDays(event);
  const start  = parseISO(event.start_date);
  const end    = event.end_date ? parseISO(event.end_date) : null;

  const dateLabel = dur > 1 && end
    ? `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")} (${dur} days)`
    : format(start, "d MMM yyyy");

  const timeLabel = !event.all_day
    ? `${format(start, "h:mm a")}${end ? ` – ${format(end, "h:mm a")}` : ""}`
    : null;

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 w-3 h-3 rounded-full shrink-0", info.dot)} />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-left leading-snug">{event.title}</DialogTitle>
              <Badge variant="outline" className={cn("mt-1 text-xs", info.chip)}>
                {info.label}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {dateLabel}
          </div>
          {timeLabel && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {timeLabel}
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {event.restaurant_id ? (
              <><MapPin className="h-3.5 w-3.5 shrink-0" />{restaurantName ?? "Restaurant"}</>
            ) : (
              <><Globe className="h-3.5 w-3.5 shrink-0" />All Restaurants</>
            )}
          </div>
          {event.description && (
            <p className="text-sm text-muted-foreground pt-1 border-t border-border">
              {event.description}
            </p>
          )}
        </div>

        {canEdit && (
          <DialogFooter className="gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete event?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes <span className="font-medium text-foreground">{event.title}</span>.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => remove(event.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth]     = useState(() => startOfMonth(new Date()));
  const [view, setView]                     = useState<"month" | "list">("month");
  const [addDialogOpen, setAddDialogOpen]   = useState(false);
  const [defaultDate, setDefaultDate]       = useState<string | undefined>();
  const [detailEvent, setDetailEvent]       = useState<CalendarEvent | null>(null);
  const [editingEvent, setEditingEvent]     = useState<CalendarEvent | null>(null);

  const { profile }              = useAuth();
  const { isSuperadmin }         = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const isAllRestaurants = !selectedRestaurantId;
  const allRestaurantIds = restaurants.map((r) => r.id);

  // ── Grid range ────────────────────────────────────────────────────────────
  const gridStart = useMemo(
    () => startOfWeek(startOfMonth(currentMonth), WEEK_OPTS),
    [currentMonth]
  );
  const gridEnd = useMemo(
    () => endOfWeek(endOfMonth(currentMonth), WEEK_OPTS),
    [currentMonth]
  );
  const gridDays = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd]
  );

  // ── Events query ──────────────────────────────────────────────────────────
  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["calendar-events", selectedRestaurantId ?? "all", format(gridStart, "yyyy-MM-dd"), format(gridEnd, "yyyy-MM-dd")],
    queryFn: async () => {
      // Fetch a wider window to catch multi-day events that start before grid
      const fetchFrom = format(subDays(gridStart, 31), "yyyy-MM-dd");
      const fetchTo   = format(addDays(gridEnd, 1), "yyyy-MM-dd");

      let q = supabase
        .from("calendar_events")
        .select("*")
        .lte("start_date", fetchTo)
        .order("start_date");

      if (selectedRestaurantId) {
        // Single restaurant: show its events + global (null) events
        q = q.or(`restaurant_id.eq.${selectedRestaurantId},restaurant_id.is.null`);
      } else if (allRestaurantIds.length > 0) {
        // All restaurants: show all accessible + global
        q = q.or(`restaurant_id.in.(${allRestaurantIds.join(",")}),restaurant_id.is.null`);
      }

      const { data, error } = await q;
      if (error) throw error;

      // Client-side filter: event must be active within the grid range
      const gridStartStr = format(gridStart, "yyyy-MM-dd");
      const gridEndStr   = format(gridEnd, "yyyy-MM-dd");

      return ((data ?? []) as CalendarEvent[]).filter((e) => {
        const start = format(parseISO(e.start_date), "yyyy-MM-dd");
        const end   = e.end_date ? format(parseISO(e.end_date), "yyyy-MM-dd") : start;
        return start <= gridEndStr && end >= gridStartStr;
      });
    },
    enabled: isAllRestaurants ? allRestaurantIds.length > 0 : !!selectedRestaurantId,
  });

  // ── Accessible restaurants for the form ──────────────────────────────────
  const accessibleRestaurants = isSuperadmin
    ? restaurants
    : restaurants.filter((r) => profile?.restaurant_access?.includes(r.id));

  const getRestaurantName = (id: string | null) =>
    id ? (restaurants.find((r) => r.id === id)?.name ?? "Restaurant") : "All Restaurants";

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openAddOnDay = useCallback((day: Date) => {
    setDefaultDate(format(day, "yyyy-MM-dd"));
    setAddDialogOpen(true);
  }, []);

  function handleEventClick(e: React.MouseEvent, event: CalendarEvent) {
    e.stopPropagation();
    setDetailEvent(event);
  }

  function handleEditFromDetail() {
    setEditingEvent(detailEvent);
    setDetailEvent(null);
  }

  function canEditEvent(event: CalendarEvent): boolean {
    if (isSuperadmin) return true;
    if (event.created_by === profile?.id) return true;
    if (event.restaurant_id && profile?.restaurant_access?.includes(event.restaurant_id)) return true;
    return false;
  }

  // ── List view data ────────────────────────────────────────────────────────
  const listEvents = useMemo(() => {
    const monthStr  = format(currentMonth, "yyyy-MM");
    const filtered  = events.filter((e) => {
      const s = format(parseISO(e.start_date), "yyyy-MM");
      return s === monthStr || (e.end_date && format(parseISO(e.end_date), "yyyy-MM") === monthStr);
    });
    return filtered.sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [events, currentMonth]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
          {isAllRestaurants && (
            <Badge variant="outline" className="gap-1">
              <Globe className="h-3 w-3" />
              All Restaurants
            </Badge>
          )}
          {!isAllRestaurants && (
            <Badge variant="outline" className="gap-1">
              <MapPin className="h-3 w-3" />
              {restaurants.find((r) => r.id === selectedRestaurantId)?.name}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              onClick={() => setView("month")}
              className={cn(
                "px-3 py-1.5 flex items-center gap-1.5 transition-colors",
                view === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Month
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "px-3 py-1.5 flex items-center gap-1.5 border-l border-border transition-colors",
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
              List
            </button>
          </div>

          <Button size="sm" onClick={() => { setDefaultDate(undefined); setAddDialogOpen(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Event
          </Button>
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold text-foreground min-w-[140px] text-center">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <button
          onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => setCurrentMonth(startOfMonth(new Date()))}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border hover:bg-accent hover:text-foreground transition-colors ml-1"
        >
          Today
        </button>

        {/* Event type legend */}
        <div className="hidden lg:flex items-center gap-3 ml-3 pl-3 border-l border-border flex-wrap">
          {Object.entries(EVENT_TYPES).slice(0, 6).map(([key, cfg]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
              <span className="text-xs text-muted-foreground">{cfg.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Month View ── */}
      {view === "month" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-border">
            {WEEK_DAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7">
            {gridDays.map((day) => {
              const dayStr     = format(day, "yyyy-MM-dd");
              const dayEvents  = getEventsForDay(events, day);
              const visible    = dayEvents.slice(0, 3);
              const hidden     = dayEvents.length - visible.length;
              const inMonth    = isSameMonth(day, currentMonth);
              const today      = isToday(day);

              return (
                <div
                  key={dayStr}
                  onClick={() => openAddOnDay(day)}
                  className={cn(
                    "min-h-[100px] p-1.5 border-b border-r border-border cursor-pointer hover:bg-accent/20 transition-colors group",
                    !inMonth && "bg-muted/20",
                    today && "bg-primary/5"
                  )}
                >
                  {/* Date number */}
                  <div className="flex justify-end mb-1">
                    <span className={cn(
                      "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium",
                      today
                        ? "bg-primary text-primary-foreground"
                        : inMonth
                        ? "text-foreground group-hover:bg-accent"
                        : "text-muted-foreground/50"
                    )}>
                      {format(day, "d")}
                    </span>
                  </div>

                  {/* Event chips */}
                  <div className="space-y-0.5">
                    {visible.map((event) => {
                      const info  = typeInfo(event.event_type);
                      const start = isEventStart(event, day);
                      const dur   = eventDurationDays(event);

                      return (
                        <button
                          key={event.id}
                          onClick={(e) => handleEventClick(e, event)}
                          title={event.title}
                          className={cn(
                            "w-full text-left rounded px-1.5 py-0.5 text-xs font-medium truncate transition-opacity hover:opacity-80",
                            start ? info.chip : `${info.dot} opacity-30 h-2.5`
                          )}
                        >
                          {start && (
                            <span className="flex items-center gap-1 truncate">
                              {/* Global event indicator */}
                              {isAllRestaurants && !event.restaurant_id && (
                                <Globe className="h-2.5 w-2.5 shrink-0 opacity-60" />
                              )}
                              <span className="truncate">{event.title}</span>
                              {dur > 1 && (
                                <span className="shrink-0 opacity-60">·{dur}d</span>
                              )}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {hidden > 0 && (
                      <button
                        className="w-full text-left text-xs text-muted-foreground px-1.5 hover:text-foreground transition-colors"
                        onClick={(e) => { e.stopPropagation(); /* could open day detail */ }}
                      >
                        +{hidden} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── List View ── */}
      {view === "list" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {listEvents.length === 0 ? (
            <div className="p-12 text-center">
              <CalendarDays className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">No events this month</p>
              <p className="text-xs text-muted-foreground mb-4">
                Click "Add Event" to schedule something.
              </p>
              <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Event
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {listEvents.map((event) => {
                const info   = typeInfo(event.event_type);
                const start  = parseISO(event.start_date);
                const end    = event.end_date ? parseISO(event.end_date) : null;
                const dur    = eventDurationDays(event);
                const canEdit = canEditEvent(event);

                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-accent/20 transition-colors cursor-pointer"
                    onClick={() => setDetailEvent(event)}
                  >
                    <div className={cn("mt-1 w-2 h-2 rounded-full shrink-0", info.dot)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{event.title}</span>
                        <Badge variant="outline" className={cn("text-xs py-0 px-1.5", info.chip)}>
                          {info.label}
                        </Badge>
                        {!event.restaurant_id && (
                          <Badge variant="outline" className="text-xs py-0 gap-1">
                            <Globe className="h-2.5 w-2.5" />
                            All
                          </Badge>
                        )}
                        {event.restaurant_id && isAllRestaurants && (
                          <Badge variant="outline" className="text-xs py-0 gap-1">
                            <MapPin className="h-2.5 w-2.5" />
                            {getRestaurantName(event.restaurant_id)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {dur > 1 && end
                          ? `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")} · ${dur} days`
                          : format(start, "d MMM yyyy")}
                        {!event.all_day && ` · ${format(start, "h:mm a")}`}
                      </p>
                      {event.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.description}</p>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingEvent(event); }}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Event type legend (mobile) */}
      <div className="lg:hidden flex flex-wrap gap-3">
        {Object.entries(EVENT_TYPES).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
            <span className="text-xs text-muted-foreground">{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}
      <EventDialog
        open={addDialogOpen}
        onClose={() => { setAddDialogOpen(false); setDefaultDate(undefined); }}
        defaultDate={defaultDate}
        defaultRestaurantId={selectedRestaurantId}
        restaurants={accessibleRestaurants}
        isSuperadmin={isSuperadmin}
      />

      {editingEvent && (
        <EventDialog
          open={!!editingEvent}
          onClose={() => setEditingEvent(null)}
          initial={editingEvent}
          restaurants={accessibleRestaurants}
          isSuperadmin={isSuperadmin}
        />
      )}

      <EventDetailDialog
        event={detailEvent}
        onClose={() => setDetailEvent(null)}
        onEdit={handleEditFromDetail}
        canEdit={detailEvent ? canEditEvent(detailEvent) : false}
        restaurantName={detailEvent?.restaurant_id ? getRestaurantName(detailEvent.restaurant_id) : undefined}
      />
    </div>
  );
}
