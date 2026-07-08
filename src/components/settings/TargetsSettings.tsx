import { useState, useEffect, useRef, useCallback } from "react";
import { Target, Copy, Check, Loader2, ChevronDown } from "lucide-react";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useTargets, TARGET_METRICS, DAY_LABELS } from "@/hooks/useTargets";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Restaurant } from "@/types";

// ── Debounced save cell ───────────────────────────────────────────────────────

interface SaveCellProps {
  initialValue: number | null;
  onSave: (value: number) => Promise<void>;
  type: "currency" | "percent" | "number" | "rating";
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

function SaveCell({
  initialValue,
  onSave,
  type,
  placeholder = "—",
  min = 0,
  max,
  step,
}: SaveCellProps) {
  const [localValue, setLocalValue] = useState(
    initialValue !== null ? String(initialValue) : ""
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOnSave = useRef(onSave);
  latestOnSave.current = onSave;

  useEffect(() => {
    setLocalValue(initialValue !== null ? String(initialValue) : "");
  }, [initialValue]);

  const debouncedSave = useCallback((val: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const num = parseFloat(val);
    if (!val.trim() || isNaN(num)) return;
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await latestOnSave.current(num);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1500);
      } catch {
        setStatus("idle");
        toast.error("Failed to save target");
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
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? (type === "rating" ? 0.1 : type === "currency" ? 50 : 1)}
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm",
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

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-2.5">
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Day-of-week grid ──────────────────────────────────────────────────────────

function DowGrid({
  metric,
  restaurantId,
  getVal,
  onSave,
  type,
}: {
  metric: string;
  restaurantId: string;
  getVal: (dow: number) => number | null;
  onSave: (dow: number, val: number) => Promise<void>;
  type: "currency" | "number";
}) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {DAY_LABELS.map((day, i) => (
        <div key={day} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground text-center font-medium">
            {day}
          </span>
          <SaveCell
            key={`${metric}-${restaurantId}-${i}`}
            initialValue={getVal(i)}
            onSave={(val) => onSave(i, val)}
            type={type}
            min={0}
          />
        </div>
      ))}
    </div>
  );
}

// ── Copy-to dialog ────────────────────────────────────────────────────────────

function CopyToDialog({
  restaurants,
  sourceRestaurantId,
  onCopy,
  onClose,
  copying,
}: {
  restaurants: Restaurant[];
  sourceRestaurantId: string;
  onCopy: (ids: string[]) => void;
  onClose: () => void;
  copying: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const others = restaurants.filter((r) => r.id !== sourceRestaurantId);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 className="font-semibold text-card-foreground mb-1">Copy targets to…</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Overwrites existing targets for selected restaurants.
        </p>
        <div className="space-y-2 mb-4">
          {others.map((r) => (
            <label
              key={r.id}
              className="flex items-center gap-2.5 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
                className="h-4 w-4 rounded border border-input accent-primary"
              />
              <span className="text-sm text-foreground">{r.name}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={selected.size === 0 || copying}
            onClick={() => onCopy([...selected])}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 flex items-center gap-1.5"
          >
            {copying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Copy to {selected.size > 0 ? selected.size : ""} store
            {selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Restaurant targets section ────────────────────────────────────────────────

function RestaurantTargets({ restaurant }: { restaurant: Restaurant }) {
  const [showCopy, setShowCopy] = useState(false);
  const { data: restaurants = [] } = useRestaurants();
  const {
    getDailySalesTarget,
    getWeeklySalesTarget,
    getLabourCostTarget,
    getTransactionTarget,
    getAvgTransactionTarget,
    getGoogleRatingTarget,
    getReviewVolumeTarget,
    getRosterHoursBudget,
    upsert,
    copyTo,
    isCopying,
  } = useTargets(restaurant.id);

  async function save(metric: string, value: number, dow?: number | null) {
    await upsert({
      restaurant_id: restaurant.id,
      metric,
      period: "current",
      day_of_week: dow ?? null,
      value,
    });
  }

  async function handleCopy(destIds: string[]) {
    try {
      await copyTo(destIds);
      toast.success(
        `Targets copied to ${destIds.length} store${destIds.length !== 1 ? "s" : ""}`
      );
      setShowCopy(false);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <>
      {showCopy && (
        <CopyToDialog
          restaurants={restaurants}
          sourceRestaurantId={restaurant.id}
          onCopy={handleCopy}
          onClose={() => setShowCopy(false)}
          copying={isCopying}
        />
      )}

      <div className="space-y-3">
        {/* A. Daily Sales Target */}
        <SectionCard title="A. Daily Sales Target">
          <DowGrid
            metric={TARGET_METRICS.DAILY_SALES}
            restaurantId={restaurant.id}
            getVal={getDailySalesTarget}
            onSave={(dow, val) => save(TARGET_METRICS.DAILY_SALES, val, dow)}
            type="currency"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Per-day sales targets used by Pulse Report and Alerts.
          </p>
        </SectionCard>

        {/* B. Weekly Sales Target */}
        <SectionCard title="B. Weekly Sales Target">
          <div className="flex items-center gap-4">
            <div className="w-36">
              <SaveCell
                initialValue={getWeeklySalesTarget()}
                onSave={(val) => save(TARGET_METRICS.WEEKLY_SALES, val)}
                type="currency"
                min={0}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Used for Leaderboard scoring. Auto-calculated from daily targets
              when not set.
            </p>
          </div>
        </SectionCard>

        {/* C. Labour Cost % */}
        <SectionCard title="C. Labour Cost % Target">
          <div className="flex items-center gap-4">
            <div className="w-28">
              <SaveCell
                initialValue={getLabourCostTarget()}
                onSave={(val) => save(TARGET_METRICS.LABOUR_COST_PCT, val)}
                type="percent"
                min={0}
                max={100}
                step={0.5}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Green = below target. Amber = target to target+5%. Red = above target+5%.
            </p>
          </div>
        </SectionCard>

        {/* D. Transaction Count */}
        <SectionCard title="D. Transaction Count Target (per day)">
          <DowGrid
            metric={TARGET_METRICS.TRANSACTION_COUNT}
            restaurantId={restaurant.id}
            getVal={getTransactionTarget}
            onSave={(dow, val) => save(TARGET_METRICS.TRANSACTION_COUNT, val, dow)}
            type="number"
          />
        </SectionCard>

        {/* E. Avg Transaction Value */}
        <SectionCard title="E. Avg Transaction Value Target">
          <div className="flex items-center gap-4">
            <div className="w-32">
              <SaveCell
                initialValue={getAvgTransactionTarget()}
                onSave={(val) => save(TARGET_METRICS.AVG_TRANSACTION, val)}
                type="currency"
                min={0}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Green ≥ 100%, Amber 90–99%, Red &lt;90%.
            </p>
          </div>
        </SectionCard>

        {/* F. Google Rating */}
        <SectionCard title="F. Google Rating Target">
          <div className="flex items-center gap-4">
            <div className="w-24">
              <SaveCell
                initialValue={getGoogleRatingTarget()}
                onSave={(val) => save(TARGET_METRICS.GOOGLE_RATING, val)}
                type="rating"
                min={0}
                max={5}
                step={0.1}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              30-day average. Amber = target−0.5 to target. Red = below target−0.5.
            </p>
          </div>
        </SectionCard>

        {/* G. Review Volume */}
        <SectionCard title="G. Review Volume Target (monthly)">
          <div className="flex items-center gap-4">
            <div className="w-24">
              <SaveCell
                initialValue={getReviewVolumeTarget()}
                onSave={(val) => save(TARGET_METRICS.REVIEW_VOLUME, val)}
                type="number"
                min={0}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              New Google reviews per month. Amber = 75–99% of target.
            </p>
          </div>
        </SectionCard>

        {/* H. Roster Hours Budget */}
        <SectionCard title="H. Roster Hours Budget (per day)">
          <DowGrid
            metric={TARGET_METRICS.ROSTER_HOURS}
            restaurantId={restaurant.id}
            getVal={getRosterHoursBudget}
            onSave={(dow, val) => save(TARGET_METRICS.ROSTER_HOURS, val, dow)}
            type="number"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Scheduled hours budget per day. Green ≤ 100%, Amber 100–110%, Red &gt;110%.
          </p>
        </SectionCard>

        {restaurants.length > 1 && (
          <div className="flex justify-end pt-1">
            <button
              onClick={() => setShowCopy(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy targets to another store…
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TargetsSettings() {
  const { data: restaurants = [], isLoading } = useRestaurants();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (restaurants.length > 0 && expandedId === null) {
      setExpandedId(restaurants[0].id);
    }
  }, [restaurants, expandedId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-1">
          <Target className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Targets</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Set KPI targets per restaurant. All values auto-save 500ms after you
          stop typing — look for the{" "}
          <Check className="inline h-3 w-3 text-green-500" /> indicator.
        </p>
      </div>

      {restaurants.map((restaurant) => (
        <div
          key={restaurant.id}
          className="rounded-xl border border-border bg-card overflow-hidden"
        >
          <button
            onClick={() =>
              setExpandedId(expandedId === restaurant.id ? null : restaurant.id)
            }
            className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
          >
            <div>
              <p className="font-semibold text-card-foreground">{restaurant.name}</p>
              <p className="text-xs text-muted-foreground">{restaurant.address}</p>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
                expandedId === restaurant.id && "rotate-180"
              )}
            />
          </button>

          {expandedId === restaurant.id && (
            <div className="border-t border-border px-5 py-5">
              <RestaurantTargets restaurant={restaurant} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
