import { useState, useMemo, useCallback } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import type { Resolver } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ShoppingCart,
  PlusCircle,
  Trash2,
  Mail,
  ChevronDown,
  ChevronUp,
  Plus,
  CheckCircle2,
  Clock,
  Send,
  Package,
  FileText,
  XCircle,
  Copy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
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

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface SupplierRow {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const poItemSchema = z.object({
  description: z.string().min(1, "Required"),
  quantity: z.coerce.number().positive("Must be > 0"),
  unit: z.string().min(1, "Required"),
  unit_price: z.coerce.number().min(0, "Must be ≥ 0"),
});

const poSchema = z.object({
  supplier_name: z.string().min(1, "Supplier is required"),
  custom_supplier: z.string().optional(),
  supplier_email: z.string().email("Invalid email").or(z.literal("")).optional(),
  order_date: z.string().min(1, "Date is required"),
  expected_delivery: z.string().optional(),
  items: z.array(poItemSchema).min(1, "Add at least one item"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof poSchema>;

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  POStatus,
  { label: string; colour: string; icon: React.ComponentType<{ className?: string }> }
> = {
  draft:     { label: "Draft",     colour: "bg-muted text-muted-foreground",      icon: FileText     },
  sent:      { label: "Sent",      colour: "bg-blue-500/10 text-blue-500",        icon: Send         },
  received:  { label: "Received",  colour: "bg-amber-500/10 text-amber-500",      icon: Package      },
  invoiced:  { label: "Invoiced",  colour: "bg-green-500/10 text-green-500",      icon: CheckCircle2 },
  cancelled: { label: "Cancelled", colour: "bg-destructive/10 text-destructive",  icon: XCircle      },
};

function StatusBadge({ status }: { status: POStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", cfg.colour)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generatePONumber(): string {
  const datePart = format(new Date(), "yyyyMMdd");
  const rand = Math.floor(Math.random() * 900) + 100;
  return `PO-${datePart}-${rand}`;
}

export function buildPOText(po: PurchaseOrder, restaurantName: string): string {
  const itemLines = po.items
    .map(
      (item, i) =>
        `${i + 1}. ${item.description} — Qty: ${item.quantity} ${item.unit} @ $${item.unit_price.toFixed(2)} = $${(item.quantity * item.unit_price).toFixed(2)}`
    )
    .join("\n");

  return [
    `Dear ${po.supplier_name},`,
    ``,
    `Please find below Purchase Order ${po.po_number} from ${restaurantName}.`,
    ``,
    `Order Date: ${format(parseISO(po.order_date), "d MMMM yyyy")}`,
    po.expected_delivery
      ? `Expected Delivery: ${format(parseISO(po.expected_delivery), "d MMMM yyyy")}`
      : null,
    ``,
    `ITEMS ORDERED`,
    `─────────────────────────────────────────`,
    itemLines,
    `─────────────────────────────────────────`,
    `TOTAL: $${po.total_amount.toFixed(2)} AUD`,
    ``,
    po.notes ? `Notes: ${po.notes}` : null,
    ``,
    `Please confirm receipt of this order and advise of any issues.`,
    ``,
    `Thank you,`,
    restaurantName,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

function buildMailtoLink(po: PurchaseOrder, restaurantName: string): string {
  const subject = encodeURIComponent(`Purchase Order ${po.po_number} — ${restaurantName}`);
  const body = encodeURIComponent(buildPOText(po, restaurantName));
  const to = po.supplier_email ? encodeURIComponent(po.supplier_email) : "";
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<POStatus | "all">("all");

  const { profile } = useAuth();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const queryClient = useQueryClient();

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);

  const { data: supplierRows = [] } = useQuery<SupplierRow[]>({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, category, active")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SupplierRow[];
    },
  });

  const allSuppliers = supplierRows.map((s) => s.name);

  const allRestaurantIds = restaurants.map((r) => r.id);

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase_orders", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("purchase_orders").select("*").order("created_at", { ascending: false });
      if (selectedRestaurantId) {
        q = q.eq("restaurant_id", selectedRestaurantId);
      } else if (allRestaurantIds.length > 0) {
        q = q.in("restaurant_id", allRestaurantIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PurchaseOrder[];
    },
    enabled: selectedRestaurantId ? true : allRestaurantIds.length > 0,
  });

  const filtered = useMemo(
    () => (statusFilter === "all" ? orders : orders.filter((o) => o.status === statusFilter)),
    [orders, statusFilter]
  );

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(poSchema) as Resolver<FormValues>,
    defaultValues: {
      supplier_name: "",
      custom_supplier: "",
      supplier_email: "",
      order_date: format(new Date(), "yyyy-MM-dd"),
      expected_delivery: "",
      items: [{ description: "", quantity: 1, unit: "kg", unit_price: 0 }],
      notes: "",
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: "items" });
  const [loadingItems, setLoadingItems] = useState(false);
  const watchedItems = watch("items");
  const supplierValue = watch("supplier_name");

  const runningTotal = watchedItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  );

  const handleSupplierChange = useCallback(
    async (supplierName: string) => {
      setValue("supplier_name", supplierName);
      if (supplierName === "__custom__") return;

      const supplierRow = supplierRows.find((s) => s.name === supplierName);
      if (!supplierRow) return;

      // Auto-fill email if available
      const { data: fullSupplier } = await supabase
        .from("suppliers")
        .select("email")
        .eq("id", supplierRow.id)
        .single();
      if (fullSupplier?.email) setValue("supplier_email", fullSupplier.email);

      // Fetch catalogue items
      setLoadingItems(true);
      try {
        const { data: items } = await supabase
          .from("supplier_items")
          .select("description, unit, typical_price")
          .eq("supplier_id", supplierRow.id)
          .order("display_order");

        if (items && items.length > 0) {
          replace(
            items.map((item) => ({
              description: item.description,
              quantity: 1,
              unit: item.unit,
              unit_price: item.typical_price,
            }))
          );
          toast.info(`${items.length} items loaded from ${supplierName} — enter quantities`);
        }
      } finally {
        setLoadingItems(false);
      }
    },
    [supplierRows, setValue, replace]
  );

  const { mutate: createOrder, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!selectedRestaurantId || !profile) throw new Error("Not authenticated");
      const supplier =
        values.supplier_name === "__custom__"
          ? (values.custom_supplier ?? "").trim()
          : values.supplier_name;
      if (!supplier) throw new Error("Supplier name is required");

      const items: POItem[] = values.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        unit_price: Number(item.unit_price),
      }));

      const total = Math.round(items.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100) / 100;

      const { error } = await supabase.from("purchase_orders").insert({
        restaurant_id: selectedRestaurantId,
        po_number: generatePONumber(),
        supplier_name: supplier,
        supplier_email: values.supplier_email || null,
        order_date: values.order_date,
        expected_delivery: values.expected_delivery || null,
        status: "draft",
        items,
        total_amount: total,
        notes: values.notes || null,
        created_by: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Purchase order created — open it below to email your supplier.");
      reset({
        supplier_name: "",
        custom_supplier: "",
        supplier_email: "",
        order_date: format(new Date(), "yyyy-MM-dd"),
        expected_delivery: "",
        items: [{ description: "", quantity: 1, unit: "kg", unit_price: 0 }],
        notes: "",
      });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["purchase_orders", selectedRestaurantId] });
    },
    onError: (err) => toast.error("Failed to save: " + (err as Error).message),
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: POStatus }) => {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      toast.success(`Marked as ${STATUS_CONFIG[status].label.toLowerCase()}`);
      queryClient.invalidateQueries({ queryKey: ["purchase_orders", selectedRestaurantId] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: deleteOrder } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Purchase order deleted");
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const isAllRestaurants = !selectedRestaurantId;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Purchase Orders</h2>
          <span className="text-sm text-muted-foreground">
            — {restaurant?.name ?? "All Restaurants"}
          </span>
        </div>
        {!isAllRestaurants && (
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
            New PO
          </Button>
        )}
      </div>

      {/* All-restaurants banner */}
      {isAllRestaurants && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Select a specific restaurant to create purchase orders.
        </div>
      )}

      {/* Create form */}
      {showForm && !isAllRestaurants && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">New Purchase Order</h3>
          <form onSubmit={handleSubmit((v) => createOrder(v))} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                {allSuppliers.length > 0 ? (
                  <Select
                    value={supplierValue}
                    onValueChange={handleSupplierChange}
                  >
                    <SelectTrigger className={cn(errors.supplier_name && "border-destructive")}>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {allSuppliers.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">Other (type below)</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Supplier name"
                    {...register("supplier_name")}
                    className={cn(errors.supplier_name && "border-destructive")}
                  />
                )}
                {errors.supplier_name && (
                  <p className="text-xs text-destructive">{errors.supplier_name.message}</p>
                )}
                {supplierValue === "__custom__" && (
                  <Input
                    placeholder="Type supplier name"
                    {...register("custom_supplier")}
                    className="mt-1.5"
                    autoFocus
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="supplier_email">Supplier Email (to email PO)</Label>
                <Input
                  id="supplier_email"
                  type="email"
                  placeholder="orders@supplier.com"
                  {...register("supplier_email")}
                  className={cn(errors.supplier_email && "border-destructive")}
                />
                {errors.supplier_email && (
                  <p className="text-xs text-destructive">{errors.supplier_email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="order_date">Order Date</Label>
                <Input
                  id="order_date"
                  type="date"
                  {...register("order_date")}
                  className={cn(errors.order_date && "border-destructive")}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="expected_delivery">Expected Delivery (optional)</Label>
                <Input id="expected_delivery" type="date" {...register("expected_delivery")} />
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label>Items</Label>
                  {loadingItems && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading catalogue…
                    </span>
                  )}
                </div>
                {errors.items && !Array.isArray(errors.items) && (
                  <p className="text-xs text-destructive">{(errors.items as { message?: string }).message}</p>
                )}
              </div>
              <div className="hidden sm:grid grid-cols-[1fr_80px_80px_100px_32px] gap-2 px-1">
                <p className="text-xs text-muted-foreground">Description</p>
                <p className="text-xs text-muted-foreground">Qty</p>
                <p className="text-xs text-muted-foreground">Unit</p>
                <p className="text-xs text-muted-foreground">Unit Price</p>
                <span />
              </div>
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_80px_80px_100px_32px] gap-2 items-start"
                  >
                    <Input
                      placeholder="e.g. Chicken breast"
                      {...register(`items.${index}.description`)}
                      className={cn(errors.items?.[index]?.description && "border-destructive")}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="1"
                      {...register(`items.${index}.quantity`)}
                      className={cn(errors.items?.[index]?.quantity && "border-destructive")}
                    />
                    <Input
                      placeholder="kg"
                      {...register(`items.${index}.unit`)}
                      className={cn(errors.items?.[index]?.unit && "border-destructive")}
                    />
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className={cn("pl-7", errors.items?.[index]?.unit_price && "border-destructive")}
                        {...register(`items.${index}.unit_price`)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => fields.length > 1 && remove(index)}
                      disabled={fields.length === 1}
                      className="rounded p-1.5 mt-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ description: "", quantity: 1, unit: "kg", unit_price: 0 })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Item
                </Button>
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  Total: {formatCurrency(runningTotal)}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes / Special Instructions (optional)</Label>
              <Textarea
                id="notes"
                placeholder="e.g. Please deliver to back entrance before 8am"
                rows={2}
                {...register("notes")}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Create Purchase Order"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Stats / filter pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["all", "sent", "received", "invoiced"] as const).map((s) => {
          const count = s === "all" ? orders.length : orders.filter((o) => o.status === s).length;
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                isActive ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent"
              )}
            >
              <p className="text-xs text-muted-foreground capitalize mb-0.5">
                {s === "all" ? "All Orders" : STATUS_CONFIG[s].label}
              </p>
              <p className={cn("text-xl font-bold tabular-nums", isActive ? "text-primary" : "text-foreground")}>
                {count}
              </p>
            </button>
          );
        })}
      </div>

      {/* Orders list */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ShoppingCart className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "all"
              ? "No purchase orders yet."
              : `No ${STATUS_CONFIG[statusFilter].label.toLowerCase()} orders.`}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map((po) => {
              const poRestaurant = restaurants.find((r) => r.id === po.restaurant_id);
              return (
              <PORow
                key={po.id}
                po={po}
                restaurantName={poRestaurant ? `Pollo ${poRestaurant.name}` : ""}
                showRestaurant={isAllRestaurants}
                restaurantLabel={poRestaurant?.name}
                expanded={expandedId === po.id}
                onToggle={() => setExpandedId(expandedId === po.id ? null : po.id)}
                onStatusChange={(status) => updateStatus({ id: po.id, status })}
                onDelete={() => deleteOrder(po.id)}
              />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PO Row ───────────────────────────────────────────────────────────────────

function PORow({
  po,
  restaurantName,
  showRestaurant,
  restaurantLabel,
  expanded,
  onToggle,
  onStatusChange,
  onDelete,
}: {
  po: PurchaseOrder;
  restaurantName: string;
  showRestaurant?: boolean;
  restaurantLabel?: string;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (status: POStatus) => void;
  onDelete: () => void;
}) {
  const needsInvoice = (po.status === "sent" || po.status === "received") && !po.invoice_id;

  function copyText() {
    navigator.clipboard.writeText(buildPOText(po, restaurantName));
    toast.success("PO copied to clipboard");
  }

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground">{po.po_number}</p>
            <p className="text-sm text-muted-foreground">{po.supplier_name}</p>
            <StatusBadge status={po.status} />
            {needsInvoice && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-500">
                <Clock className="h-3 w-3" />
                Invoice pending
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {showRestaurant && restaurantLabel && (
              <span className="font-medium text-foreground mr-1.5">{restaurantLabel}</span>
            )}
            {format(parseISO(po.order_date), "d MMM yyyy")}
            {po.expected_delivery &&
              ` · Delivery: ${format(parseISO(po.expected_delivery), "d MMM yyyy")}`}
            {` · ${po.items.length} item${po.items.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">
          {formatCurrency(po.total_amount)}
        </p>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/20 px-4 py-4 space-y-4">
          {/* Items table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Qty</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Unit</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Unit Price</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {po.items.map((item, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-foreground">{item.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{item.quantity}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatCurrency(item.unit_price)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">
                      {formatCurrency(item.quantity * item.unit_price)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/30">
                  <td colSpan={4} className="px-3 py-2 text-xs font-medium text-muted-foreground text-right">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-foreground">
                    {formatCurrency(po.total_amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {po.notes && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {po.notes}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Email PO — opens mailto: with pre-filled content */}
            <a
              href={buildMailtoLink(po, restaurantName)}
              onClick={(e) => {
                e.stopPropagation();
                if (po.status === "draft") onStatusChange("sent");
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Mail className="h-3.5 w-3.5" />
              Email PO
            </a>

            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); copyText(); }}>
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy Text
            </Button>

            {po.status === "draft" && (
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onStatusChange("sent"); }}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Mark Sent
              </Button>
            )}
            {po.status === "sent" && (
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onStatusChange("received"); }}>
                <Package className="h-3.5 w-3.5 mr-1.5" />
                Mark Received
              </Button>
            )}
            {(po.status === "sent" || po.status === "received") && (
              <Button
                variant="outline"
                size="sm"
                className="text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950"
                onClick={(e) => { e.stopPropagation(); onStatusChange("invoiced"); }}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Mark Invoiced
              </Button>
            )}

            {needsInvoice && (
              <a
                href="/admin/invoices"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <FileText className="h-3.5 w-3.5" />
                Go to Invoices ↗
              </a>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete purchase order?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanently deletes{" "}
                    <span className="font-medium text-foreground">{po.po_number}</span> for{" "}
                    <span className="font-medium text-foreground">{po.supplier_name}</span>.
                    {po.status !== "draft" && (
                      <span className="block mt-1">
                        This order has already been <strong>{po.status}</strong> — are you sure?
                      </span>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </div>
  );
}
