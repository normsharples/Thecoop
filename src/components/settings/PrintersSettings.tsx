import { useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Printer as PrinterIcon,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  usePrinters,
  useSavePrinter,
  useDeletePrinter,
  useTestPrint,
  usePrintJobs,
} from "@/hooks/usePrinters";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { Printer } from "@/types";

const BLANK = (restaurantId: string): Partial<Printer> & { restaurant_id: string; name: string } => ({
  restaurant_id: restaurantId,
  name: "Kitchen printer",
  kind: "lan_escpos",
  host: "",
  port: 9100,
  columns: 48,
  active: true,
  is_default: true,
});

export default function PrintersSettings() {
  const { data: restaurants = [] } = useRestaurants();
  const { data: printers = [], isLoading } = usePrinters(null);
  const { data: jobs = [] } = usePrintJobs(null, 15);
  const save = useSavePrinter();
  const remove = useDeletePrinter();
  const test = useTestPrint();

  const [draft, setDraft] = useState<(Partial<Printer> & { restaurant_id: string; name: string }) | null>(null);

  const failing = jobs.filter((j) => j.status === "error");
  const waiting = jobs.filter((j) => j.status === "queued" || j.status === "printing");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <PrinterIcon className="h-5 w-5 text-primary" /> Label printers
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Prep labels print themselves whenever a batch is logged — from the app, the
            kitchen tablet or a phone. The app queues the label; the Refresh Watcher on the
            Mac sends it to the printer. That machine has to be running, and it has to be on
            the same network as the printer.
          </p>
        </div>
        {restaurants.length > 0 && (
          <Button size="sm" onClick={() => setDraft(BLANK(restaurants[0].id))}>
            <Plus className="mr-1.5 h-4 w-4" /> Add printer
          </Button>
        )}
      </div>

      {(waiting.length > 0 || failing.length > 0) && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm",
            failing.length
              ? "border-destructive-border bg-destructive-soft text-destructive"
              : "border-border bg-surface-subtle text-muted-foreground"
          )}
        >
          {failing.length ? (
            <>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {failing.length} label{failing.length === 1 ? "" : "s"} failed to print —{" "}
              {failing[0].last_error}
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              {waiting.length} label{waiting.length === 1 ? "" : "s"} waiting. If this doesn't
              clear, the Refresh Watcher isn't running.
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : printers.length === 0 && !draft ? (
        <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
          <PrinterIcon className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">No printers yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Print the SUNMI's self-test (hold the feed button while switching it on) to find
            its IP address, then add it here. Give it a fixed address on your router first —
            if it moves, labels stop.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {printers.map((p) => {
            const venue = restaurants.find((r) => r.id === p.restaurant_id);
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{p.name}</p>
                      {p.is_default && <Badge>Default</Badge>}
                      {!p.active && <Badge variant="outline">Off</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {venue?.name} · {p.host ?? "no IP"}:{p.port} · {p.columns} cols
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    {p.last_error ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" /> {p.last_error}
                      </span>
                    ) : p.last_ok_at ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        printed {formatDistanceToNow(parseISO(p.last_ok_at), { addSuffix: true })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">never used</span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={test.isPending}
                      onClick={() =>
                        test.mutate(p.restaurant_id, {
                          onSuccess: () => toast.success("Test label queued"),
                          onError: (e) =>
                            toast.error(e instanceof Error ? e.message : "Couldn't queue it"),
                        })
                      }
                    >
                      Test print
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDraft(p)}>
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        remove.mutate(p.id, { onSuccess: () => toast.success("Printer removed") })
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="space-y-3 rounded-xl border border-primary/40 bg-card p-4">
          <h3 className="font-semibold text-foreground">
            {draft.id ? "Edit printer" : "New printer"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pname">Name</Label>
              <Input
                id="pname"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pvenue">Venue</Label>
              <select
                id="pvenue"
                value={draft.restaurant_id}
                onChange={(e) => setDraft({ ...draft, restaurant_id: e.target.value })}
                className="h-10 w-full rounded-lg border border-border-strong bg-card px-3 text-sm"
              >
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="phost">IP address</Label>
              <Input
                id="phost"
                placeholder="192.168.1.36"
                value={draft.host ?? ""}
                onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">From the printer's self-test print.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pport">Port</Label>
                <Input
                  id="pport"
                  type="number"
                  value={draft.port ?? 9100}
                  onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pcols">Columns</Label>
                <Input
                  id="pcols"
                  type="number"
                  value={draft.columns ?? 48}
                  onChange={(e) => setDraft({ ...draft, columns: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">48 for 80mm.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="pdefault"
                checked={draft.is_default ?? false}
                onCheckedChange={(v) => setDraft({ ...draft, is_default: v })}
              />
              <Label htmlFor="pdefault">Default for this venue</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="pactive"
                checked={draft.active ?? true}
                onCheckedChange={(v) => setDraft({ ...draft, active: v })}
              />
              <Label htmlFor="pactive">Active</Label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={save.isPending || !draft.name.trim() || !(draft.host ?? "").trim()}
              onClick={() =>
                save.mutate(draft, {
                  onSuccess: () => { toast.success("Printer saved"); setDraft(null); },
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
                })
              }
            >
              Save printer
            </Button>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold text-foreground">Recent labels</h3>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-1.5 text-muted-foreground tabular-nums">
                    {formatDistanceToNow(parseISO(j.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-2 py-1.5 text-foreground">
                    {String(j.payload?.recipeName ?? j.job_type)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        j.status === "done" && "text-success",
                        j.status === "error" && "text-destructive",
                        (j.status === "queued" || j.status === "printing") && "text-muted-foreground"
                      )}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">
                    {j.last_error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
