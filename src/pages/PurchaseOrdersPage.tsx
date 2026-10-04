import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, addDays } from "date-fns";
import {
  ShoppingCart, Plus, Send, Package, CheckCircle2, XCircle, FileText, Trash2,
  Pencil, Loader2, Search, X, ChevronLeft, Mail, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ============================================================================
// ORDERING
// ----------------------------------------------------------------------------
// Pick a supplier → enter quantities against their catalogue → Send. The app
// emails the order to the supplier (edge function send-purchase-order), with
// replies going to whoever sent it. Drafts can be saved and sent later.
// ============================================================================

// ─── Types (InvoicesPage imports these) ──────────────────────────────────────

export type POStatus = "draft" | "sent" | "received" | "invoiced" | "cancelled";

export interface POItem {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
}

export interface PurchaseOrder {
  id: string;
  restaurant_id: string;
  po_number: string;
  supplier_name: string;
  supplier_email: string | null;
  order_date: string;
  expected_delivery: string | null;
  status: POStatus;
  items: POItem[];
  total_amount: number;
  notes: string | null;
  invoice_id: string | null;
  created_by: string | null;
  created_at: string;
  /** Migration 085 */
  sent_at?: string | null;
  sent_to?: string | null;
  send_count?: number;
}

interface Supplier {
  id: string;
  name: string;
  email: string | null;
  category: string | null;
}

interface Line {
  key: string;
  description: string;
  unit: string;
  unit_price: number;
  qty: string;
  custom?: boolean;
}

// ─── Status ──────────────────────────────────────────────────────────────────

const STATUS: Record<POStatus, { label: string; cls: string; icon: typeof Send }> = {
  draft:     { label: "Not sent",  cls: "bg-surface-sunken text-muted-foreground", icon: FileText },
  sent:      { label: "Sent",      cls: "bg-primary-soft text-primary",           icon: Send },
  received:  { label: "Received",  cls: "bg-warning-soft text-warning",           icon: Package },
  invoiced:  { label: "Invoiced",  cls: "bg-success-soft text-success",           icon: CheckCircle2 },
  cancelled: { label: "Cancelled", cls: "bg-destructive-soft text-destructive",   icon: XCircle },
};

function StatusPill({ status }: { status: POStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", s.cls)}>
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

type Filter = "open" | "draft" | "sent" | "done";

const FILTERS: { key: Filter; label: string; match: (s: POStatus) => boolean }[] = [
  { key: "open",  label: "Open",      match: (s) => s === "draft" || s === "sent" || s === "received" },
  { key: "draft", label: "Not sent",  match: (s) => s === "draft" },
  { key: "sent",  label: "Awaiting delivery", match: (s) => s === "sent" },
  { key: "done",  label: "Done",      match: (s) => s === "invoiced" || s === "cancelled" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

function generatePONumber(): string {
  return `PO-${format(new Date(), "yyyyMMdd")}-${Math.floor(Math.random() * 900) + 100}`;
}

const lineKey = (description: string, unit: string) =>
  `${description.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;

interface SendResult {
  sent_to: string;
  from: string;
  reply_to: string | null;
}

function sentMessage(r: SendResult): string {
  return `Order sent to ${r.sent_to}${r.reply_to ? ` — replies go to ${r.reply_to}` : ""}`;
}

async function sendOrder(poId: string): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke("send-purchase-order", {
    body: { po_id: poId },
  });
  // Surface the function's own message ("Add the supplier's email…") when it has one.
  if (error) {
    let msg = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) msg = body.error;
    } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadCatalogue(supplierId: string): Promise<Line[]> {
  const { data } = await supabase
    .from("supplier_items")
    .select("description, unit, typical_price, alt_prices")
    .eq("supplier_id", supplierId)
    .order("display_order");
  const lines: Line[] = [];
  for (const item of data ?? []) {
    lines.push({
      key: lineKey(item.description, item.unit),
      description: item.description,
      unit: item.unit,
      unit_price: Number(item.typical_price) || 0,
      qty: "",
    });
    for (const alt of (item.alt_prices as { unit: string; price: number }[]) ?? []) {
      lines.push({
        key: lineKey(item.description, alt.unit),
        description: item.description,
        unit: alt.unit,
        unit_price: Number(alt.price) || 0,
        qty: "",
      });
    }
  }
  return lines;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter>("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ po: PurchaseOrder | null } | null>(null);

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const allRestaurantIds = restaurants.map((r) => r.id);

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers", "ordering"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, email, category")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase_orders", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("purchase_orders").select("*").order("created_at", { ascending: false });
      q = selectedRestaurantId ? q.eq("restaurant_id", selectedRestaurantId) : q.in("restaurant_id", allRestaurantIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PurchaseOrder[];
    },
    enabled: selectedRestaurantId ? true : allRestaurantIds.length > 0,
  });

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, orders.filter((o) => f.match(o.status)).length])),
    [orders]
  ) as Record<Filter, number>;

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    return orders.filter((o) => f.match(o.status));
  }, [orders, filter]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });

  const send = useMutation({
    mutationFn: sendOrder,
    onSuccess: (r) => {
      toast.success(sentMessage(r));
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: POStatus }) => {
      const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      toast.success(`Marked ${STATUS[status].label.toLowerCase()}`);
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Order deleted");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Ordering</h2>
          <span className="text-sm text-muted-foreground">— {restaurant?.name ?? "All venues"}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!selectedRestaurantId && (
            <span className="text-xs text-muted-foreground">Pick one venue to place an order</span>
          )}
          <Button onClick={() => setEditor({ po: null })} disabled={!selectedRestaurantId}>
            <Plus className="h-4 w-4 mr-1.5" />
            New order
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex w-fit gap-1 rounded-lg border border-border bg-card p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <ShoppingCart className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filter === "open" ? "No open orders." : "Nothing here."}
          </p>
          {filter === "open" && selectedRestaurantId && (
            <Button size="sm" className="mt-3" onClick={() => setEditor({ po: null })}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New order
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {shown.map((po) => (
            <OrderRow
              key={po.id}
              po={po}
              venueName={!selectedRestaurantId ? restaurants.find((r) => r.id === po.restaurant_id)?.name : undefined}
              expanded={expandedId === po.id}
              onToggle={() => setExpandedId(expandedId === po.id ? null : po.id)}
              sending={send.isPending && send.variables === po.id}
              onSend={() => send.mutate(po.id)}
              onEdit={() => setEditor({ po })}
              onStatus={(status) => updateStatus.mutate({ id: po.id, status })}
              onDelete={() => remove.mutate(po.id)}
            />
          ))}
        </div>
      )}

      {editor && selectedRestaurantId && (
        <OrderEditor
          key={editor.po?.id ?? "new"}
          po={editor.po}
          restaurantId={editor.po?.restaurant_id ?? selectedRestaurantId}
          suppliers={suppliers}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function OrderRow({
  po, venueName, expanded, onToggle, sending, onSend, onEdit, onStatus, onDelete,
}: {
  po: PurchaseOrder;
  venueName?: string;
  expanded: boolean;
  onToggle: () => void;
  sending: boolean;
  onSend: () => void;
  onEdit: () => void;
  onStatus: (s: POStatus) => void;
  onDelete: () => void;
}) {
  const hasEmail = !!po.supplier_email && isEmail(po.supplier_email);
  const itemCount = po.items.length;

  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-subtle">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{po.supplier_name}</p>
            <StatusPill status={po.status} />
            {venueName && <span className="text-xs text-muted-foreground">{venueName}</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {format(parseISO(po.order_date), "EEE d MMM")}
            {po.expected_delivery && ` · Delivery ${format(parseISO(po.expected_delivery), "EEE d MMM")}`}
            {` · ${itemCount} item${itemCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatCurrency(po.total_amount)}</p>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border bg-surface-subtle px-4 py-4">
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {po.items.map((i, idx) => (
              <li key={idx} className="flex items-center gap-3 px-3 py-2">
                <span className="w-24 shrink-0 font-medium tabular-nums text-foreground">
                  {i.quantity} {i.unit}
                </span>
                <span className="flex-1 text-foreground">{i.description}</span>
                <span className="tabular-nums text-muted-foreground">{formatCurrency(i.quantity * i.unit_price)}</span>
              </li>
            ))}
          </ul>

          {po.notes && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {po.notes}
            </p>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            {po.sent_at
              ? `Emailed to ${po.sent_to} · ${format(parseISO(po.sent_at), "EEE d MMM, h:mm a")}${(po.send_count ?? 0) > 1 ? ` · sent ${po.send_count}×` : ""}`
              : hasEmail
                ? `Will be emailed to ${po.supplier_email}`
                : "No supplier email — edit the order to add one"}
            {` · ${po.po_number}`}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {po.status === "draft" && (
              <>
                <Button size="sm" onClick={onSend} disabled={!hasEmail || sending}>
                  {sending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                  Send to supplier
                </Button>
                <Button size="sm" variant="outline" onClick={onEdit}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              </>
            )}
            {po.status === "sent" && (
              <>
                <Button size="sm" onClick={() => onStatus("received")}>
                  <Package className="h-3.5 w-3.5 mr-1.5" />
                  Delivery received
                </Button>
                <Button size="sm" variant="outline" onClick={onSend} disabled={!hasEmail || sending}>
                  {sending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                  Resend
                </Button>
              </>
            )}
            {po.status === "received" && (
              <>
                <Button size="sm" variant="outline" onClick={() => onStatus("invoiced")}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark invoiced
                </Button>
                {!po.invoice_id && (
                  <Link
                    to="/admin/food/invoices"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Enter the invoice →
                  </Link>
                )}
              </>
            )}

            <div className="ml-auto flex items-center gap-1">
              {(po.status === "draft" || po.status === "sent") && (
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onStatus("cancelled")}>
                  Cancel order
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Delete order">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Permanently deletes {po.po_number} for {po.supplier_name}.
                      {po.status !== "draft" && " It's already been sent — the supplier won't be told."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function OrderEditor({
  po, restaurantId, suppliers, onClose, onSaved,
}: {
  po: PurchaseOrder | null;
  restaurantId: string;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const { isSuperadmin } = usePermissions();
  const queryClient = useQueryClient();
  const { data: restaurants = [] } = useRestaurants();
  const venueOrdersEmail = restaurants.find((r) => r.id === restaurantId)?.orders_email ?? null;

  const [supplier, setSupplier] = useState<Supplier | null>(() =>
    po ? suppliers.find((s) => s.name === po.supplier_name) ?? { id: "", name: po.supplier_name, email: po.supplier_email, category: null } : null
  );
  const [supplierSearch, setSupplierSearch] = useState("");
  const [otherName, setOtherName] = useState("");
  const [email, setEmail] = useState(po?.supplier_email ?? "");
  const [saveEmail, setSaveEmail] = useState(true);
  const [delivery, setDelivery] = useState(po?.expected_delivery ?? format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [notes, setNotes] = useState(po?.notes ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [onlyOrdered, setOnlyOrdered] = useState(false);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);

  // Load the supplier's catalogue; when editing, lay the saved quantities over it.
  async function pickSupplier(s: Supplier) {
    setSupplier(s);
    if (!po || po.supplier_name !== s.name) setEmail(s.email ?? "");
    setLoadingLines(true);
    try {
      const catalogue = s.id ? await loadCatalogue(s.id) : [];
      const saved = po && po.supplier_name === s.name ? po.items : [];
      const byKey = new Map(catalogue.map((l) => [l.key, l]));
      const extra: Line[] = [];
      for (const it of saved) {
        const k = lineKey(it.description, it.unit);
        const hit = byKey.get(k);
        if (hit) hit.qty = String(it.quantity);
        else extra.push({ key: `custom-${extra.length}-${k}`, description: it.description, unit: it.unit, unit_price: it.unit_price, qty: String(it.quantity), custom: true });
      }
      const all = [...catalogue, ...extra];
      setLines(all.length ? all : [newCustomLine()]);
      setOnlyOrdered(!!po && saved.length > 0 && catalogue.length > 12);
    } finally {
      setLoadingLines(false);
    }
  }

  // Editing an existing draft: open straight on its supplier's catalogue.
  useEffect(() => {
    if (po && supplier) void pickSupplier(supplier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setQty = (key: string, qty: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty } : l)));
  const patchLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const ordered = lines.filter((l) => Number(l.qty) > 0 && l.description.trim());
  const total = ordered.reduce((s, l) => s + Number(l.qty) * l.unit_price, 0);
  const q = itemSearch.trim().toLowerCase();
  const visible = lines.filter(
    (l) =>
      (!onlyOrdered || Number(l.qty) > 0 || l.custom) &&
      (!q || l.description.toLowerCase().includes(q) || l.unit.toLowerCase().includes(q))
  );

  const emailOk = isEmail(email);
  const canSave = !!supplier && ordered.length > 0;
  const emailChanged = !!supplier?.id && emailOk && email.trim() !== (supplier.email ?? "");

  async function save(andSend: boolean) {
    if (!supplier || !profile) return;
    if (!ordered.length) return toast.error("Enter a quantity for at least one item");
    if (andSend && !emailOk) return toast.error("Add the supplier's email to send");
    setBusy(andSend ? "send" : "draft");
    try {
      const items: POItem[] = ordered.map((l) => ({
        description: l.description.trim(),
        quantity: Number(l.qty),
        unit: l.unit.trim() || "ea",
        unit_price: l.unit_price,
      }));
      const payload = {
        restaurant_id: restaurantId,
        supplier_name: supplier.name,
        supplier_email: email.trim() || null,
        expected_delivery: delivery || null,
        items,
        total_amount: Math.round(total * 100) / 100,
        notes: notes.trim() || null,
      };

      let id = po?.id;
      if (id) {
        const { error } = await supabase.from("purchase_orders").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("purchase_orders")
          .insert({
            ...payload,
            po_number: generatePONumber(),
            order_date: format(new Date(), "yyyy-MM-dd"),
            status: "draft",
            created_by: profile.id,
          })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id as string;
      }

      // Keep the supplier record's email current (superadmins manage suppliers).
      if (isSuperadmin && saveEmail && emailChanged) {
        await supabase.from("suppliers").update({ email: email.trim() }).eq("id", supplier.id);
        queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      }

      if (andSend) {
        const r = await sendOrder(id!);
        toast.success(sentMessage(r));
      } else {
        toast.success("Saved — not sent yet");
      }
      onSaved();
      onClose();
    } catch (e) {
      // A send failure leaves a saved draft behind — say so.
      toast.error(`${(e as Error).message}${andSend ? " — the order is saved as not sent." : ""}`);
      onSaved();
    } finally {
      setBusy(null);
    }
  }

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(supplierSearch.trim().toLowerCase())
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle>{po ? "Edit order" : "New order"}</SheetTitle>
          <SheetDescription>
            {supplier ? (
              <span className="flex items-center gap-2">
                <span className="font-medium text-foreground">{supplier.name}</span>
                {!po && (
                  <button className="inline-flex items-center text-xs text-primary hover:underline" onClick={() => { setSupplier(null); setLines([]); }}>
                    <ChevronLeft className="h-3 w-3" /> Change
                  </button>
                )}
              </span>
            ) : (
              "Who are you ordering from?"
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Step 1 — supplier */}
        {!supplier ? (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {suppliers.length > 6 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Search suppliers" className="pl-8" />
              </div>
            )}
            <div className="space-y-1.5">
              {filteredSuppliers.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pickSupplier(s)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.email ?? "No email on file"}
                      {s.category && ` · ${s.category}`}
                    </p>
                  </div>
                  {!s.email && <AlertCircle className="h-4 w-4 shrink-0 text-warning" />}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="Someone else — type a name" />
              <Button
                variant="outline"
                disabled={!otherName.trim()}
                onClick={() => pickSupplier({ id: "", name: otherName.trim(), email: null, category: null })}
              >
                Use
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Step 2 — items */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="po-email">Send to</Label>
                  <Input
                    id="po-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="orders@supplier.com.au"
                    className={cn(email && !emailOk && "border-destructive")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {venueOrdersEmail ? (
                      <>Supplier replies go to {venueOrdersEmail}.</>
                    ) : (
                      <>
                        Supplier replies go to you.{" "}
                        {isSuperadmin && (
                          <Link to="/admin/settings/venues" className="text-primary hover:underline">
                            Set a venue reply email
                          </Link>
                        )}
                      </>
                    )}
                  </p>
                  {isSuperadmin && emailChanged && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={saveEmail} onCheckedChange={(c) => setSaveEmail(!!c)} />
                      Save as {supplier.name}'s email
                    </label>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="po-delivery">Delivery</Label>
                  <Input id="po-delivery" type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Find an item" className="pl-8 pr-8" />
                    {itemSearch && (
                      <button onClick={() => setItemSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label="Clear search">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setOnlyOrdered((v) => !v)}
                    className={cn(
                      "whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                      onlyOrdered ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-accent"
                    )}
                  >
                    In order ({ordered.length})
                  </button>
                </div>

                {loadingLines ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading {supplier.name}'s items…
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {visible.map((l) => {
                      const on = Number(l.qty) > 0;
                      return (
                        <div key={l.key} className={cn("flex items-center gap-3 px-3 py-2", on && "bg-primary-softer")}>
                          <div className="min-w-0 flex-1">
                            {l.custom ? (
                              <div className="flex gap-2">
                                <Input value={l.description} onChange={(e) => patchLine(l.key, { description: e.target.value })} placeholder="Item" className="h-8" />
                                <Input value={l.unit} onChange={(e) => patchLine(l.key, { unit: e.target.value })} placeholder="unit" className="h-8 w-20" />
                              </div>
                            ) : (
                              <>
                                <p className={cn("truncate text-sm", on ? "font-medium text-foreground" : "text-foreground")}>{l.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  {l.unit}{l.unit_price ? ` · ${formatCurrency(l.unit_price)}` : ""}
                                </p>
                              </>
                            )}
                          </div>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={l.qty}
                            onChange={(e) => setQty(l.key, e.target.value)}
                            placeholder="0"
                            className="h-9 w-20 text-right tabular-nums"
                            aria-label={`Quantity of ${l.description || "item"}`}
                          />
                          {l.custom && (
                            <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remove item">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {visible.length === 0 && (
                      <p className="px-3 py-4 text-sm text-muted-foreground">
                        {onlyOrdered ? "Nothing in the order yet." : "No items match."}
                      </p>
                    )}
                  </div>
                )}
                <Button variant="ghost" size="sm" onClick={() => { setItemSearch(""); setOnlyOrdered(false); setLines((ls) => [...ls, newCustomLine()]); }}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add an item that's not listed
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="po-notes">Note to supplier (optional)</Label>
                <Textarea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Back door before 8am" />
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-3">
              <div className="mr-auto">
                <p className="text-xs text-muted-foreground">{ordered.length} item{ordered.length === 1 ? "" : "s"}</p>
                <p className="text-base font-semibold tabular-nums text-foreground">{formatCurrency(total)}</p>
              </div>
              <Button variant="outline" onClick={() => save(false)} disabled={!canSave || !!busy}>
                {busy === "draft" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save for later
              </Button>
              <Button onClick={() => save(true)} disabled={!canSave || !emailOk || !!busy} title={emailOk ? `Email to ${email}` : "Add the supplier's email"}>
                {busy === "send" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                Send order
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

let customSeq = 0;
function newCustomLine(): Line {
  customSeq += 1;
  return { key: `custom-new-${customSeq}`, description: "", unit: "ea", unit_price: 0, qty: "", custom: true };
}
