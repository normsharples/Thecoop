import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Tablet,
  Plus,
  Copy,
  Check,
  Loader2,
  Link2,
  Ban,
  RotateCcw,
  Trash2,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
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

/**
 * Time Clocks — pair a tablet with the standalone Coop Clock app (../coop-clock).
 *
 * The clock never signs anybody in: it runs on the Supabase anon key and every call
 * carries a device token that maps the tablet to one venue. Creating a token is
 * a roster-manager action (migration 071's kiosk_device_create checks that), and
 * the token is only ever as powerful as "may punch at this venue with a PIN".
 */

interface KioskDevice {
  id: string;
  restaurant_id: string;
  name: string;
  token: string;
  active: boolean;
  last_seen_at: string | null;
  created_at: string;
  restaurant?: { name: string } | null;
}

/**
 * Supabase returns PostgrestError — a plain object, NOT an Error instance — so
 * `e instanceof Error` silently swallows the only useful part. Pull the message
 * (plus hint/code, which is what tells you a migration hasn't been applied).
 */
function errText(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null) {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return err.code ? `${parts.join(" — ")} (${err.code})` : parts.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return fallback;
}

const CLOCK_URL_KEY = "clock";

// ── Clock app address (app_settings 'clock') ─────────────────────────────────
function useClockUrl() {
  const { data } = useQuery({
    queryKey: ["app-settings", CLOCK_URL_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", CLOCK_URL_KEY)
        .maybeSingle();
      if (error) throw error;
      return ((data?.value as { url?: string } | undefined)?.url ?? "") as string;
    },
  });
  return data ?? "";
}

function pairingLink(base: string, token: string): string | null {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return `${trimmed}/?token=${token}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          toast.error("Couldn't copy — select the text and copy it manually");
        }
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 mr-1.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5 mr-1.5" />
      )}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ── The token panel, shared by "new clock" and "pairing details" ─────────────
function TokenPanel({ token, clockUrl }: { token: string; clockUrl: string }) {
  const link = pairingLink(clockUrl, token);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Device token</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground">
            {token}
          </code>
          <CopyButton value={token} label="Copy" />
        </div>
      </div>

      {link ? (
        <div className="space-y-1.5">
          <Label>Pairing link</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              {link}
            </code>
            <CopyButton value={link} label="Copy link" />
          </div>
          <p className="text-xs text-muted-foreground">
            Open this once on the tablet — it pairs itself and drops the token out of the address
            bar. Then Add to Home Screen.
          </p>
        </div>
      ) : (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          Set the clock app address below and this becomes a one-tap pairing link.
        </p>
      )}
    </div>
  );
}

// ── Add a clock ──────────────────────────────────────────────────────────────
function AddClockDialog({
  open,
  onClose,
  venues,
  clockUrl,
}: {
  open: boolean;
  onClose: () => void;
  venues: Restaurant[];
  clockUrl: string;
}) {
  const queryClient = useQueryClient();
  const [restaurantId, setRestaurantId] = useState("");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);

  const venueName = venues.find((v) => v.id === restaurantId)?.name ?? "";

  const create = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("Choose which venue this tablet belongs to");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Give the tablet a name so you can tell them apart");
      const { data, error } = await supabase.rpc("kiosk_device_create", {
        p_restaurant: restaurantId,
        p_name: trimmed,
      });
      if (error) throw error;
      return data as { id: string; token: string; name: string };
    },
    onSuccess: (d) => {
      setCreated({ token: d.token, name: d.name });
      queryClient.invalidateQueries({ queryKey: ["kiosk-devices"] });
      toast.success("Time clock added");
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't create the time clock")),
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
          <DialogTitle>{created ? "Time clock ready" : "Add a time clock"}</DialogTitle>
          <DialogDescription>
            {created
              ? `Pair the tablet with this token. You can come back for it any time.`
              : "Each tablet is tied to one venue. Staff punch in on it with their own PIN."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <TokenPanel token={created.token} clockUrl={clockUrl} />
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
              <Label htmlFor="tc-name">Tablet name</Label>
              <Input
                id="tc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={venueName ? `e.g. ${venueName} — front counter` : "e.g. Front counter"}
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
                Create token
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────
export default function TimeClockSettings() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [showToken, setShowToken] = useState<KioskDevice | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KioskDevice | null>(null);

  const savedUrl = useClockUrl();
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const clockUrl = urlDraft ?? savedUrl;

  const { data: venues = [] } = useQuery({
    queryKey: ["venues-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("*").order("name");
      if (error) throw error;
      return data as Restaurant[];
    },
  });

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ["kiosk-devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kiosk_devices")
        .select("*, restaurant:restaurants(name)")
        .order("created_at");
      if (error) throw error;
      return data as KioskDevice[];
    },
  });

  const saveUrl = useMutation({
    mutationFn: async (url: string) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: CLOCK_URL_KEY, value: { url: url.trim() } }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clock address saved");
      setUrlDraft(null);
      queryClient.invalidateQueries({ queryKey: ["app-settings", CLOCK_URL_KEY] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't save the clock address")),
  });

  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("kiosk_devices").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.active ? "Time clock re-enabled" : "Time clock revoked");
      queryClient.invalidateQueries({ queryKey: ["kiosk-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't change that time clock")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kiosk_devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Time clock deleted");
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["kiosk-devices"] });
    },
    onError: (e: unknown) => toast.error(errText(e, "Couldn't delete that time clock")),
  });

  return (
    <div className="space-y-6">
      {/* ── Paired tablets ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Tablet className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-card-foreground">Time Clocks</h2>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Time Clock
          </Button>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Tablets running the Coop Clock app. Each one is tied to a venue and takes punches from
          anyone rostered there — no login on the tablet, just each person's PIN.
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 rounded bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Tablet className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No time clocks yet. Add one to pair a tablet.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border">
            {devices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{d.name}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        d.active
                          ? "bg-success-soft text-success"
                          : "bg-destructive-soft text-destructive"
                      )}
                    >
                      {d.active ? "Active" : "Revoked"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.restaurant?.name ?? "Unknown venue"} ·{" "}
                    {d.last_seen_at
                      ? `last used ${formatDistanceToNow(new Date(d.last_seen_at), {
                          addSuffix: true,
                        })}`
                      : "never used"}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setShowToken(d)}>
                    <Link2 className="h-3.5 w-3.5 mr-1.5" />
                    Pairing
                  </Button>
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
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Staff need a PIN before they can punch — set them under Team → Payroll. Anyone without
            one still shows on the clock, marked <em>No PIN set</em>.
          </p>
        </div>
      </div>

      {/* ── Clock app address ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-1 text-base font-semibold text-card-foreground">Clock app address</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Where the Coop Clock app is hosted. Only used to build one-tap pairing links.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1 space-y-1.5">
            <Label htmlFor="tc-url">URL</Label>
            <Input
              id="tc-url"
              value={clockUrl}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="https://clock.thecoop.app"
            />
          </div>
          <Button
            onClick={() => saveUrl.mutate(clockUrl)}
            disabled={saveUrl.isPending || urlDraft === null}
          >
            {saveUrl.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      <AddClockDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        venues={venues}
        clockUrl={clockUrl}
      />

      <Dialog open={!!showToken} onOpenChange={(o) => !o && setShowToken(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{showToken?.name}</DialogTitle>
            <DialogDescription>
              {showToken?.restaurant?.name}
              {showToken && !showToken.active && " · revoked — re-enable it before pairing"}
            </DialogDescription>
          </DialogHeader>
          {showToken && <TokenPanel token={showToken.token} clockUrl={clockUrl} />}
          <DialogFooter>
            <Button type="button" onClick={() => setShowToken(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this time clock?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name} stops working immediately and its token can't be recovered.
              Punches already recorded are not affected. To pause it instead, use Revoke.
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
