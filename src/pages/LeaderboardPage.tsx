import { useState } from "react";
import { Trophy, Settings2, Loader2, X } from "lucide-react";
import { useLeaderboardData, useLeaderboardSettings } from "@/hooks/useLeaderboardData";
import LeaderboardTable from "@/components/leaderboard/LeaderboardTable";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { LeaderboardPeriod, LeaderboardWeights } from "@/hooks/useLeaderboardData";

// ── Period labels ─────────────────────────────────────────────────────────────

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "thisWeek", label: "This Week" },
  { value: "thisMonth", label: "This Month" },
  { value: "thisQuarter", label: "This Quarter" },
];

// ── Leaderboard Settings Panel ────────────────────────────────────────────────

function LeaderboardSettingsPanel({ onClose }: { onClose: () => void }) {
  const { weights, settings, updateWeights, updateSettings } =
    useLeaderboardSettings();

  const [localWeights, setLocalWeights] = useState<LeaderboardWeights>({
    ...weights,
  });
  const [allowManagerView, setAllowManagerView] = useState(
    settings.allow_manager_view
  );
  const [gracePeriod, setGracePeriod] = useState(
    String(settings.grace_period_days)
  );

  const activeMetrics: Array<{
    key: keyof LeaderboardWeights;
    label: string;
    enabled: boolean;
  }> = [
    { key: "sales", label: "Net Sales", enabled: true },
    { key: "labour", label: "Labour Cost %", enabled: true },
    { key: "rating", label: "Google Rating", enabled: true },
    { key: "transactions", label: "Transactions", enabled: true },
    { key: "food_cost", label: "Food Cost % (Phase 4)", enabled: false },
    { key: "waste", label: "Waste % (Phase 4)", enabled: false },
    { key: "whs", label: "WHS Audit (Phase 5)", enabled: false },
  ];

  const activeTotal = (["sales", "labour", "rating", "transactions"] as const).reduce(
    (s, k) => s + (localWeights[k] || 0),
    0
  );
  const totalOk = Math.abs(activeTotal - 100) < 0.01;

  async function handleSave() {
    if (!totalOk) {
      toast.error("Active metric weights must sum to 100%");
      return;
    }
    try {
      await updateWeights.mutateAsync(localWeights);
      await updateSettings.mutateAsync({
        allow_manager_view: allowManagerView,
        grace_period_days: parseInt(gracePeriod) || 30,
      });
      toast.success("Leaderboard settings saved");
      onClose();
    } catch {
      toast.error("Failed to save settings");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50">
      <div className="h-full w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Leaderboard Settings</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Metric weights */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-3">
              Metric Weights
            </h4>
            <div className="space-y-3">
              {activeMetrics.map(({ key, label, enabled }) => (
                <div key={key} className="flex items-center gap-3">
                  <label
                    className={cn(
                      "flex-1 text-sm",
                      enabled ? "text-foreground" : "text-muted-foreground/50"
                    )}
                  >
                    {label}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.25}
                      disabled={!enabled}
                      value={enabled ? localWeights[key] : 0}
                      onChange={(e) =>
                        setLocalWeights((prev) => ({
                          ...prev,
                          [key]: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className={cn(
                        "w-16 rounded-md border border-input bg-transparent px-2 py-1 text-sm tabular-nums text-right",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        !enabled && "opacity-40"
                      )}
                    />
                    <span className="text-xs text-muted-foreground w-3">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div
              className={cn(
                "mt-3 text-xs font-medium",
                totalOk ? "text-green-500" : "text-red-500"
              )}
            >
              Active total: {activeTotal.toFixed(2)}%
              {!totalOk && " (must equal 100%)"}
            </div>
          </div>

          {/* Visibility */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-3">
              Visibility
            </h4>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={allowManagerView}
                onChange={(e) => setAllowManagerView(e.target.checked)}
                className="h-4 w-4 rounded border border-input accent-primary"
              />
              <span className="text-sm text-foreground">
                Allow managers to see full leaderboard
              </span>
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Off = managers see only their own store's score.
            </p>
          </div>

          {/* Grace period */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-3">
              New Store Grace Period
            </h4>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={365}
                value={gracePeriod}
                onChange={(e) => setGracePeriod(e.target.value)}
                className="w-20 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              New stores are excluded from ranking for this many days.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!totalOk || updateWeights.isPending || updateSettings.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 flex items-center gap-1.5"
          >
            {(updateWeights.isPending || updateSettings.isPending) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("thisWeek");
  const [showSettings, setShowSettings] = useState(false);
  const { isSuperadmin } = usePermissions();

  const { data, isLoading } = useLeaderboardData(period);
  const rows = data?.rows ?? [];
  const weights = data?.weights ?? {
    sales: 31.25,
    labour: 25,
    rating: 25,
    transactions: 18.75,
    food_cost: 0,
    waste: 0,
    whs: 0,
  };

  return (
    <div className="space-y-6">
      {showSettings && (
        <LeaderboardSettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 mr-auto">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                period === p.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {isSuperadmin && (
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        )}
      </div>

      {/* ── Scoring note ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Scoring weights:</span>
          <span>Sales {weights.sales}%</span>
          <span>Labour {weights.labour}%</span>
          <span>Rating {weights.rating}%</span>
          <span>Transactions {weights.transactions}%</span>
          <span className="opacity-40">Food Cost — Phase 4</span>
          <span className="opacity-40">Waste — Phase 4</span>
          <span className="opacity-40">WHS — Phase 5</span>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <LeaderboardTable rows={rows} weights={weights} isLoading={isLoading} />
    </div>
  );
}
