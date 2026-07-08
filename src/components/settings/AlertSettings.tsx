import { useState } from "react";
import {
  Bell,
  ChevronDown,
  Loader2,
  Check,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { AlertConfig, AlertHistory, Profile } from "@/types";

// ── Alert type metadata ───────────────────────────────────────────────────────

const ALERT_TYPES = [
  {
    id: "sales_dip",
    label: "Sales Dip",
    description: "Net sales fall below a percentage of daily target.",
    thresholdLabel: "% of target",
    thresholdKey: "percentage",
    severity: "warning" as const,
    frequency: "After nightly sync",
    enabled: true,
  },
  {
    id: "labour_spike",
    label: "Labour Spike",
    description: "Labour cost percentage exceeds threshold.",
    thresholdLabel: "% labour cost",
    thresholdKey: "percentage",
    severity: "warning" as const,
    frequency: "After nightly sync",
    enabled: true,
  },
  {
    id: "bad_review",
    label: "Bad Review",
    description: "A new Google review is posted at or below the star threshold.",
    thresholdLabel: "stars or below",
    thresholdKey: "stars",
    severity: "urgent" as const,
    frequency: "After review sync (4hr)",
    enabled: true,
  },
  {
    id: "overtime_warning",
    label: "Overtime Warning",
    description: "Total weekly hours exceed the threshold for any employee.",
    thresholdLabel: "hrs/week",
    thresholdKey: "hours",
    severity: "warning" as const,
    frequency: "After nightly sync",
    enabled: true,
  },
  {
    id: "low_transactions",
    label: "Low Transactions",
    description: "Transaction count falls below a percentage of daily target.",
    thresholdLabel: "% of target",
    thresholdKey: "percentage",
    severity: "warning" as const,
    frequency: "After nightly sync",
    enabled: true,
  },
  {
    id: "missing_deposit",
    label: "Missing Deposit",
    description: "No cash deposit recorded within the specified number of business days.",
    thresholdLabel: "business days",
    thresholdKey: "business_days",
    severity: "warning" as const,
    frequency: "Daily 10am AEST",
    enabled: true,
  },
  {
    id: "overdue_whs_audit",
    label: "Overdue WHS Audit",
    description: "WHS audit is overdue. (Phase 5)",
    thresholdLabel: "days overdue",
    thresholdKey: "days_overdue",
    severity: "warning" as const,
    frequency: "Phase 5 — disabled",
    enabled: false,
  },
  {
    id: "serious_incident",
    label: "Serious Incident",
    description: "A notifiable incident is recorded. (Phase 5)",
    thresholdLabel: "severity level",
    thresholdKey: "severity",
    severity: "urgent" as const,
    frequency: "Phase 5 — disabled",
    enabled: false,
  },
] as const;

// ── Severity badges ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: "warning" | "urgent" | "critical" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        severity === "urgent" && "bg-red-500/10 text-red-500",
        severity === "warning" && "bg-amber-500/10 text-amber-500",
        severity === "critical" && "bg-red-700/10 text-red-700"
      )}
    >
      {severity}
    </span>
  );
}

// ── Alert config card ─────────────────────────────────────────────────────────

function AlertConfigCard({
  typeMeta,
  config,
  restaurants,
  profiles,
  onUpdate,
  updating,
}: {
  typeMeta: (typeof ALERT_TYPES)[number];
  config: AlertConfig | undefined;
  restaurants: { id: string; name: string }[];
  profiles: Profile[];
  onUpdate: (
    alertType: string,
    patch: Partial<{
      enabled: boolean;
      global_threshold: Record<string, unknown>;
      restaurant_overrides: Record<string, Record<string, unknown>>;
      recipients: string[];
    }>
  ) => Promise<void>;
  updating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPhaseDisabled = !typeMeta.enabled;

  const enabled = config?.enabled ?? false;
  const globalThreshold = config?.global_threshold ?? {};
  const overrides = config?.restaurant_overrides ?? {};
  const recipients = config?.recipients ?? [];

  const thresholdValue = globalThreshold[typeMeta.thresholdKey] as
    | number
    | string
    | undefined;

  async function toggleEnabled() {
    await onUpdate(typeMeta.id, { enabled: !enabled });
  }

  async function handleThresholdChange(val: string) {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    await onUpdate(typeMeta.id, {
      global_threshold: { ...globalThreshold, [typeMeta.thresholdKey]: num },
    });
  }

  async function handleRestaurantOverride(
    restaurantId: string,
    val: string
  ) {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const newOverrides = {
      ...overrides,
      [restaurantId]: { [typeMeta.thresholdKey]: num },
    };
    await onUpdate(typeMeta.id, { restaurant_overrides: newOverrides });
  }

  async function toggleRecipient(userId: string) {
    const current = new Set(recipients);
    if (current.has(userId)) current.delete(userId);
    else current.add(userId);
    await onUpdate(typeMeta.id, { recipients: [...current] });
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        isPhaseDisabled && "opacity-50"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4">
        {/* Toggle */}
        <button
          disabled={isPhaseDisabled || updating}
          onClick={toggleEnabled}
          className={cn(
            "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            enabled && !isPhaseDisabled
              ? "bg-primary"
              : "bg-muted",
            (isPhaseDisabled || updating) && "cursor-not-allowed opacity-60"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform",
              enabled && !isPhaseDisabled ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-card-foreground">{typeMeta.label}</p>
            <SeverityBadge severity={typeMeta.severity} />
            {isPhaseDisabled && (
              <span className="text-xs text-muted-foreground">Phase 5</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{typeMeta.description}</p>
        </div>

        {/* Threshold quick view */}
        {!isPhaseDisabled && (
          <div className="hidden sm:flex items-center gap-1.5 text-sm">
            <span className="tabular-nums font-semibold text-foreground">
              {thresholdValue ?? "—"}
            </span>
            <span className="text-muted-foreground text-xs">
              {typeMeta.thresholdLabel}
            </span>
          </div>
        )}

        <span className="text-xs text-muted-foreground hidden md:block whitespace-nowrap">
          {typeMeta.frequency}
        </span>

        {!isPhaseDisabled && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                expanded && "rotate-180"
              )}
            />
          </button>
        )}
      </div>

      {/* Expanded config */}
      {expanded && !isPhaseDisabled && (
        <div className="border-t border-border px-5 py-4 space-y-5 bg-muted/20">
          {/* Global threshold */}
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1.5">
              Global Threshold
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                defaultValue={String(thresholdValue ?? "")}
                min={0}
                onBlur={(e) => handleThresholdChange(e.target.value)}
                className="w-24 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring tabular-nums"
              />
              <span className="text-sm text-muted-foreground">
                {typeMeta.thresholdLabel}
              </span>
            </div>
          </div>

          {/* Per-restaurant overrides */}
          {restaurants.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">
                Per-Restaurant Overrides
                <span className="ml-1.5 text-muted-foreground font-normal">
                  (leave blank to use global)
                </span>
              </label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {restaurants.map((r) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <span className="text-xs text-foreground truncate flex-1 min-w-0">
                      {r.name.replace("Pollo ", "")}
                    </span>
                    <input
                      type="number"
                      defaultValue={
                        overrides[r.id]?.[typeMeta.thresholdKey] !== undefined
                          ? String(overrides[r.id][typeMeta.thresholdKey])
                          : ""
                      }
                      min={0}
                      placeholder={String(thresholdValue ?? "global")}
                      onBlur={(e) =>
                        handleRestaurantOverride(r.id, e.target.value)
                      }
                      className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring tabular-nums"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recipients */}
          {profiles.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5">
                Email Recipients
              </label>
              <div className="space-y-1.5">
                {profiles.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={recipients.includes(p.id)}
                      onChange={() => toggleRecipient(p.id)}
                      className="h-3.5 w-3.5 rounded border border-input accent-primary"
                    />
                    <span className="text-xs text-foreground">
                      {p.full_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.email}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize ml-auto">
                      {p.role.replace("_", " ")}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Alert history table ───────────────────────────────────────────────────────

function AlertHistoryTable() {
  const queryClient = useQueryClient();

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["alert-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_history")
        .select("*, restaurant:restaurants(name)")
        .order("triggered_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as (AlertHistory & { restaurant?: { name: string } })[];
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alert_history")
        .update({
          acknowledged: true,
          acknowledged_by: user?.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-history"] });
      queryClient.invalidateQueries({ queryKey: ["alert-history-unack"] });
    },
  });

  const bulkAcknowledgeMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alert_history")
        .update({
          acknowledged: true,
          acknowledged_by: user?.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("acknowledged", false);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All alerts acknowledged");
      queryClient.invalidateQueries({ queryKey: ["alert-history"] });
      queryClient.invalidateQueries({ queryKey: ["alert-history-unack"] });
    },
  });

  const unacknowledged = history.filter((h) => !h.acknowledged);

  const typeMeta = (alertType: string) =>
    ALERT_TYPES.find((t) => t.id === alertType);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-card-foreground">
          Alert History
          {unacknowledged.length > 0 && (
            <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500">
              {unacknowledged.length} unacknowledged
            </span>
          )}
        </h3>
        {unacknowledged.length > 0 && (
          <button
            onClick={() => bulkAcknowledgeMutation.mutate()}
            disabled={bulkAcknowledgeMutation.isPending}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            {bulkAcknowledgeMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            Acknowledge all
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
          <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No alerts triggered yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="hidden sm:grid grid-cols-[120px_1fr_120px_100px_80px_100px] gap-3 px-5 py-2.5 border-b border-border bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground">Date</span>
            <span className="text-xs font-semibold text-muted-foreground">Alert</span>
            <span className="text-xs font-semibold text-muted-foreground">Store</span>
            <span className="text-xs font-semibold text-muted-foreground">Value</span>
            <span className="text-xs font-semibold text-muted-foreground">Severity</span>
            <span className="text-xs font-semibold text-muted-foreground">Status</span>
          </div>

          {history.map((row) => {
            const meta = typeMeta(row.alert_type);
            return (
              <div
                key={row.id}
                className={cn(
                  "border-b border-border last:border-0 px-5 py-3.5",
                  !row.acknowledged && "bg-amber-500/5"
                )}
              >
                {/* Mobile */}
                <div className="sm:hidden space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {row.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(row as AlertHistory & { restaurant?: { name: string } }).restaurant?.name}
                      </p>
                    </div>
                    <SeverityBadge severity={row.severity} />
                  </div>
                  <p className="text-xs text-muted-foreground">{row.message}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(row.triggered_at), "d MMM HH:mm")}
                    </span>
                    {!row.acknowledged ? (
                      <button
                        onClick={() => acknowledgeMutation.mutate(row.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <span className="text-xs text-green-500 flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        Acknowledged
                      </span>
                    )}
                  </div>
                </div>

                {/* Desktop */}
                <div className="hidden sm:grid grid-cols-[120px_1fr_120px_100px_80px_100px] gap-3 items-center">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format(new Date(row.triggered_at), "d MMM HH:mm")}
                  </span>
                  <div>
                    <p className="text-sm text-foreground">{row.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{row.message}</p>
                  </div>
                  <span className="text-xs text-foreground truncate">
                    {(row as AlertHistory & { restaurant?: { name: string } }).restaurant?.name?.replace("Pollo ", "") ?? "—"}
                  </span>
                  <span className="text-xs tabular-nums text-foreground">
                    {row.metric_value !== null
                      ? `${row.metric_value}${meta?.thresholdLabel ? " " + meta.thresholdLabel : ""}`
                      : "—"}
                  </span>
                  <SeverityBadge severity={row.severity} />
                  <div>
                    {!row.acknowledged ? (
                      <button
                        onClick={() => acknowledgeMutation.mutate(row.id)}
                        disabled={acknowledgeMutation.isPending}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <Clock className="h-3 w-3" />
                        Ack
                      </button>
                    ) : (
                      <span className="text-xs text-green-500 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Done
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AlertSettings() {
  const queryClient = useQueryClient();
  const { data: restaurants = [] } = useRestaurants();

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["alert-configs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_configs")
        .select("*")
        .order("alert_type");
      if (error) throw error;
      return data as AlertConfig[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      alertType,
      patch,
    }: {
      alertType: string;
      patch: Partial<AlertConfig>;
    }) => {
      const { error } = await supabase
        .from("alert_configs")
        .upsert(
          { alert_type: alertType, ...patch },
          { onConflict: "alert_type" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-configs"] });
    },
    onError: () => {
      toast.error("Failed to update alert configuration");
    },
  });

  async function handleUpdate(
    alertType: string,
    patch: Partial<AlertConfig>
  ) {
    await updateMutation.mutateAsync({ alertType, patch });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const configMap = Object.fromEntries(
    configs.map((c) => [c.alert_type, c])
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-1">
          <Bell className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Alerts</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure automated alerts and email notifications. Toggle each alert,
          set thresholds, and choose recipients. Per-restaurant overrides take
          precedence over global settings.
        </p>
      </div>

      {/* Alert config cards */}
      <div className="space-y-3">
        {ALERT_TYPES.map((typeMeta) => (
          <AlertConfigCard
            key={typeMeta.id}
            typeMeta={typeMeta}
            config={configMap[typeMeta.id]}
            restaurants={restaurants}
            profiles={profiles}
            onUpdate={handleUpdate}
            updating={updateMutation.isPending}
          />
        ))}
      </div>

      {/* Alert history */}
      <AlertHistoryTable />
    </div>
  );
}
