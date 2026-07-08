import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { format, startOfMonth, addMonths, subMonths } from "date-fns";
import { TrendingUp, ChevronLeft, ChevronRight, Loader2, Check, Store } from "lucide-react";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useProjections } from "@/hooks/useProjections";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

// ── Debounced currency cell ────────────────────────────────────────────────────

function ProjectionCell({
  initialValue,
  onSave,
}: {
  initialValue: number;
  onSave: (value: number) => Promise<void>;
}) {
  const [localValue, setLocalValue] = useState(String(initialValue || ""));
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOnSave = useRef(onSave);
  latestOnSave.current = onSave;

  useEffect(() => {
    setLocalValue(initialValue ? String(initialValue) : "");
  }, [initialValue]);

  const debouncedSave = useCallback((val: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const num = parseFloat(val);
    if (val.trim() && isNaN(num)) return;
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await latestOnSave.current(val.trim() ? num : 0);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1500);
      } catch {
        setStatus("idle");
        toast.error("Failed to save projection");
      }
    }, 500);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setLocalValue(val);
    debouncedSave(val);
  }

  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
      <input
        type="number"
        min={0}
        step={50}
        value={localValue}
        onChange={handleChange}
        placeholder="0"
        className={cn(
          "w-full rounded-md border border-input bg-transparent pl-6 pr-7 py-1.5 text-sm",
          "text-foreground placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "tabular-nums"
        )}
      />
      {status === "saving" && (
        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
      )}
      {status === "saved" && (
        <Check className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-green-500" />
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function ProjectionsPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const periodMonth = format(month, "yyyy-MM-dd");

  const { data: restaurants = [], isLoading: restaurantsLoading } = useRestaurants();
  const restaurantIds = useMemo(() => restaurants.map((r) => r.id), [restaurants]);
  const { getProjection, upsert, isLoading } = useProjections(periodMonth, restaurantIds);

  const totals = useMemo(() => {
    return restaurants.reduce(
      (acc, r) => {
        const p = getProjection(r.id);
        acc.sales += p?.sales_projection ?? 0;
        acc.labour += p?.labour_projection ?? 0;
        acc.foodCost += p?.food_cost_projection ?? 0;
        return acc;
      },
      { sales: 0, labour: 0, foodCost: 0 }
    );
  }, [restaurants, getProjection]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Projections</h2>
        </div>

        {/* Month selector */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button
            onClick={() => setMonth((m) => subMonths(m, 1))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-32 text-center text-sm font-medium text-foreground">
            {format(month, "MMMM yyyy")}
          </span>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Enter expected sales, labour and food cost for each venue for {format(month, "MMMM yyyy")}.
        These feed budget-vs-actual comparisons elsewhere in the app.
      </p>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {restaurantsLoading || isLoading ? (
          <div className="p-12 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
          </div>
        ) : restaurants.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">No venues available.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Venue
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Sales Projection
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Labour Projection
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Food Cost Projection
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {restaurants.map((r) => {
                  const p = getProjection(r.id);
                  const sales = p?.sales_projection ?? 0;
                  const labour = p?.labour_projection ?? 0;
                  const foodCost = p?.food_cost_projection ?? 0;
                  const labourPct = sales > 0 ? (labour / sales) * 100 : null;
                  const foodCostPct = sales > 0 ? (foodCost / sales) * 100 : null;

                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2 pt-1.5">
                          <Store className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-foreground whitespace-nowrap">{r.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top w-56">
                        <ProjectionCell
                          initialValue={sales}
                          onSave={(val) => upsert({ restaurant_id: r.id, sales_projection: val })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top w-56">
                        <ProjectionCell
                          initialValue={labour}
                          onSave={(val) => upsert({ restaurant_id: r.id, labour_projection: val })}
                        />
                        {labourPct !== null && (
                          <p className="mt-1 pl-1 text-xs text-muted-foreground">
                            {formatPercent(labourPct)} of sales
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top w-56">
                        <ProjectionCell
                          initialValue={foodCost}
                          onSave={(val) => upsert({ restaurant_id: r.id, food_cost_projection: val })}
                        />
                        {foodCostPct !== null && (
                          <p className="mt-1 pl-1 text-xs text-muted-foreground">
                            {formatPercent(foodCostPct)} of sales
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {restaurants.length > 1 && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/30">
                    <td className="px-4 py-3 font-semibold text-foreground">Group Total</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-foreground">
                      {formatCurrency(totals.sales)}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-foreground">
                      {formatCurrency(totals.labour)}
                      {totals.sales > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({formatPercent((totals.labour / totals.sales) * 100)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-foreground">
                      {formatCurrency(totals.foodCost)}
                      {totals.sales > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({formatPercent((totals.foodCost / totals.sales) * 100)})
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
