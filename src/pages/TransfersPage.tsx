import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowLeftRight,
  PlusCircle,
  Trash2,
  Plus,
  ArrowRight,
  Check,
  AlertTriangle,
  PackageOpen,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useInventoryLevels } from "@/hooks/useInventory";
import { useTransfers } from "@/hooks/useTransfers";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { StockTransfer } from "@/types";

type TrackedItem = { id: string; name: string; unit: string | null; category: string | null; track_inventory: boolean };
interface DraftLine { food_cost_item_id: string; qty: string }

const STATUS_META: Record<string, { label: string; cls: string }> = {
  in_transit: { label: "In transit", cls: "bg-amber-500/10 text-amber-600" },
  received:   { label: "Received",   cls: "bg-green-500/10 text-green-600" },
  cancelled:  { label: "Cancelled",  cls: "bg-muted text-muted-foreground" },
};

export default function TransfersPage() {
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const { data: transfers = [], isLoading } = useTransfers(selectedRestaurantId);
  const { data: levels = [] } = useInventoryLevels(selectedRestaurantId);
  const queryClient = useQueryClient();

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const isAll = !selectedRestaurantId;
  const otherVenues = restaurants.filter((r) => r.id !== selectedRestaurantId);

  const [showForm, setShowForm] = useState(false);
  const [toVenue, setToVenue] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ food_cost_item_id: "", qty: "" }]);
  const [received, setReceived] = useState<Record<string, string>>({});

  const { data: foodItems = [] } = useQuery<TrackedItem[]>({
    queryKey: ["food_cost_items_tracked"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_cost_items")
        .select("id, name, unit, category, track_inventory")
        .order("category")
        .order("name");
      if (error) throw error;
      return (data ?? []) as TrackedItem[];
    },
  });

  const itemGroups = useMemo(() => {
    const groups: Record<string, TrackedItem[]> = {};
    for (const it of foodItems) {
      if (!it.track_inventory) continue;
      (groups[it.category ?? "Other"] ??= []).push(it);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [foodItems]);

  const onHand = (itemId: string) => levels.find((l) => l.food_cost_item_id === itemId)?.qty_on_hand ?? 0;
  const itemById = (id: string) => foodItems.find((f) => f.id === id);

  const incoming = transfers.filter((t) => t.to_restaurant_id === selectedRestaurantId && t.status === "in_transit");
  const outgoing = transfers.filter((t) => t.from_restaurant_id === selectedRestaurantId && t.status === "in_transit");
  const history = transfers.filter((t) => t.status !== "in_transit");

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-levels"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
  };

  const { mutate: createTransfer, isPending: creating } = useMutation({
    mutationFn: async () => {
      if (!selectedRestaurantId) throw new Error("Select a source restaurant");
      if (!toVenue) throw new Error("Choose a destination");
      const payload = lines
        .filter((l) => l.food_cost_item_id && Number(l.qty) > 0)
        .map((l) => ({ food_cost_item_id: l.food_cost_item_id, qty_sent: Number(l.qty) }));
      if (payload.length === 0) throw new Error("Add at least one item with a quantity");
      const { error } = await supabase.rpc("create_stock_transfer", {
        p_from_restaurant_id: selectedRestaurantId,
        p_to_restaurant_id: toVenue,
        p_lines: payload,
        p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer sent — awaiting confirmation at the destination");
      setShowForm(false);
      setToVenue("");
      setNotes("");
      setLines([{ food_cost_item_id: "", qty: "" }]);
      invalidateAll();
    },
    onError: (err) => toast.error("Could not send: " + (err as Error).message),
  });

  const { mutate: confirmReceive, isPending: receiving } = useMutation({
    mutationFn: async (t: StockTransfer) => {
      const p_received = (t.lines ?? []).map((ln) => ({
        line_id: ln.id,
        qty_received: received[ln.id] !== undefined ? Number(received[ln.id]) : ln.qty_sent,
      }));
      const { error } = await supabase.rpc("receive_stock_transfer", {
        p_transfer_id: t.id,
        p_received,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer received — stock added to this venue");
      invalidateAll();
    },
    onError: (err) => toast.error("Could not receive: " + (err as Error).message),
  });

  const { mutate: cancelTransfer } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_stock_transfer", { p_transfer_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer cancelled — stock returned to source");
      invalidateAll();
    },
    onError: (err) => toast.error("Could not cancel: " + (err as Error).message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Transfers</h2>
          <span className="text-sm text-muted-foreground">— {restaurant?.name ?? "All Restaurants"}</span>
        </div>
        {!isAll && (
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
            New Transfer
          </Button>
        )}
      </div>

      {isAll && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Select a restaurant to send transfers and confirm incoming stock. Below is a read-only view across venues.
        </div>
      )}

      {/* ── New transfer form ─────────────────────────────────────────────── */}
      {showForm && !isAll && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span>{restaurant?.name}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Select value={toVenue} onValueChange={setToVenue}>
              <SelectTrigger className="w-48 h-8">
                <SelectValue placeholder="Destination venue" />
              </SelectTrigger>
              <SelectContent>
                {otherVenues.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* lines */}
          <div className="space-y-2">
            <div className="hidden sm:grid grid-cols-[1fr_120px_120px_32px] gap-2 px-1">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="text-xs text-muted-foreground">Qty to send</p>
              <p className="text-xs text-muted-foreground">On hand</p>
              <span />
            </div>
            {lines.map((ln, idx) => {
              const item = itemById(ln.food_cost_item_id);
              const avail = ln.food_cost_item_id ? onHand(ln.food_cost_item_id) : null;
              const over = avail !== null && Number(ln.qty) > avail;
              return (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_32px] gap-2 items-start">
                  <Select
                    value={ln.food_cost_item_id || undefined}
                    onValueChange={(val) =>
                      setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, food_cost_item_id: val } : l)))
                    }
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {itemGroups.map(([cat, items]) => (
                        <SelectGroup key={cat}>
                          <SelectLabel>{cat}</SelectLabel>
                          {items.map((it) => (
                            <SelectItem key={it.id} value={it.id}>
                              {it.name} {it.unit ? `(${it.unit})` : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="0"
                    value={ln.qty}
                    onChange={(e) =>
                      setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, qty: e.target.value } : l)))
                    }
                    className={cn(over && "border-destructive")}
                  />
                  <div className="flex items-center h-9 text-sm tabular-nums">
                    {avail !== null ? (
                      <span className={cn(over ? "text-destructive" : "text-muted-foreground")}>
                        {over && <AlertTriangle className="inline h-3 w-3 mr-1 -mt-0.5" />}
                        {avail} {item?.unit}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls))}
                    disabled={lines.length === 1}
                    className="rounded p-1.5 mt-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((ls) => [...ls, { food_cost_item_id: "", qty: "" }])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Item
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tnotes">Notes (optional)</Label>
            <Input id="tnotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. covering Torquay shortage" />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => createTransfer()} disabled={creating}>
              {creating ? "Sending..." : "Send Transfer"}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* ── Incoming (confirm) ────────────────────────────────────────────── */}
      {!isAll && incoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Incoming — confirm receipt</p>
          {incoming.map((t) => (
            <div key={t.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{t.from_restaurant?.name}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{t.to_restaurant?.name}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  sent {format(parseISO(t.sent_at), "d MMM yyyy")}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_90px_110px] gap-2 px-1 text-xs text-muted-foreground">
                  <span>Item</span><span className="text-right">Sent</span><span className="text-right">Received</span>
                </div>
                {(t.lines ?? []).map((ln) => (
                  <div key={ln.id} className="grid grid-cols-[1fr_90px_110px] gap-2 items-center">
                    <span className="text-sm text-foreground truncate">
                      {ln.food_cost_item?.name}
                      <span className="text-xs text-muted-foreground"> @ {formatCurrency(ln.unit_cost)}/{ln.food_cost_item?.unit}</span>
                    </span>
                    <span className="text-sm text-right tabular-nums text-muted-foreground">
                      {ln.qty_sent} {ln.food_cost_item?.unit}
                    </span>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      max={ln.qty_sent}
                      value={received[ln.id] ?? String(ln.qty_sent)}
                      onChange={(e) => setReceived((m) => ({ ...m, [ln.id]: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
              {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
              <Button size="sm" disabled={receiving} onClick={() => confirmReceive(t)}>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Confirm Receipt
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── Outgoing in-transit (cancel) ──────────────────────────────────── */}
      {!isAll && outgoing.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Sent — awaiting confirmation</p>
          {outgoing.map((t) => (
            <TransferRow key={t.id} t={t} onCancel={() => cancelTransfer(t.id)} cancellable />
          ))}
        </div>
      )}

      {/* ── History / all ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{isAll ? "All transfers" : "History"}</p>
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (isAll ? transfers : history).length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No transfers yet.</p>
          </div>
        ) : (
          (isAll ? transfers : history).map((t) => <TransferRow key={t.id} t={t} />)
        )}
      </div>
    </div>
  );
}

function TransferRow({
  t,
  onCancel,
  cancellable,
}: {
  t: StockTransfer;
  onCancel?: () => void;
  cancellable?: boolean;
}) {
  const meta = STATUS_META[t.status];
  const totalUnits = (t.lines ?? []).reduce((s, l) => s + (l.qty_sent ?? 0), 0);
  const totalValue = (t.lines ?? []).reduce((s, l) => s + (l.qty_sent ?? 0) * (l.unit_cost ?? 0), 0);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-foreground">{t.from_restaurant?.name}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-foreground">{t.to_restaurant?.name}</span>
        <span className={cn("ml-2 text-xs px-2 py-0.5 rounded-full", meta?.cls)}>{meta?.label}</span>
        <span className="text-xs text-muted-foreground ml-auto">{format(parseISO(t.sent_at), "d MMM yyyy")}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {(t.lines ?? []).map((ln) => (
          <span key={ln.id} className="text-xs text-muted-foreground">
            {ln.food_cost_item?.name}: <span className="text-foreground tabular-nums">{ln.qty_sent} {ln.food_cost_item?.unit}</span>
            {ln.qty_received != null && ln.qty_received !== ln.qty_sent && (
              <span className="text-red-500"> (recv {ln.qty_received})</span>
            )}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {(t.lines ?? []).length} item{(t.lines ?? []).length !== 1 ? "s" : ""} · {totalUnits} units · {formatCurrency(totalValue)}
        </p>
        {cancellable && onCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-destructive border-destructive/40">Cancel</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this transfer?</AlertDialogTitle>
                <AlertDialogDescription>
                  The sent stock returns to {t.from_restaurant?.name}. This can only be done before the destination confirms receipt.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction onClick={onCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Cancel transfer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
