import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Check,
  ChevronLeft,
  BarChart3,
  Receipt,
  CalendarClock,
  Bike,
  ShoppingBag,
  Car,
  Star,
  Monitor,
  Apple,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Restaurant } from "@/types";

/**
 * "Set up a venue" — everything a brand needs to get The Coop syncing at one
 * venue, in one dialog:
 *
 *   1. Which systems the venue uses + the few details each needs
 *      (saved to venue_sync_settings, migration 090 — no code changes per brand)
 *   2. Download the installer. Its FILE NAME carries a fresh pairing code, so
 *      the Coop Agent pairs itself on first launch: one file, run it, done.
 *
 * Open to the brand's own managers (anyone who manages the venue's roster).
 */

export interface VenueSyncConfig {
  lightspeed?: { venue_name?: string };
  kounta?: { site_name?: string };
  deputy?: { url?: string; location_name?: string };
  uber?: { store_uuid?: string; store_name?: string };
  bite?: { url?: string; site_id?: string; connect_id?: string };
  doordash?: { enabled?: boolean };
  google?: { share_url?: string };
  payout_venue?: string;
}

interface AgentRelease {
  version?: string;
  windows?: string;
  mac?: string;
  windows_version?: string;
  mac_version?: string;
}

type SystemKey = "lightspeed" | "kounta" | "deputy" | "uber" | "bite" | "doordash" | "google";

const SYSTEMS: { key: SystemKey; name: string; what: string; icon: typeof BarChart3 }[] = [
  { key: "lightspeed", name: "Lightspeed Insights", what: "Daily sales and sales mix", icon: BarChart3 },
  { key: "kounta", name: "Lightspeed Sales Feed", what: "Sales by hour (Pulse)", icon: Receipt },
  { key: "deputy", name: "Deputy", what: "Labour cost and the roster dashboard", icon: CalendarClock },
  { key: "uber", name: "Uber Eats", what: "Delivery sales, orders and payouts", icon: Bike },
  { key: "bite", name: "Bite", what: "Online ordering sales and payouts", icon: ShoppingBag },
  { key: "doordash", name: "DoorDash", what: "Payouts", icon: Car },
  { key: "google", name: "Google reviews", what: "Rating and reviews", icon: Star },
];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BAD_NAME = /[,:|]/;

function originOf(v: string): string | null {
  try {
    const u = new URL(v.trim().match(/^https?:\/\//i) ? v.trim() : `https://${v.trim()}`);
    return u.protocol === "https:" || u.protocol === "http:" ? `https://${u.host}` : null;
  } catch {
    return null;
  }
}

function errText(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null) {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return err.code ? `${parts.join(" — ")} (${err.code})` : parts.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return fallback;
}

/** Which systems a saved config switches on. */
export function enabledSystems(c: VenueSyncConfig | null | undefined): SystemKey[] {
  if (!c) return [];
  const on: SystemKey[] = [];
  if (c.lightspeed?.venue_name) on.push("lightspeed");
  if (c.kounta?.site_name) on.push("kounta");
  if (c.deputy?.url && c.deputy?.location_name) on.push("deputy");
  if (c.uber?.store_uuid && c.uber?.store_name) on.push("uber");
  if (c.bite?.url && c.bite?.site_id) on.push("bite");
  if (c.doordash?.enabled) on.push("doordash");
  if (c.google?.share_url) on.push("google");
  return on;
}

export const SYSTEM_NAMES = Object.fromEntries(SYSTEMS.map((s) => [s.key, s.name])) as Record<SystemKey, string>;

// ── Form state ───────────────────────────────────────────────────────────────
interface Form {
  on: Record<SystemKey, boolean>;
  lsVenue: string;
  kountaSite: string;
  deputyUrl: string;
  deputyLocation: string;
  uberStore: string;
  uberName: string;
  biteUrl: string;
  biteSite: string;
  biteConnect: string;
  googleUrl: string;
  payoutVenue: string;
}

function formFrom(c: VenueSyncConfig | null, venueName: string): Form {
  const on = Object.fromEntries(SYSTEMS.map((s) => [s.key, false])) as Record<SystemKey, boolean>;
  for (const k of enabledSystems(c)) on[k] = true;
  return {
    on,
    lsVenue: c?.lightspeed?.venue_name ?? "",
    kountaSite: c?.kounta?.site_name ?? "",
    deputyUrl: c?.deputy?.url ?? "",
    deputyLocation: c?.deputy?.location_name ?? "",
    uberStore: c?.uber?.store_uuid ?? "",
    uberName: c?.uber?.store_name ?? "",
    biteUrl: c?.bite?.url ?? "",
    biteSite: c?.bite?.site_id ?? "",
    biteConnect: c?.bite?.connect_id ?? "",
    googleUrl: c?.google?.share_url ?? "",
    payoutVenue: c?.payout_venue ?? venueName,
  };
}

/** Turn the form into a config, or a list of problems. */
function toConfig(f: Form): { config?: VenueSyncConfig; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const c: VenueSyncConfig = {};
  const name = (key: string, v: string, label: string) => {
    if (!v.trim()) errors[key] = `${label} is needed`;
    else if (BAD_NAME.test(v)) errors[key] = "Can't contain , : or |";
    return v.trim();
  };

  if (f.on.lightspeed) c.lightspeed = { venue_name: name("lsVenue", f.lsVenue, "The venue name") };
  if (f.on.kounta) c.kounta = { site_name: name("kountaSite", f.kountaSite, "The site name") };
  if (f.on.deputy) {
    const url = originOf(f.deputyUrl);
    if (!url || !/deputy\.com$/i.test(new URL(url).host)) errors.deputyUrl = "Paste your Deputy address, e.g. https://abc123.au.deputy.com";
    c.deputy = { url: url ?? "", location_name: name("deputyLocation", f.deputyLocation, "The location name") };
  }
  if (f.on.uber) {
    const id = f.uberStore.match(UUID_RE)?.[0];
    if (!id) errors.uberStore = "Paste the store's Uber Eats Manager link (or its ID)";
    c.uber = { store_uuid: (id ?? "").toLowerCase(), store_name: name("uberName", f.uberName, "The store name") };
  }
  if (f.on.bite) {
    const url = originOf(f.biteUrl);
    if (!url || !/bitebusiness\.com$/i.test(new URL(url).host)) errors.biteUrl = "Paste your Bite admin address, e.g. https://yourbrand.bitebusiness.com";
    if (!/^\d+$/.test(f.biteSite.trim())) errors.biteSite = "A number, e.g. 3697";
    if (f.biteConnect.trim() && !/^\d+$/.test(f.biteConnect.trim())) errors.biteConnect = "A number, or leave blank";
    c.bite = { url: url ?? "", site_id: f.biteSite.trim(), ...(f.biteConnect.trim() ? { connect_id: f.biteConnect.trim() } : {}) };
  }
  if (f.on.doordash) c.doordash = { enabled: true };
  if (f.on.google) {
    const u = f.googleUrl.trim();
    if (!/^https:\/\/(share\.google|g\.page|maps\.app\.goo\.gl|(www\.)?google\.[a-z.]+\/maps)/i.test(u)) {
      errors.googleUrl = "Paste the Google Business share link (https://share.google/…)";
    }
    c.google = { share_url: u };
  }
  if (f.on.uber || f.on.bite || f.on.doordash) {
    c.payout_venue = f.payoutVenue.trim() || undefined;
  }
  if (!Object.values(f.on).some(Boolean)) errors._ = "Switch on at least one system.";
  return Object.keys(errors).length ? { errors } : { config: c, errors };
}

// ── Download link ────────────────────────────────────────────────────────────
const slug = (s: string) =>
  s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "Venue";

export function installerUrl(release: AgentRelease, platform: "windows" | "mac", venueName: string, code: string) {
  const path = release[platform];
  if (!path) return null;
  // The pairing code must sit right before the extension — that's what the app looks for.
  const filename =
    platform === "windows"
      ? `Coop-Agent-Setup-${slug(venueName)}-${code}.exe`
      : `Coop-Agent-${slug(venueName)}-${code}.dmg`;
  return supabase.storage.from("agent-releases").getPublicUrl(path, { download: filename }).data.publicUrl;
}

export function useAgentRelease() {
  return useQuery({
    queryKey: ["app-settings", "agent_release"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("value").eq("key", "agent_release").maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as AgentRelease;
    },
  });
}

const thisPlatform = (): "windows" | "mac" =>
  /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "mac" : "windows";

// ── Field ────────────────────────────────────────────────────────────────────
function Field({
  id, label, hint, value, onChange, placeholder, error,
}: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; error?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-9", error && "border-destructive")}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// ── The dialog ───────────────────────────────────────────────────────────────
export default function VenueSyncSetup({
  open,
  onClose,
  venues,
  initialVenueId,
  initialStep = "systems",
}: {
  open: boolean;
  onClose: () => void;
  venues: Restaurant[];
  initialVenueId?: string | null;
  initialStep?: "systems" | "install";
}) {
  const queryClient = useQueryClient();
  const [venueId, setVenueId] = useState<string>("");
  const [step, setStep] = useState<"systems" | "install">("systems");
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [computerName, setComputerName] = useState("");
  const [issued, setIssued] = useState<{ code: string; expires: string } | null>(null);
  const venue = venues.find((v) => v.id === venueId) ?? null;
  const { data: release } = useAgentRelease();

  useEffect(() => {
    if (open) {
      setVenueId(initialVenueId ?? (venues.length === 1 ? venues[0].id : ""));
      setStep(initialVenueId ? initialStep : "systems");
      setIssued(null);
      setErrors({});
    }
  }, [open, initialVenueId, initialStep, venues]);

  const { data: saved, isFetching: loadingSaved } = useQuery({
    queryKey: ["venue-sync-settings", venueId],
    enabled: !!venueId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("venue_sync_settings")
        .select("config")
        .eq("restaurant_id", venueId)
        .maybeSingle();
      if (error) throw error;
      return (data?.config ?? null) as VenueSyncConfig | null;
    },
  });

  useEffect(() => {
    if (!venue || loadingSaved) return;
    setForm(formFrom(saved ?? null, venue.name));
    setComputerName(`${venue.name} computer`);
    setErrors({});
  }, [venue, saved, loadingSaved]);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const toggle = (k: SystemKey, v: boolean) => setForm((f) => (f ? { ...f, on: { ...f.on, [k]: v } } : f));

  const save = useMutation({
    mutationFn: async () => {
      if (!form || !venue) throw new Error("Choose a venue");
      const { config, errors: errs } = toConfig(form);
      setErrors(errs);
      if (!config) throw new Error("Check the highlighted fields");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("venue_sync_settings").upsert(
        { restaurant_id: venue.id, config, updated_at: new Date().toISOString(), updated_by: u?.user?.id ?? null },
        { onConflict: "restaurant_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["venue-sync-settings"] });
      queryClient.invalidateQueries({ queryKey: ["venue-sync-all"] });
      toast.success(`${venue?.name} saved — running agents pick it up within 15 minutes`);
      setStep("install");
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't save")),
  });

  // A fresh agent + pairing code each time someone downloads: the code lives in
  // the file name, is single-use and expires in 48 hours.
  const issue = useMutation({
    mutationFn: async () => {
      if (!venue) throw new Error("Choose a venue");
      const { data, error } = await supabase.rpc("agent_device_create", {
        p_restaurant_id: venue.id,
        p_name: computerName.trim() || `${venue.name} computer`,
      });
      if (error) throw error;
      const d = data as { pair_code: string; pair_expires_at: string };
      return { code: d.pair_code, expires: d.pair_expires_at };
    },
    onSuccess: (d) => {
      setIssued(d);
      queryClient.invalidateQueries({ queryKey: ["agent-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't create the installer")),
  });

  const download = async (platform: "windows" | "mac") => {
    if (!venue || !release) return;
    const got = issued ?? (await issue.mutateAsync().catch(() => null));
    if (!got) return;
    const url = installerUrl(release, platform, venue.name, got.code);
    if (url) window.location.href = url;
  };

  const preferred = thisPlatform();
  const platforms: ("windows" | "mac")[] = preferred === "mac" ? ["mac", "windows"] : ["windows", "mac"];
  const noRelease = !release?.windows && !release?.mac;

  const close = () => {
    setForm(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "systems" ? "Set up a venue" : `Install Coop Agent at ${venue?.name}`}
          </DialogTitle>
          <DialogDescription>
            {step === "systems"
              ? "Switch on the systems this venue uses and fill in a couple of details for each. You can change these any time."
              : "One file. Run it on the venue's computer — it installs, connects itself to this venue and opens the sign-in pages."}
          </DialogDescription>
        </DialogHeader>

        {step === "systems" && (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label>Venue</Label>
              <Select value={venueId} onValueChange={(v) => { setVenueId(v); setForm(null); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a venue" />
                </SelectTrigger>
                <SelectContent>
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {venueId && !form && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}

            {form && (
              <div className="divide-y divide-border rounded-lg border border-border">
                {SYSTEMS.map((sys) => {
                  const Icon = sys.icon;
                  const on = form.on[sys.key];
                  return (
                    <div key={sys.key} className="px-4 py-3">
                      <label className="flex cursor-pointer items-center gap-3">
                        <Icon className={cn("h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{sys.name}</span>
                          <span className="block text-xs text-muted-foreground">{sys.what}</span>
                        </span>
                        <Switch checked={on} onCheckedChange={(v) => toggle(sys.key, v)} />
                      </label>

                      {on && sys.key === "lightspeed" && (
                        <div className="mt-3 grid gap-3 pl-7">
                          <Field id="f-ls" label="Venue name in Lightspeed Insights" value={form.lsVenue}
                            onChange={(v) => set({ lsVenue: v, kountaSite: form.kountaSite || v })}
                            placeholder="e.g. Geelong West" error={errors.lsVenue}
                            hint="Exactly as it appears in the venue filter at the top of Insights." />
                        </div>
                      )}
                      {on && sys.key === "kounta" && (
                        <div className="mt-3 grid gap-3 pl-7">
                          <Field id="f-kounta" label="Site name in the Sales Feed" value={form.kountaSite}
                            onChange={(v) => set({ kountaSite: v })} placeholder="e.g. Geelong West" error={errors.kountaSite}
                            hint="As shown in the Site column of Lightspeed Back Office → Sales. Usually the same as above." />
                        </div>
                      )}
                      {on && sys.key === "deputy" && (
                        <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                          <Field id="f-dep-url" label="Deputy address" value={form.deputyUrl}
                            onChange={(v) => set({ deputyUrl: v })} placeholder="https://abc123.au.deputy.com"
                            error={errors.deputyUrl} hint="Copy it from your browser when you're logged in to Deputy." />
                          <Field id="f-dep-loc" label="Location name in Deputy" value={form.deputyLocation}
                            onChange={(v) => set({ deputyLocation: v })} placeholder="e.g. Geelong West"
                            error={errors.deputyLocation} hint="As shown in the location picker on the roster." />
                        </div>
                      )}
                      {on && sys.key === "uber" && (
                        <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                          <Field id="f-uber-link" label="Store link from Uber Eats Manager" value={form.uberStore}
                            onChange={(v) => set({ uberStore: v })} placeholder="https://merchants.ubereats.com/manager/home/…"
                            error={errors.uberStore} hint="Pick this store in Uber Eats Manager, then copy the address bar." />
                          <Field id="f-uber-name" label="Store name in Uber Eats Manager" value={form.uberName}
                            onChange={(v) => set({ uberName: v })} placeholder="e.g. Pollo Rotisserie (Geelong)"
                            error={errors.uberName} hint="Exactly as in the store selector at the top." />
                        </div>
                      )}
                      {on && sys.key === "bite" && (
                        <div className="mt-3 grid gap-3 pl-7 sm:grid-cols-3">
                          <Field id="f-bite-url" label="Bite admin address" value={form.biteUrl}
                            onChange={(v) => set({ biteUrl: v })} placeholder="https://yourbrand.bitebusiness.com"
                            error={errors.biteUrl} />
                          <Field id="f-bite-site" label="Site ID" value={form.biteSite}
                            onChange={(v) => set({ biteSite: v })} placeholder="e.g. 3697" error={errors.biteSite}
                            hint="Ask Bite support, or Coop support can find it." />
                          <Field id="f-bite-connect" label="Payouts ID (optional)" value={form.biteConnect}
                            onChange={(v) => set({ biteConnect: v })} placeholder="e.g. 3028" error={errors.biteConnect}
                            hint="Needed for Bite payouts only." />
                        </div>
                      )}
                      {on && sys.key === "doordash" && (
                        <p className="mt-2 pl-7 text-xs text-muted-foreground">
                          Nothing to fill in — just sign in to DoorDash Merchant in the Coop Browser.
                        </p>
                      )}
                      {on && sys.key === "google" && (
                        <div className="mt-3 grid gap-3 pl-7">
                          <Field id="f-google" label="Google Business share link" value={form.googleUrl}
                            onChange={(v) => set({ googleUrl: v })} placeholder="https://share.google/…"
                            error={errors.googleUrl} hint="Google Business Profile → Share → Copy link." />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {form && (form.on.uber || form.on.bite || form.on.doordash) && (
              <Field id="f-payout" label="Name for this venue on payout reports" value={form.payoutVenue}
                onChange={(v) => set({ payoutVenue: v })} hint="Shown in channel payouts. Defaults to the venue name." />
            )}
            {errors._ && <p className="text-sm text-destructive">{errors._}</p>}
          </div>
        )}

        {step === "install" && venue && (
          <div className="space-y-5">
            <Field id="f-computer" label="Name this computer" value={computerName}
              onChange={(v) => { setComputerName(v); setIssued(null); }}
              hint="So you can tell computers apart in Sync Agents, e.g. “Office PC”." />

            {noRelease ? (
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                The installer hasn't been published yet. Ask your Coop admin to run “Publish Coop Agent”. Meanwhile
                you can still create a pairing code and type it into Coop Agent.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {platforms.map((p) => {
                  const available = !!release?.[p];
                  const Icon = p === "mac" ? Apple : Monitor;
                  return (
                    <Button
                      key={p}
                      size="lg"
                      variant={p === preferred ? "default" : "outline"}
                      className="h-auto justify-start gap-3 py-3"
                      disabled={!available || issue.isPending}
                      onClick={() => download(p)}
                    >
                      {issue.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                      <span className="text-left">
                        <span className="block font-semibold">Download for {p === "mac" ? "Mac" : "Windows"}</span>
                        <span className="block text-xs font-normal opacity-80">
                          {available ? `Coop Agent ${release?.[`${p}_version`] ?? release?.version ?? ""}` : "Not published yet"}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            )}

            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>Download on the venue's computer (or copy the file across) and run it.</li>
              <li>
                It installs, pairs itself to <strong className="text-foreground">{venue.name}</strong> and opens the
                Coop Browser.
              </li>
              <li>Sign in to each site it lists. Done — it runs in the background from then on.</li>
            </ol>

            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              {issued ? (
                <>
                  If the computer asks for a code, type{" "}
                  <code className="font-mono text-sm font-semibold tracking-wider text-foreground">{issued.code}</code>.
                  Single use, valid for 48 hours.
                </>
              ) : (
                <>
                  Each download carries a fresh single-use pairing code, valid for 48 hours.{" "}
                  <button type="button" className="font-semibold text-primary hover:underline"
                    onClick={() => issue.mutate()} disabled={issue.isPending}>
                    Just show me a code
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              First launch on Windows: if SmartScreen appears, choose <em>More info → Run anyway</em>. On a Mac, if it's
              blocked, open System Settings → Privacy &amp; Security → <em>Open Anyway</em>, and allow access to Downloads
              when asked (that's how it finds its code).
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {step === "install" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("systems")}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back to systems
              </Button>
              <Button onClick={close}>
                <Check className="mr-1.5 h-4 w-4" /> Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={!form || save.isPending}>
                {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save and continue
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { formFrom, toConfig };
export type { Form as VenueSyncForm };

// Exposed for SyncAgentSettings' venue list.
export function useVenueSyncAll(ids: string[]) {
  return useQuery({
    queryKey: ["venue-sync-all", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("venue_sync_settings")
        .select("restaurant_id, config, updated_at")
        .in("restaurant_id", ids);
      if (error) throw error;
      return Object.fromEntries(
        (data ?? []).map((r: { restaurant_id: string; config: VenueSyncConfig }) => [r.restaurant_id, r.config])
      ) as Record<string, VenueSyncConfig>;
    },
  });
}

export const useManageableVenues = (venues: Restaurant[], profile: { role?: string; restaurant_access?: string[] } | null) =>
  useMemo(() => {
    if (!profile) return [];
    if (profile.role === "superadmin") return venues;
    if (!["area_manager", "manager"].includes(profile.role ?? "")) return [];
    const access = new Set(profile.restaurant_access ?? []);
    return venues.filter((v) => access.has(v.id));
  }, [venues, profile]);
