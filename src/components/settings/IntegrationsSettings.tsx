import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plug,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { format } from "date-fns";
import type { IntegrationCredential, IntegrationSetting, SyncLog, Restaurant } from "@/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({
  status,
}: {
  status: "never" | "success" | "error" | "syncing" | string;
}) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500">
        <CheckCircle2 className="h-3.5 w-3.5" /> Connected
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
        <XCircle className="h-3.5 w-3.5" /> Error
      </span>
    );
  if (status === "syncing")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <AlertTriangle className="h-3.5 w-3.5" /> Not configured
    </span>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 items-center gap-4">
      <label className="text-sm font-medium text-foreground text-right">{label}</label>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

// ─── Collapsible section wrapper ─────────────────────────────────────────────

function Section({
  title,
  subtitle,
  statusEl,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  statusEl?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 hover:bg-muted/10 transition-colors"
      >
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-base font-semibold text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <div className="flex items-center gap-3">
          {statusEl}
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && <div className="border-t border-border px-6 py-5">{children}</div>}
    </div>
  );
}

// ─── Lightspeed per-restaurant card ──────────────────────────────────────────

function LightspeedCard({
  restaurant,
  credential,
  onSave,
  onSync,
  isSaving,
  isSyncing,
}: {
  restaurant: Restaurant;
  credential: IntegrationCredential | undefined;
  onSave: (restaurantId: string, creds: Record<string, string>, isManualOnly: boolean) => void;
  onSync: (restaurantId: string) => void;
  isSaving: boolean;
  isSyncing: boolean;
}) {
  const isManualOnly = credential?.is_manual_only ?? false;
  const [editing, setEditing] = useState(!credential || isManualOnly ? false : false);
  const [fields, setFields] = useState({
    account_id: (credential?.credentials?.account_id as string) ?? "",
    client_id: (credential?.credentials?.client_id as string) ?? "",
    client_secret: (credential?.credentials?.client_secret as string) ?? "",
    access_token: (credential?.credentials?.access_token as string) ?? "",
    refresh_token: (credential?.credentials?.refresh_token as string) ?? "",
  });

  const hasCredentials =
    !isManualOnly &&
    credential?.credentials?.account_id &&
    credential?.credentials?.access_token;

  if (isManualOnly) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{restaurant.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">No POS integration</p>
          </div>
          <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-500">
            Manual Entry Only
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{restaurant.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {credential?.last_sync_at
              ? `Last sync: ${format(new Date(credential.last_sync_at), "d MMM yyyy h:mm a")}`
              : "Never synced"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={credential?.sync_status ?? "never"} />
          {hasCredentials && (
            <button
              onClick={() => onSync(restaurant.id)}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              {isSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sync Now
            </button>
          )}
          <button
            onClick={() => setEditing((e) => !e)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {editing ? "Cancel" : hasCredentials ? "Edit" : "Connect"}
          </button>
        </div>
      </div>

      {credential?.sync_error && (
        <div className="flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {credential.sync_error}
        </div>
      )}

      {editing && (
        <div className="space-y-3 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Lightspeed O-Series OAuth credentials for {restaurant.name}. Each store has its own account.
          </p>
          <FieldRow label="Account ID">
            <input
              value={fields.account_id}
              onChange={(e) => setFields((f) => ({ ...f, account_id: e.target.value }))}
              placeholder="e.g. 12345678"
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </FieldRow>
          <FieldRow label="Client ID">
            <input
              value={fields.client_id}
              onChange={(e) => setFields((f) => ({ ...f, client_id: e.target.value }))}
              placeholder="Client ID"
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </FieldRow>
          <FieldRow label="Client Secret">
            <PasswordInput
              value={fields.client_secret}
              onChange={(v) => setFields((f) => ({ ...f, client_secret: v }))}
              placeholder="Client Secret"
            />
          </FieldRow>
          <FieldRow label="Access Token">
            <PasswordInput
              value={fields.access_token}
              onChange={(v) => setFields((f) => ({ ...f, access_token: v }))}
              placeholder="Access Token"
            />
          </FieldRow>
          <FieldRow label="Refresh Token">
            <PasswordInput
              value={fields.refresh_token}
              onChange={(v) => setFields((f) => ({ ...f, refresh_token: v }))}
              placeholder="Refresh Token"
            />
          </FieldRow>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={isSaving}
              onClick={() => {
                onSave(restaurant.id, fields, false);
                setEditing(false);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Credentials
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sync Logs Table ──────────────────────────────────────────────────────────

function SyncLogsTable({
  logs,
  restaurants,
  isLoading,
}: {
  logs: SyncLog[] | undefined;
  restaurants: Restaurant[] | undefined;
  isLoading: boolean;
}) {
  const providerLabel: Record<string, string> = {
    lightspeed: "Lightspeed",
    deputy: "Deputy",
    google_reviews: "Google Reviews",
    nightly_sync: "Nightly Sync",
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-base font-semibold">Sync Logs</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Recent sync history</p>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : !logs?.length ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <RefreshCw className="h-8 w-8 mb-2" />
          <p className="text-sm">No sync history yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Provider", "Restaurant", "Status", "Records", "Started", "Duration"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => {
                const restaurant = restaurants?.find((r) => r.id === log.restaurant_id);
                const duration =
                  log.completed_at
                    ? `${Math.round(
                        (new Date(log.completed_at).getTime() -
                          new Date(log.started_at).getTime()) /
                          1000
                      )}s`
                    : "—";
                return (
                  <tr key={log.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium">
                      {providerLabel[log.provider] ?? log.provider}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {restaurant?.name ?? (log.restaurant_id ? "Unknown" : "All")}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          log.status === "success" &&
                            "bg-green-500/10 text-green-500",
                          log.status === "error" && "bg-red-500/10 text-red-500",
                          log.status === "skipped" &&
                            "bg-muted/60 text-muted-foreground"
                        )}
                      >
                        {log.status}
                      </span>
                      {log.error_message && (
                        <p className="mt-0.5 text-xs text-red-500 max-w-xs truncate">
                          {log.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">{log.records_synced}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {format(new Date(log.started_at), "d MMM h:mm a")}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{duration}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function IntegrationsSettings() {
  const queryClient = useQueryClient();
  const { data: restaurants } = useRestaurants();

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: credentials } = useQuery({
    queryKey: ["integration-credentials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_credentials")
        .select("*")
        .order("provider");
      if (error) throw error;
      return data as IntegrationCredential[];
    },
  });

  const { data: globalSettings } = useQuery({
    queryKey: ["integration-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_settings")
        .select("*");
      if (error) throw error;
      return data as IntegrationSetting[];
    },
  });

  const { data: syncLogs, isLoading: logsLoading } = useQuery({
    queryKey: ["sync-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as SyncLog[];
    },
  });

  // ── Lightspeed mutations ──────────────────────────────────────────────────
  const [syncingRestaurant, setSyncingRestaurant] = useState<string | null>(null);

  const saveLightspeedMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      creds,
      isManualOnly,
    }: {
      restaurantId: string;
      creds: Record<string, string>;
      isManualOnly: boolean;
    }) => {
      const { error } = await supabase
        .from("integration_credentials")
        .upsert(
          {
            restaurant_id: restaurantId,
            provider: "lightspeed",
            credentials: creds,
            is_manual_only: isManualOnly,
            sync_status: "never",
          },
          { onConflict: "restaurant_id,provider" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lightspeed credentials saved");
      queryClient.invalidateQueries({ queryKey: ["integration-credentials"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncLightspeedMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      setSyncingRestaurant(restaurantId);
      const { data, error } = await supabase.functions.invoke(
        "sync-lightspeed-sales",
        { body: { restaurant_id: restaurantId } }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_, restaurantId) => {
      setSyncingRestaurant(null);
      toast.success("Lightspeed sync complete");
      queryClient.invalidateQueries({ queryKey: ["integration-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
      queryClient.invalidateQueries({
        queryKey: ["sales-report"],
      });
      // Re-enable for the specific restaurant
      void restaurantId;
    },
    onError: (e: Error) => {
      setSyncingRestaurant(null);
      toast.error(`Sync failed: ${e.message}`);
      queryClient.invalidateQueries({ queryKey: ["integration-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
    },
  });

  // ── Deputy mutations ──────────────────────────────────────────────────────
  const deputySetting = globalSettings?.find((s) => s.provider === "deputy");
  const [deputyFields, setDeputyFields] = useState({
    api_token: (deputySetting?.credentials?.api_token as string) ?? "",
    account_url: (deputySetting?.credentials?.account_url as string) ?? "",
  });
  const [deputyMapping, setDeputyMapping] = useState<
    { deputy_location_id: string; restaurant_id: string }[]
  >((deputySetting?.config?.location_mapping as { deputy_location_id: string; restaurant_id: string }[]) ?? [
    { deputy_location_id: "", restaurant_id: "" },
    { deputy_location_id: "", restaurant_id: "" },
  ]);

  const saveDeputyMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("integration_settings")
        .upsert(
          {
            provider: "deputy",
            credentials: {
              api_token: deputyFields.api_token,
              account_url: deputyFields.account_url,
            },
            config: {
              location_mapping: deputyMapping.filter(
                (m) => m.deputy_location_id && m.restaurant_id
              ),
            },
          },
          { onConflict: "provider" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deputy settings saved");
      queryClient.invalidateQueries({ queryKey: ["integration-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncDeputyMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-deputy-labour");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Deputy sync complete");
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: Error) => toast.error(`Sync failed: ${e.message}`),
  });

  // ── Google Business mutations ─────────────────────────────────────────────
  const googleSetting = globalSettings?.find((s) => s.provider === "google_business");
  const [googleFields, setGoogleFields] = useState({
    api_key: (googleSetting?.credentials?.api_key as string) ?? "",
    account_id: (googleSetting?.credentials?.account_id as string) ?? "",
  });

  const saveGoogleMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("integration_settings")
        .upsert(
          {
            provider: "google_business",
            credentials: {
              api_key: googleFields.api_key,
              account_id: googleFields.account_id,
            },
            config: {},
          },
          { onConflict: "provider" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Google Business settings saved");
      queryClient.invalidateQueries({ queryKey: ["integration-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncGoogleMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-google-reviews");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Google Reviews sync complete");
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: Error) => toast.error(`Sync failed: ${e.message}`),
  });

  // Helper to update a restaurant's google_place_id
  const updatePlaceIdMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      placeId,
    }: {
      restaurantId: string;
      placeId: string;
    }) => {
      const { error } = await supabase
        .from("restaurants")
        .update({ google_place_id: placeId || null })
        .eq("id", restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Place ID updated");
      queryClient.invalidateQueries({ queryKey: ["restaurants"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Deputy: overall status ────────────────────────────────────────────────
  const deputyStatus = deputySetting?.sync_status ?? "never";
  const googleStatus = googleSetting?.sync_status ?? "never";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Plug className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-xl font-semibold text-foreground">Integrations</h2>
          <p className="text-sm text-muted-foreground">
            Connect Lightspeed POS, Deputy rostering, and Google Business for automated sync.
          </p>
        </div>
      </div>

      {/* ── Lightspeed O-Series ───────────────────────────────────────────── */}
      <Section
        title="Lightspeed O-Series"
        subtitle="Per-restaurant POS integration — each store has its own account"
        defaultOpen={true}
      >
        <div className="space-y-3">
          {restaurants?.map((restaurant) => {
            const credential = credentials?.find(
              (c) => c.restaurant_id === restaurant.id && c.provider === "lightspeed"
            );
            return (
              <LightspeedCard
                key={restaurant.id}
                restaurant={restaurant}
                credential={credential}
                onSave={(id, creds, isManualOnly) =>
                  saveLightspeedMutation.mutate({
                    restaurantId: id,
                    creds,
                    isManualOnly,
                  })
                }
                onSync={(id) => syncLightspeedMutation.mutate(id)}
                isSaving={saveLightspeedMutation.isPending}
                isSyncing={syncingRestaurant === restaurant.id && syncLightspeedMutation.isPending}
              />
            );
          })}
          <p className="text-xs text-muted-foreground pt-1">
            For OAuth V1: paste tokens manually. Refresh tokens are auto-renewed on each sync run.
          </p>
        </div>
      </Section>

      {/* ── Deputy ───────────────────────────────────────────────────────── */}
      <Section
        title="Deputy"
        subtitle="Single account — Geelong West and Torquay only. GMHBA not on Deputy."
        statusEl={<StatusBadge status={deputyStatus} />}
      >
        <div className="space-y-5">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Global Credentials</h4>
            <FieldRow label="API Token">
              <PasswordInput
                value={deputyFields.api_token}
                onChange={(v) => setDeputyFields((f) => ({ ...f, api_token: v }))}
                placeholder="Deputy API Token"
              />
            </FieldRow>
            <FieldRow label="Account URL">
              <input
                value={deputyFields.account_url}
                onChange={(e) =>
                  setDeputyFields((f) => ({ ...f, account_url: e.target.value }))
                }
                placeholder="e.g. https://yourbusiness.au.deputy.com"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </FieldRow>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">
              Location → Restaurant Mapping
            </h4>
            <p className="text-xs text-muted-foreground">
              Map Deputy location IDs to your restaurants. Find location IDs in Deputy under
              Business Setup → Locations.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Deputy Location ID
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Restaurant
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deputyMapping.map((row, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">
                        <input
                          value={row.deputy_location_id}
                          onChange={(e) => {
                            const next = [...deputyMapping];
                            next[i] = { ...next[i], deputy_location_id: e.target.value };
                            setDeputyMapping(next);
                          }}
                          placeholder="e.g. 1"
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={row.restaurant_id}
                          onChange={(e) => {
                            const next = [...deputyMapping];
                            next[i] = { ...next[i], restaurant_id: e.target.value };
                            setDeputyMapping(next);
                          }}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">Select restaurant…</option>
                          {restaurants?.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() =>
                setDeputyMapping((m) => [...m, { deputy_location_id: "", restaurant_id: "" }])
              }
              className="text-xs text-primary hover:underline"
            >
              + Add row
            </button>
          </div>

          {deputySetting?.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Last sync:{" "}
              {format(new Date(deputySetting.last_sync_at), "d MMM yyyy h:mm a")}
            </p>
          )}
          {deputySetting?.sync_error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {deputySetting.sync_error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => syncDeputyMutation.mutate()}
              disabled={syncDeputyMutation.isPending || !deputySetting}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {syncDeputyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync Now
            </button>
            <button
              onClick={() => saveDeputyMutation.mutate()}
              disabled={saveDeputyMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saveDeputyMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save Settings
            </button>
          </div>
        </div>
      </Section>

      {/* ── Google Business ───────────────────────────────────────────────── */}
      <Section
        title="Google Business Profile"
        subtitle="One account managing all 3 store listings"
        statusEl={<StatusBadge status={googleStatus} />}
      >
        <div className="space-y-5">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Global Credentials</h4>
            <FieldRow label="API Key">
              <PasswordInput
                value={googleFields.api_key}
                onChange={(v) => setGoogleFields((f) => ({ ...f, api_key: v }))}
                placeholder="Google API Key"
              />
            </FieldRow>
            <FieldRow label="Account ID">
              <input
                value={googleFields.account_id}
                onChange={(e) =>
                  setGoogleFields((f) => ({ ...f, account_id: e.target.value }))
                }
                placeholder="e.g. accounts/123456789"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </FieldRow>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Place ID Mapping</h4>
            <p className="text-xs text-muted-foreground">
              Google Place IDs for each restaurant. Find them at{" "}
              <span className="font-mono text-foreground">
                developers.google.com/maps/documentation/places
              </span>
              .
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Restaurant
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Google Place ID
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {restaurants?.map((r) => (
                    <PlaceIdRow
                      key={r.id}
                      restaurant={r}
                      onSave={(placeId) =>
                        updatePlaceIdMutation.mutate({ restaurantId: r.id, placeId })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {googleSetting?.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Last sync:{" "}
              {format(new Date(googleSetting.last_sync_at), "d MMM yyyy h:mm a")}
            </p>
          )}
          {googleSetting?.sync_error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {googleSetting.sync_error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => syncGoogleMutation.mutate()}
              disabled={syncGoogleMutation.isPending || !googleSetting}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {syncGoogleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync Now
            </button>
            <button
              onClick={() => saveGoogleMutation.mutate()}
              disabled={saveGoogleMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saveGoogleMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save Settings
            </button>
          </div>
        </div>
      </Section>

      {/* ── Sync Logs ─────────────────────────────────────────────────────── */}
      <SyncLogsTable logs={syncLogs} restaurants={restaurants} isLoading={logsLoading} />
    </div>
  );
}

// ─── Place ID inline-edit row ─────────────────────────────────────────────────

function PlaceIdRow({
  restaurant,
  onSave,
}: {
  restaurant: Restaurant;
  onSave: (placeId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(restaurant.google_place_id ?? "");

  return (
    <tr>
      <td className="px-4 py-2 text-sm font-medium">{restaurant.name}</td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="ChIJ…"
              className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
            <button
              onClick={() => {
                onSave(value);
                setEditing(false);
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {restaurant.google_place_id ?? "—"}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-primary hover:underline"
            >
              {restaurant.google_place_id ? "Edit" : "Add"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

