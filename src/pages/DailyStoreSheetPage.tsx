import { useState, useEffect } from "react";
import { format, subDays } from "date-fns";
import {
  ClipboardList,
  Loader2,
  Save,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from "lucide-react";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useDailyStoreSheets,
  useDailyStoreSheet,
} from "@/hooks/useDailyStoreSheets";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function DailyStoreSheetPage() {
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const { isSuperadmin, canAccessRestaurant } = usePermissions();

  const today = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);
  const [shiftNotes, setShiftNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const canEdit =
    isSuperadmin ||
    (selectedRestaurantId
      ? canAccessRestaurant(selectedRestaurantId)
      : false);

  const { sheets, isLoading: listLoading } =
    useDailyStoreSheets(selectedRestaurantId);
  const { sheet, isLoading: sheetLoading } = useDailyStoreSheet(
    selectedRestaurantId,
    selectedDate
  );
  const { upsert, isUpserting } = useDailyStoreSheets(selectedRestaurantId);

  // Populate form when sheet loads
  useEffect(() => {
    if (sheet) {
      setShiftNotes(sheet.shift_notes ?? "");
      setSaved(true);
    } else {
      setShiftNotes("");
      setSaved(false);
    }
  }, [sheet]);

  function shiftDate(days: number) {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    const newDate = format(d, "yyyy-MM-dd");
    // Don't go into the future
    if (newDate <= today) {
      setSelectedDate(newDate);
    }
  }

  async function handleSave() {
    if (!selectedRestaurantId) return;
    try {
      await upsert({
        restaurant_id: selectedRestaurantId,
        sheet_date: selectedDate,
        shift_notes: shiftNotes.trim() || null,
      });
      setSaved(true);
      toast.success("Daily sheet saved");
    } catch {
      toast.error("Failed to save daily sheet");
    }
  }

  // Recent sheets for the sidebar/list
  const recentDates = Array.from({ length: 7 }, (_, i) =>
    format(subDays(new Date(), i), "yyyy-MM-dd")
  );
  const sheetMap = new Map(sheets.map((s) => [s.sheet_date, s]));

  if (!selectedRestaurantId) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Select a venue to fill in the daily sheet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header restaurantName={restaurant?.name} />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── Main form ─────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Date picker row */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => shiftDate(-1)}
                className="rounded-lg p-2 hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                <input
                  type="date"
                  value={selectedDate}
                  max={today}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent text-sm font-semibold text-foreground focus:outline-none"
                />
                <span className="text-xs text-muted-foreground">
                  {selectedDate === today
                    ? "Today"
                    : format(new Date(selectedDate + "T00:00:00"), "EEEE")}
                </span>
              </div>

              <button
                onClick={() => shiftDate(1)}
                disabled={selectedDate >= today}
                className={cn(
                  "rounded-lg p-2 hover:bg-accent transition-colors",
                  selectedDate >= today
                    ? "text-muted-foreground/30 cursor-not-allowed"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Shift notes */}
          {sheetLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div>
                <label className="text-sm font-semibold text-card-foreground block mb-1.5">
                  Shift Notes
                </label>
                <p className="text-xs text-muted-foreground mb-3">
                  Anything notable from today — staffing issues, equipment problems,
                  customer feedback, deliveries, or things the next shift should know.
                </p>
                <textarea
                  value={shiftNotes}
                  onChange={(e) => {
                    setShiftNotes(e.target.value);
                    setSaved(false);
                  }}
                  disabled={!canEdit}
                  rows={6}
                  placeholder="How did the shift go today?"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              {/* Save button */}
              {canEdit && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {saved && (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Saved
                      </span>
                    )}
                    {sheet?.updated_at && (
                      <span className="text-xs text-muted-foreground">
                        Last updated{" "}
                        {format(new Date(sheet.updated_at), "d MMM h:mma")}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={isUpserting}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                      "bg-primary text-primary-foreground hover:bg-primary-hover",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {isUpserting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Recent sheets sidebar ─────────────────────────── */}
        <div className="w-full lg:w-56 shrink-0">
          <div className="rounded-xl border border-border bg-card p-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-2">
              Last 7 Days
            </h3>
            <div className="space-y-0.5">
              {listLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                recentDates.map((d) => {
                  const hasSheet = sheetMap.has(d);
                  const isSelected = d === selectedDate;
                  return (
                    <button
                      key={d}
                      onClick={() => setSelectedDate(d)}
                      className={cn(
                        "flex items-center justify-between w-full rounded-lg px-3 py-2 text-sm transition-colors",
                        isSelected
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <span>
                        {d === today
                          ? "Today"
                          : format(new Date(d + "T00:00:00"), "EEE d MMM")}
                      </span>
                      {hasSheet && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ restaurantName }: { restaurantName?: string }) {
  return (
    <div className="flex items-center gap-3">
      <ClipboardList className="h-7 w-7 text-primary" />
      <div>
        <h1 className="text-2xl font-bold text-foreground">Daily Sheet</h1>
        {restaurantName && (
          <p className="text-sm text-muted-foreground">{restaurantName}</p>
        )}
      </div>
    </div>
  );
}
