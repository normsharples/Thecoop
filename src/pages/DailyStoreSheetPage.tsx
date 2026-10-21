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
<<<<<<< HEAD
  Calculator,
  PlusCircle,
  Trash2,
  ChevronDown,
  ChevronUp,
=======
>>>>>>> feature/daily-store-sheet
} from "lucide-react";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useDailyStoreSheets,
  useDailyStoreSheet,
} from "@/hooks/useDailyStoreSheets";
<<<<<<< HEAD
import { useCashUps, DENOMINATIONS, tillTotalFromCounts } from "@/hooks/useCashUps";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { CashOutItem } from "@/types";
=======
import { cn } from "@/lib/utils";
import { toast } from "sonner";
>>>>>>> feature/daily-store-sheet

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

<<<<<<< HEAD
  // ── Cash Up state ──────────────────────────────────────────────────────────
  const { cashUps, isLoading: cashUpsLoading, upsert: upsertCashUp, isUpserting: isCashUpSaving } = useCashUps(selectedRestaurantId);
  const [cashUpOpen, setCashUpOpen] = useState(true);
  const [denominationCounts, setDenominationCounts] = useState<Record<string, string>>({});
  const [amountDeposited, setAmountDeposited] = useState("");
  const [posExpected, setPosExpected] = useState("");
  const [cashOuts, setCashOuts] = useState<CashOutItem[]>([]);
  const [cashUpNotes, setCashUpNotes] = useState("");
  const [cashUpSaved, setCashUpSaved] = useState(false);

  const FLOAT_AMOUNT = 200;
  const parsedCounts = Object.fromEntries(
    Object.entries(denominationCounts).map(([k, v]) => [k, parseInt(v, 10) || 0])
  );
  const tillCountNum = tillTotalFromCounts(parsedCounts);
  const amountToBank = Math.max(0, tillCountNum - FLOAT_AMOUNT);
  const cashOutsTotal = cashOuts.reduce((sum, c) => sum + (c.amount || 0), 0);
  const depositedNum = parseFloat(amountDeposited) || 0;
  const posExpectedNum = parseFloat(posExpected) || 0;
  const cashVariance = depositedNum - posExpectedNum;

  // Find today's cash up record
  const todayCashUp = cashUps.find((cu) => cu.cash_up_date === selectedDate);

=======
>>>>>>> feature/daily-store-sheet
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

<<<<<<< HEAD
  // Populate cash up form when existing record loads
  useEffect(() => {
    if (todayCashUp) {
      const counts: Record<string, string> = {};
      for (const [k, v] of Object.entries(todayCashUp.denomination_counts ?? {})) {
        if (v) counts[k] = String(v);
      }
      setDenominationCounts(counts);
      setAmountDeposited(todayCashUp.amount_deposited ? String(todayCashUp.amount_deposited) : "");
      setPosExpected(todayCashUp.pos_expected_deposit ? String(todayCashUp.pos_expected_deposit) : "");
      setCashOuts(todayCashUp.cash_outs ?? []);
      setCashUpNotes(todayCashUp.notes ?? "");
      setCashUpSaved(true);
    } else {
      setDenominationCounts({});
      setAmountDeposited("");
      setPosExpected("");
      setCashOuts([]);
      setCashUpNotes("");
      setCashUpSaved(false);
    }
  }, [todayCashUp, selectedDate]);

=======
>>>>>>> feature/daily-store-sheet
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

<<<<<<< HEAD
  // ── Cash Up handlers ───────────────────────────────────────────────────────
  function updateDenominationCount(key: string, value: string) {
    setDenominationCounts((prev) => ({ ...prev, [key]: value }));
    setCashUpSaved(false);
  }

  function addCashOut() {
    setCashOuts((prev) => [...prev, { description: "", amount: 0 }]);
    setCashUpSaved(false);
  }

  function updateCashOut(index: number, field: "description" | "amount", value: string) {
    setCashOuts((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, [field]: field === "amount" ? parseFloat(value) || 0 : value } : c
      )
    );
    setCashUpSaved(false);
  }

  function removeCashOut(index: number) {
    setCashOuts((prev) => prev.filter((_, i) => i !== index));
    setCashUpSaved(false);
  }

  async function handleSaveCashUp() {
    if (!selectedRestaurantId) return;
    try {
      await upsertCashUp({
        restaurant_id: selectedRestaurantId,
        cash_up_date: selectedDate,
        denomination_counts: parsedCounts,
        amount_deposited: depositedNum,
        pos_expected_deposit: posExpectedNum,
        cash_outs: cashOuts.filter((c) => c.description.trim() || c.amount),
        notes: cashUpNotes.trim() || null,
      });
      setCashUpSaved(true);
      toast.success("Cash up saved");
    } catch (err) {
      toast.error("Failed to save cash up: " + (err as Error).message);
    }
  }

=======
>>>>>>> feature/daily-store-sheet
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
<<<<<<< HEAD

          {/* ── Cash Up section ────────────────────────────────── */}
          {!sheetLoading && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Collapsible header */}
              <button
                onClick={() => setCashUpOpen(!cashUpOpen)}
                className="flex items-center justify-between w-full px-5 py-4 text-left hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-card-foreground">Cash Up</span>
                  {cashUpSaved && todayCashUp && (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="h-3 w-3" />
                      Recorded
                    </span>
                  )}
                </div>
                {cashUpOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {cashUpOpen && (
                <div className="border-t border-border px-5 pb-5 space-y-5">
                  {/* Till counter */}
                  <div className="rounded-lg border border-border bg-background p-4 space-y-3 mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Till Counter
                    </p>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</p>
                        {DENOMINATIONS.filter((d) => d.type === "note").map((d) => (
                          <div key={d.key} className="flex items-center gap-2">
                            <span className="w-10 text-sm text-foreground">{d.label}</span>
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="0"
                              className="h-8 text-sm"
                              disabled={!canEdit}
                              value={denominationCounts[d.key] ?? ""}
                              onChange={(e) => updateDenominationCount(d.key, e.target.value)}
                            />
                            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                              {formatCurrency(((parseInt(denominationCounts[d.key], 10) || 0) * d.cents) / 100)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Coins</p>
                        {DENOMINATIONS.filter((d) => d.type === "coin").map((d) => (
                          <div key={d.key} className="flex items-center gap-2">
                            <span className="w-10 text-sm text-foreground">{d.label}</span>
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="0"
                              className="h-8 text-sm"
                              disabled={!canEdit}
                              value={denominationCounts[d.key] ?? ""}
                              onChange={(e) => updateDenominationCount(d.key, e.target.value)}
                            />
                            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                              {formatCurrency(((parseInt(denominationCounts[d.key], 10) || 0) * d.cents) / 100)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                      <span className="text-muted-foreground">Till total</span>
                      <span className="font-semibold tabular-nums text-foreground">{formatCurrency(tillCountNum)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Less $200 float</span>
                      <span className="font-semibold tabular-nums text-foreground">{formatCurrency(amountToBank)} to bank</span>
                    </div>
                  </div>

                  {/* POS Expected */}
                  <div className="space-y-1.5">
                    <Label htmlFor="pos_expected">POS Expected Deposit</Label>
                    <p className="text-xs text-muted-foreground">What the POS system expects should be banked today.</p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        id="pos_expected"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="pl-7"
                        disabled={!canEdit}
                        value={posExpected}
                        onChange={(e) => { setPosExpected(e.target.value); setCashUpSaved(false); }}
                      />
                    </div>
                  </div>

                  {/* Amount Deposited */}
                  <div className="space-y-1.5">
                    <Label htmlFor="amount_deposited">Amount Deposited</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        id="amount_deposited"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="pl-7"
                        disabled={!canEdit}
                        value={amountDeposited}
                        onChange={(e) => { setAmountDeposited(e.target.value); setCashUpSaved(false); }}
                      />
                    </div>
                  </div>

                  {/* Variance summary */}
                  {(posExpectedNum > 0 || depositedNum > 0) && (
                    <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Variance</span>
                        <span className={cn(
                          "font-semibold tabular-nums",
                          Math.abs(cashVariance) < 1 ? "text-foreground" : cashVariance >= 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {cashVariance >= 0 ? "+" : ""}{formatCurrency(cashVariance)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Cash Outs */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Cash Outs</Label>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={addCashOut}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                          Add Cash Out
                        </button>
                      )}
                    </div>
                    {cashOuts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No cash outs recorded for this day.</p>
                    ) : (
                      <div className="space-y-2">
                        {cashOuts.map((cashOut, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              placeholder="Description"
                              value={cashOut.description}
                              disabled={!canEdit}
                              onChange={(e) => updateCashOut(i, "description", e.target.value)}
                              className="flex-1"
                            />
                            <div className="relative w-28 shrink-0">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                className="pl-7"
                                disabled={!canEdit}
                                value={cashOut.amount || ""}
                                onChange={(e) => updateCashOut(i, "amount", e.target.value)}
                              />
                            </div>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => removeCashOut(i)}
                                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                          <span>Total cash outs</span>
                          <span className="font-medium tabular-nums">{formatCurrency(cashOutsTotal)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cash up notes */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cash_up_notes">Cash Up Notes</Label>
                    <Textarea
                      id="cash_up_notes"
                      placeholder="Any additional details about the cash up..."
                      rows={2}
                      disabled={!canEdit}
                      value={cashUpNotes}
                      onChange={(e) => { setCashUpNotes(e.target.value); setCashUpSaved(false); }}
                    />
                  </div>

                  {/* Save cash up */}
                  {canEdit && (
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        {cashUpSaved && todayCashUp && (
                          <span className="flex items-center gap-1 text-xs text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Saved
                          </span>
                        )}
                        {todayCashUp?.updated_at && (
                          <span className="text-xs text-muted-foreground">
                            Last updated{" "}
                            {format(new Date(todayCashUp.updated_at), "d MMM h:mma")}
                          </span>
                        )}
                      </div>

                      <Button
                        onClick={handleSaveCashUp}
                        disabled={isCashUpSaving}
                        size="sm"
                      >
                        {isCashUpSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Save Cash Up
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
=======
>>>>>>> feature/daily-store-sheet
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
