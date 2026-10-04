import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import {
  MonitorCog,
  Plus,
  Copy,
  Check,
  Loader2,
  Ban,
  RotateCcw,
  Trash2,
  KeyRound,
  ChevronDown,
  ChevronRight,
  Clock,
  Store,
  Download,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Restaurant } from "@/types";
import VenueSyncSetup, {
  useVenueSyncAll,
  useManageableVenues,
  enabledSystems,
  SYSTEM_NAMES,
} from "@/components/settings/VenueSyncSetup";

/**
 * Sync Agents — the Coop Agent desktop app on each venue computer (../coop-agent).
 *
 * An agent runs the scrapers (Lightspeed, Deputy, Uber, Bite, Google…) on a
 * schedule, answers the Refresh buttons and prints prep labels. It is paired with
 * a one-time code (migration 088); after that it holds a device token that the
 * `coop-agent` edge function only lets write its own venue's sync data. No
 * service-role key ever sits on a venue computer.
 */

interface AgentDevice {
  id: string;
  restaurant_id: string;
  name: string;
  token_hash: string | null;
  pair_code: string | null;
  pair_expires_at: string | null;
  paired_at: string | null;
  active: boolean;
  last_seen_at: string | null;
  app_version: string | null;
  platform: string | null;
  status: AgentStatus | null;
  schedule_overrides: Record<string, string | null> | null;
  created_at: string;
  restaurant?: { name: string } | null;
}

interface AgentStatus {
  paused?: boolean;
  browser?: boolean;
  portals?: Record<string, "ok" | "login" | "closed">;
  running?: string | null;
  queue?: string[];
}

interface AgentRun {
  id: string;
  source: string;
  trigger: string;
  status: "running" | "done" | "error";
  log_tail: string | null;
  started_at: string;
  finished_at: string | null;
}

interface AgentConfig {
  sources?: Record<string, { label?: string; schedule?: string | null; env?: Record<string, string> }>;
  portals?: { key: string; name: string }[];
  [k: string]: unknown;
}

const ONLINE_MS = 3 * 60 * 1000;
const SCHEDULE_RE = /^(daily\s+\d{1,2}:\d{2}|hourly\s+:\d{2}(\s+\d{1,2}-\d{1,2})?)$/i;

function errText(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null) {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return err.code ? `${parts.join(" — ")} (${err.code})` : parts.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return fallback;
}

/** "daily 06:30" → "daily 6:30 am"; "hourly :05 09-23" → "hourly at :05, 9 am–11 pm". */
function describeSchedule(s: string): string {
  const h12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
  let m = s.match(/^daily\s+(\d{1,2}):(\d{2})$/i);
  if (m) return `daily ${h12(+m[1]).replace(" ", `:${m[2]} `)}`;
  m = s.match(/^hourly\s+:(\d{2})(?:\s+(\d{1,2})-(\d{1,2}))?$/i);
  if (m) return `hourly at :${m[1]}, ${h12(m[2] ? +m[2] : 0)}–${h12(m[3] ? +m[3] : 23)}`;
  return s;
}

type AgentState = "online" | "offline" | "waiting" | "revoked" | "expired";

function agentState(d: AgentDevice): AgentState {
  if (!d.active) return "revoked";
  if (!d.token_hash) {
    return d.pair_expires_at && new Date(d.pair_expires_at) < new Date() ? "expired" : "waiting";
  }
  return d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < ONLINE_MS ? "online" : "offline";
}

const STATE_STYLE: Record<AgentState, { label: string; cls: string }> = {
  online: { label: "Online", cls: "bg-success-soft text-success" },
  offline: { label: "Offline", cls: "bg-destructive-soft text-destructive" },
  waiting: { label: "Waiting to pair", cls: "bg-warning-soft text-warning" },
  expired: { label: "Code expired", cls: "bg-muted text-muted-foreground" },
  revoked: { label: "Revoked", cls: "bg-destructive-soft text-destructive" },
};

function CodePanel({ code, expires }: { code: string; expires: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <code className="flex-1 rounded-lg border border-border bg-muted px-4 py-3 text-center font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">
          {code}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              toast.error("Couldn't copy — select the code and copy it manually");
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5 mr-1.5 text-success" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Install Coop Agent on the venue computer and open it.</li>
        <li>Type this code into the <em>Pair this computer</em> screen.</li>
        <li>Sign in to each site in the Coop Browser window that opens.</li>
      </ol>
      {expires && (
        <p className="text-xs text-muted-foreground">
          Single use. Expires {formatDistanceToNow(new Date(expires), { addSuffix: true })}.
        </p>
      )}
    </div>
  );
}

function AddAgentDialog({
  open,
  onClose,
  venues,
}: {
  open: boolean;
  onClose: () => void;
  venues: Restaurant[];
}) {
  const queryClient = useQueryClient();
  const [restaurantId, setRestaurantId] = useState("");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ pair_code: string; pair_expires_at: string } | null>(null);
  const venueName = venues.find((v) => v.id === restaurantId)?.name ?? "";

  const create = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("Choose which venue this computer is at");
      const { data, error } = await supabase.rpc("agent_device_create", {
        p_restaurant_id: restaurantId,
        p_name: name.trim() || `${venueName} computer`,
      });
      if (error) throw error;
      return data as { id: string; pair_code: string; pair_expires_at: string };
    },
    onSuccess: (d) => {
      setCreated(d);
      queryClient.invalidateQueries({ queryKey: ["agent-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't add the agent")),
  });

  const close = () => {
    setRestaurantId("");
    setName("");
    setCreated(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{created ? "Pairing code" : "Add a sync agent"}</DialogTitle>
          <DialogDescription>
            {created
              ? `Enter this on the ${venueName} computer.`
              : "One per venue computer. It only ever writes that venue's data."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <CodePanel code={created.pair_code} expires={created.pair_expires_at} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Venue</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a venue" />
                </SelectTrigger>
                <SelectContent>
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">Computer name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={venueName ? `e.g. ${venueName} — office PC` : "e.g. Office PC"}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {created ? (
            <Button type="button" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Create pairing code
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecentRuns({ deviceId, labels }: { deviceId: string; labels: Record<string, string> }) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["agent-runs", deviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runs")
        .select("id, source, trigger, status, log_tail, started_at, finished_at")
        .eq("device_id", deviceId)
        .order("started_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data as AgentRun[];
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="h-10 rounded bg-muted/30 animate-pulse" />;
  if (!runs.length) return <p className="text-xs text-muted-foreground">No runs yet.</p>;

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {runs.map((r) => {
        const lastLine = (r.log_tail ?? "")
          .split("\n")
          .map((l) => l.replace(/^\[[^\]]+\]\s*/, "").trim())
          .filter((l) => /fail|error|sign in|login|missing|could not/i.test(l))
          .pop();
        return (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-semibold",
                r.status === "done" && "bg-success-soft text-success",
                r.status === "error" && "bg-destructive-soft text-destructive",
                r.status === "running" && "bg-primary/10 text-primary"
              )}
            >
              {r.status === "done" ? "OK" : r.status === "error" ? "Failed" : "Running"}
            </span>
            <span className="font-medium text-foreground">{labels[r.source] ?? r.source}</span>
            <span className="text-muted-foreground">
              {format(new Date(r.started_at), "EEE d MMM, h:mm a")} · {r.trigger}
            </span>
            {r.status === "error" && lastLine && (
              <span className="basis-full truncate text-destructive" title={lastLine}>
                {lastLine}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SchedulesCard({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["app-settings", "agent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("value").eq("key", "agent").maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as AgentConfig;
    },
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      if (!cfg) return;
      const bad = Object.entries(drafts).filter(([, v]) => v.trim() && !SCHEDULE_RE.test(v.trim()));
      if (bad.length) throw new Error(`"${bad[0][1]}" isn't a schedule — use "daily 04:00" or "hourly :05 09-23"`);
      const sources = { ...(cfg.sources ?? {}) };
      for (const [k, v] of Object.entries(drafts)) {
        sources[k] = { ...sources[k], schedule: v.trim() || null };
      }
      const { error } = await supabase
        .from("app_settings")
        .update({ value: { ...cfg, sources }, updated_at: new Date().toISOString() })
        .eq("key", "agent");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedules saved — agents pick them up within 15 minutes");
      setDrafts({});
      queryClient.invalidateQueries({ queryKey: ["app-settings", "agent"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't save schedules")),
  });

  const sources = Object.entries(cfg?.sources ?? {});
  if (!sources.length) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-1 flex items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold text-card-foreground">Default schedules</h3>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Melbourne time, for every agent unless that computer has its own (set in the Coop Agent app — shown as{" "}
        <em>Custom schedules</em> above). <code className="text-xs">daily 04:00</code> or{" "}
        <code className="text-xs">hourly :05 09-23</code>. Blank = only when someone presses Refresh. A computer
        that was off at the scheduled time catches up when it's turned on.
      </p>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {sources.map(([key, s]) => {
          const value = drafts[key] ?? s.schedule ?? "";
          const invalid = value.trim() !== "" && !SCHEDULE_RE.test(value.trim());
          return (
            <div key={key} className="flex items-center gap-3">
              <Label htmlFor={`sch-${key}`} className="w-40 shrink-0 text-sm font-medium">
                {s.label ?? key}
              </Label>
              <Input
                id={`sch-${key}`}
                value={value}
                disabled={!isAdmin}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                placeholder="On request only"
                className={cn("h-8 font-mono text-xs", invalid && "border-destructive")}
              />
            </div>
          );
        })}
      </div>
      {isAdmin && (
        <div className="mt-4 flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !Object.keys(drafts).length}>
            {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save schedules
          </Button>
        </div>
      )}
    </div>
  );
}

export default function SyncAgentSettings() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "superadmin";
  const [addOpen, setAddOpen] = useState(false);
  const [setup, setSetup] = useState<{ venueId: string | null; step: "systems" | "install" } | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<{ name: string; pair_code: string; pair_expires_at: string } | null>(null);
  const [confirmRepair, setConfirmRepair] = useState<AgentDevice | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgentDevice | null>(null);

  const { data: venues = [] } = useQuery({
    queryKey: ["venues-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("*").order("name");
      if (error) throw error;
      return data as Restaurant[];
    },
  });

  // Brands set up their own venues: anyone who manages a venue's roster.
  const manageable = useManageableVenues(venues, profile ?? null);
  const manageableIds = useMemo(() => new Set(manageable.map((v) => v.id)), [manageable]);
  const canManage = (rid: string) => isAdmin || manageableIds.has(rid);
  const { data: syncByVenue = {} } = useVenueSyncAll(manageable.map((v) => v.id));

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ["agent-devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_devices")
        .select(
          "id, restaurant_id, name, token_hash, pair_code, pair_expires_at, paired_at, active, last_seen_at, app_version, platform, status, schedule_overrides, created_at, restaurant:restaurants(name)"
        )
        .order("created_at");
      if (error) throw error;
      return data as unknown as AgentDevice[];
    },
    refetchInterval: 30_000,
  });

  const { data: cfg } = useQuery({
    queryKey: ["app-settings", "agent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("value").eq("key", "agent").maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as AgentConfig;
    },
  });
  const labels = useMemo(
    () => Object.fromEntries(Object.entries(cfg?.sources ?? {}).map(([k, v]) => [k, v.label ?? k])),
    [cfg]
  );
  const portalNames = useMemo(
    () => Object.fromEntries((cfg?.portals ?? []).map((p) => [p.key, p.name])),
    [cfg]
  );

  const newPairCode = useMutation({
    mutationFn: async (d: AgentDevice) => {
      const { data, error } = await supabase.rpc("agent_device_new_code", { p_id: d.id });
      if (error) throw error;
      return { ...(data as { pair_code: string; pair_expires_at: string }), name: d.name };
    },
    onSuccess: (d) => {
      setNewCode(d);
      setConfirmRepair(null);
      queryClient.invalidateQueries({ queryKey: ["agent-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't create a new code")),
  });

  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("agent_devices").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.active ? "Agent re-enabled" : "Agent revoked — it stops syncing straight away");
      queryClient.invalidateQueries({ queryKey: ["agent-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't change that agent")),
  });

  const resetSchedules = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_devices").update({ schedule_overrides: {} }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Back on the default schedules — the agent picks this up within 15 minutes");
      queryClient.invalidateQueries({ queryKey: ["agent-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't reset the schedules")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agent deleted");
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["agent-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't delete that agent")),
  });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MonitorCog className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-card-foreground">Sync Agents</h2>
          </div>
          {manageable.length > 0 && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)}>
                <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                Pair with a code
              </Button>
              <Button size="sm" onClick={() => setSetup({ venueId: null, step: "systems" })}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Set up a venue
              </Button>
            </div>
          )}
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          The Coop Agent app on each venue computer pulls sales, labour, reviews and delivery data in, answers the
          Refresh buttons and prints prep labels. Each one only writes its own venue's data.
        </p>

        {manageable.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Venues</h3>
            <div className="divide-y divide-border rounded-lg border border-border">
              {manageable.map((v) => {
                const systems = enabledSystems(syncByVenue[v.id]);
                const venueAgents = devices.filter((d) => d.restaurant_id === v.id && d.token_hash && d.active);
                const online = venueAgents.filter((d) => agentState(d) === "online").length;
                return (
                  <div key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{v.name}</span>
                        {systems.length === 0 ? (
                          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                            Not set up
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              online ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"
                            )}
                          >
                            {venueAgents.length === 0
                              ? "No computer yet"
                              : `${online}/${venueAgents.length} computer${venueAgents.length === 1 ? "" : "s"} online`}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {systems.length ? systems.map((k) => SYSTEM_NAMES[k]).join(" · ") : "Choose which systems this venue uses"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => setSetup({ venueId: v.id, step: "systems" })}>
                        <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                        {systems.length ? "Edit" : "Set up"}
                      </Button>
                      {systems.length > 0 && (
                        <Button size="sm" onClick={() => setSetup({ venueId: v.id, step: "install" })}>
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Installer
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Computers</h3>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 rounded bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MonitorCog className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No computers yet.{manageable.length ? " Set up a venue and download its installer." : ""}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {devices
              .filter((d) => showExpired || !(agentState(d) === "expired"))
              .map((d) => {
              const st = agentState(d);
              const style = STATE_STYLE[st];
              const portals = Object.entries(d.status?.portals ?? {});
              const needs = portals.filter(([, s]) => s !== "ok").map(([k]) => portalNames[k] ?? k);
              const open = expanded === d.id;
              return (
                <div key={d.id}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      onClick={() => setExpanded(open ? null : d.id)}
                      disabled={!d.token_hash}
                      aria-label={open ? "Hide recent runs" : "Show recent runs"}
                    >
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{d.name}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", style.cls)}>
                          {style.label}
                        </span>
                        {st === "online" && d.status?.paused && (
                          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                            Paused
                          </span>
                        )}
                        {st === "online" && d.status?.running && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            Running {labels[d.status.running] ?? d.status.running}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.restaurant?.name ?? "Unknown venue"}
                        {d.platform && ` · ${d.platform === "darwin" ? "Mac" : d.platform === "win32" ? "Windows" : d.platform}`}
                        {d.app_version && ` · v${d.app_version}`}
                        {" · "}
                        {d.token_hash
                          ? d.last_seen_at
                            ? `seen ${formatDistanceToNow(new Date(d.last_seen_at), { addSuffix: true })}`
                            : "never seen"
                          : "not paired yet"}
                      </p>
                      {d.token_hash && needs.length > 0 && (
                        <p className="mt-0.5 text-xs text-warning">Needs sign-in: {needs.join(", ")}</p>
                      )}
                      {Object.keys(d.schedule_overrides ?? {}).length > 0 && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-primary">
                          <span>
                            Custom schedules:{" "}
                            {Object.entries(d.schedule_overrides ?? {})
                              .map(([k, v]) => `${labels[k] ?? k} (${v ? describeSchedule(v) : "on request only"})`)
                              .join(", ")}
                          </span>
                          {canManage(d.restaurant_id) && (
                            <button
                              type="button"
                              className="font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                              onClick={() => resetSchedules.mutate(d.id)}
                              disabled={resetSchedules.isPending}
                            >
                              Reset to defaults
                            </button>
                          )}
                        </p>
                      )}
                    </div>

                    {canManage(d.restaurant_id) && (
                      <div className="flex items-center gap-1.5">
                        {!d.token_hash && d.pair_code && st === "waiting" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setNewCode({ name: d.name, pair_code: d.pair_code!, pair_expires_at: d.pair_expires_at! })
                            }
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                            Show code
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => (d.token_hash ? setConfirmRepair(d) : newPairCode.mutate(d))}
                            disabled={newPairCode.isPending}
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                            New code
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setActive.mutate({ id: d.id, active: !d.active })}
                          disabled={setActive.isPending}
                        >
                          {d.active ? (
                            <>
                              <Ban className="h-3.5 w-3.5 mr-1.5" />
                              Revoke
                            </>
                          ) : (
                            <>
                              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                              Re-enable
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmDelete(d)}
                          aria-label={`Delete ${d.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {open && (
                    <div className="px-4 pb-4 pl-11">
                      <RecentRuns deviceId={d.id} labels={labels} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {devices.some((d) => agentState(d) === "expired") && (
          <button
            type="button"
            className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowExpired((x) => !x)}
          >
            {showExpired
              ? "Hide unused installers"
              : `Show ${devices.filter((d) => agentState(d) === "expired").length} unused installer code(s)`}
          </button>
        )}
      </div>

      <SchedulesCard isAdmin={isAdmin} />

      <VenueSyncSetup
        open={!!setup}
        onClose={() => setSetup(null)}
        venues={manageable}
        initialVenueId={setup?.venueId ?? null}
        initialStep={setup?.step ?? "systems"}
      />

      <AddAgentDialog open={addOpen} onClose={() => setAddOpen(false)} venues={manageable} />

      <Dialog open={!!newCode} onOpenChange={(o) => !o && setNewCode(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pairing code — {newCode?.name}</DialogTitle>
            <DialogDescription>Enter this in Coop Agent on that computer.</DialogDescription>
          </DialogHeader>
          {newCode && <CodePanel code={newCode.pair_code} expires={newCode.pair_expires_at} />}
          <DialogFooter>
            <Button type="button" onClick={() => setNewCode(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRepair} onOpenChange={(o) => !o && setConfirmRepair(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-pair {confirmRepair?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The computer that's paired now will stop syncing straight away and ask for a code. Use this when
              replacing a computer or reinstalling Coop Agent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRepair && newPairCode.mutate(confirmRepair)}>
              Unpair and create code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              That computer stops syncing and its run history is removed. The data it already synced stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
