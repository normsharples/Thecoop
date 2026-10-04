import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, RefreshCw, XCircle, AlertTriangle, CheckCircle2, History } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { IntegrationCredential, Restaurant } from "@/types";

// ============================================================================
// SQUARE POS — per venue
// ----------------------------------------------------------------------------
// Paste a Square access token → pick the Square location that is this venue →
// save. Sales then flow into the same tables as Lightspeed, so every report
// works. Several venues can share one token (one Square account, many
// locations) — just pick a different location for each.
// Server side: supabase/functions/sync-square.
// ============================================================================

interface SquareCreds {
  access_token?: string;
  environment?: "production" | "sandbox";
  location_id?: string;
  location_name?: string;
  timezone?: string;
}

interface SquareLocation {
  id: string;
  name: string;
  timezone: string;
  status: string;
  address: string;
}

async function invokeSquare<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sync-square", { body });
  if (error) {
    let msg = error.message;
    try {
      const b = await (error as { context?: Response }).context?.json();
      if (b?.error) msg = b.error;
      else if (b?.venues?.[0]?.error) msg = b.venues[0].error;
    } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

const STATUS_STYLE: Record<string, string> = {
  success: "bg-success-soft text-success",
  error: "bg-destructive-soft text-destructive",
  syncing: "bg-primary-soft text-primary",
  never: "bg-surface-sunken text-muted-foreground",
};

export function SquareVenueCard({
  restaurant,
  credential,
  hasLightspeed,
}: {
  restaurant: Restaurant;
  credential: IntegrationCredential | undefined;
  /** Venue already has Lightspeed credentials — both would write sales_daily. */
  hasLightspeed: boolean;
}) {
  const queryClient = useQueryClient();
  const saved = (credential?.credentials ?? {}) as SquareCreds;
  const connected = !!saved.access_token && !!saved.location_id;

  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">(saved.environment ?? "production");
  const [locations, setLocations] = useState<SquareLocation[] | null>(null);
  const [locationId, setLocationId] = useState(saved.location_id ?? "");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["integration-credentials"] });
    queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
  };

  const findLocations = useMutation({
    mutationFn: () =>
      invokeSquare<{ locations: SquareLocation[] }>({
        action: "locations",
        environment,
        ...(token.trim() ? { access_token: token.trim() } : { restaurant_id: restaurant.id }),
      }),
    onSuccess: (r) => {
      setLocations(r.locations);
      if (r.locations.length === 1) setLocationId(r.locations[0].id);
      if (!r.locations.length) toast.error("That token can't see any Square locations");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const loc = locations?.find((l) => l.id === locationId);
      const creds: SquareCreds = {
        access_token: token.trim() || saved.access_token,
        environment,
        location_id: locationId,
        location_name: loc?.name ?? saved.location_name,
        timezone: loc?.timezone ?? saved.timezone ?? "Australia/Melbourne",
      };
      if (!creds.access_token) throw new Error("Paste the Square access token");
      if (!creds.location_id) throw new Error("Pick the Square location for this venue");
      const { error } = await supabase.from("integration_credentials").upsert(
        {
          restaurant_id: restaurant.id,
          provider: "square",
          credentials: creds,
          is_manual_only: false,
          sync_status: "never",
          sync_error: null,
        },
        { onConflict: "restaurant_id,provider" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${restaurant.name} connected to Square — pulling the last 30 days…`);
      setEditing(false);
      setToken("");
      refresh();
      sync.mutate(30);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: (days?: number) =>
      invokeSquare<{ venues: { days?: { orders: number }[]; error?: string }[] }>({
        action: "sync",
        restaurant_id: restaurant.id,
        ...(days ? { days } : {}),
      }),
    onSuccess: (r) => {
      const v = r.venues?.[0];
      if (v?.error) toast.error(v.error);
      else {
        const orders = (v?.days ?? []).reduce((s, d) => s + d.orders, 0);
        toast.success(`Square synced — ${orders} order${orders === 1 ? "" : "s"}`);
      }
      refresh();
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => {
      toast.error(`Square sync failed: ${e.message}`);
      refresh();
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!credential) return;
      const { error } = await supabase.from("integration_credentials").delete().eq("id", credential.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${restaurant.name} disconnected from Square`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = credential?.sync_status ?? "never";

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{restaurant.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {connected
              ? `${saved.location_name ?? saved.location_id}${saved.environment === "sandbox" ? " (sandbox)" : ""} · ${
                  credential?.last_sync_at ? `Last sync ${format(new Date(credential.last_sync_at), "d MMM, h:mm a")}` : "Never synced"
                }`
              : "Not connected"}
          </p>
        </div>
        {connected && (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
            {status === "success" && <CheckCircle2 className="h-3 w-3" />}
            {status === "error" && <XCircle className="h-3 w-3" />}
            {status === "syncing" && <Loader2 className="h-3 w-3 animate-spin" />}
            {status === "never" ? "Not synced" : status[0].toUpperCase() + status.slice(1)}
          </span>
        )}
        {connected && !editing && (
          <>
            <Button size="sm" variant="outline" onClick={() => sync.mutate(undefined)} disabled={sync.isPending}>
              {sync.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Sync now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => sync.mutate(62)} disabled={sync.isPending} title="Re-pull the last 62 days">
              <History className="h-3.5 w-3.5 mr-1.5" />
              Backfill
            </Button>
          </>
        )}
        <Button size="sm" variant={connected ? "ghost" : "default"} onClick={() => setEditing((e) => !e)}>
          {editing ? "Cancel" : connected ? "Edit" : "Connect"}
        </Button>
      </div>

      {hasLightspeed && (
        <div className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          This venue also has Lightspeed set up. Only connect one POS per venue, or the two will overwrite each other's daily sales.
        </div>
      )}

      {credential?.sync_error && !editing && (
        <div className="flex items-start gap-2 rounded-md bg-destructive-soft px-3 py-2 text-xs text-destructive">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {credential.sync_error}
        </div>
      )}

      {editing && (
        <div className="space-y-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            In the Square Developer Dashboard (developer.squareup.com) open your app → <strong>Credentials</strong> →
            switch to <strong>Production</strong> → copy the <strong>Access token</strong>. One token covers every
            location on that Square account.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor={`sq-token-${restaurant.id}`}>Access token</Label>
              <Input
                id={`sq-token-${restaurant.id}`}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => { setToken(e.target.value); setLocations(null); }}
                placeholder={saved.access_token ? "Saved — paste a new one to replace it" : "EAAA…"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={(v) => { setEnvironment(v as "production" | "sandbox"); setLocations(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="sandbox">Sandbox (testing)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label>Square location</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => findLocations.mutate()}
                disabled={findLocations.isPending || (!token.trim() && !saved.access_token)}
              >
                {findLocations.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Find locations
              </Button>
            </div>
            {locations ? (
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Pick the location that is this venue" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}{l.address ? ` — ${l.address}` : ""}{l.status !== "ACTIVE" ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                {saved.location_name ? `Currently: ${saved.location_name}. ` : ""}Paste the token, then Find locations.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {credential && (
              <Button
                variant="ghost"
                className="mr-auto text-muted-foreground hover:text-destructive"
                onClick={() => { if (confirm(`Disconnect ${restaurant.name} from Square? Synced sales stay.`)) disconnect.mutate(); }}
              >
                Disconnect
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !locationId}>
              {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save &amp; sync
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
