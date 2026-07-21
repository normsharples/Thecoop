import { useState, useMemo, useCallback } from "react";
import { useForm, useFieldArray, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  isWithinInterval,
  parseISO,
} from "date-fns";
import {
  Receipt,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Trash2,
  TrendingUp,
  Clock,
  ShoppingCart,
  Plus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";
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
import { ENTRY_CATEGORY_GROUPS, ENTRY_CATEGORIES, canonicalCategory } from "@/lib/pnlCategories";
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
import type { PurchaseOrder } from "./PurchaseOrdersPage";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  restaurant_id: string;
  supplier_name: string;
  amount: number;
  category: string | null;
  invoice_date: string;
  notes: string | null;
  po_id: string | null;
  created_by: string | null;
  created_at: string;
}

interface SupplierRow {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const lineItemSchema = z.object({
  description: z.string().min(1, "Required"),
  quantity: z.coerce.number().min(0, "Must be ≥ 0"),
  unit: z.string().min(1, "Required"),
  unit_price: z.coerce.number().min(0, "Must be ≥ 0"),
});

const invoiceSchema = z.object({
  supplier_name: z.string().min(1, "Select or enter a supplier"),
  custom_supplier: z.string().optional(),
  category: z.string().min(1, "Select a category"),
  invoice_date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
  po_id: z.string().optional(),
  line_items: z.array(lineItemSchema).min(1, "Add at least one item"),
});

type FormValues = z.infer<typeof invoiceSchema>;

// ─── Week helpers ─────────────────────────────────────────────────────────────

const WEEK_OPTS = { weekStartsOn: 1 as const };

function weekRange(anchor: Date) {
  return {
    start: startOfWeek(anchor, WEEK_OPTS),
    end: endOfWeek(anchor, WEEK_OPTS),
  };
}

function weekLabel(anchor: Date) {
  const { start, end } = weekRange(anchor);
  return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
}

function costColour(pct: number) {
  if (pct <= 28) return "text-green-500";
  if (pct <= 33) return "text-amber-500";
  return "text-red-500";
}

const BLANK_ITEM = { description: "", quantity: 1, unit: "kg", unit_price: 0 };

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [prefillPO, setPrefillPO] = useState<PurchaseOrder | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [totalOverride, setTotalOverride] = useState<string>("");

  const { profile } = useAuth();
  const { canViewSalesData } = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const queryClient = useQueryClient();

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const isAllRestaurants = !selectedRestaurantId;
  const allRestaurantIds = restaurants.map((r) => r.id);
  const { start: weekStart, end: weekEnd } = weekRange(weekAnchor);

  // ── Suppliers ─────────────────────────────────────────────────────────────
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

  // ── Invoices ──────────────────────────────────────────────────────────────
  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["invoices", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
      if (selectedRestaurantId) {
        q = q.eq("restaurant_id", selectedRestaurantId);
      } else if (allRestaurantIds.length > 0) {
        q = q.in("restaurant_id", allRestaurantIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
    enabled: selectedRestaurantId ? true : allRestaurantIds.length > 0,
  });

  // ── Pending POs ───────────────────────────────────────────────────────────
  const { data: pendingPOs = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase_orders_pending", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("purchase_orders")
        .select("*")
        .in("status", ["sent", "received"])
        .is("invoice_id", null)
        .order("order_date", { ascending: false });
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

  // ── Sales ─────────────────────────────────────────────────────────────────
  const { data: weekSales } = useQuery<number>({
    queryKey: ["weekly-sales", selectedRestaurantId ?? "all", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () => {
      let q = supabase
        .from("sales_daily")
        .select("net_sales, total_sales")
        .gte("date", format(weekStart, "yyyy-MM-dd"))
        .lte("date", format(weekEnd, "yyyy-MM-dd"));
      if (selectedRestaurantId) {
        q = q.eq("restaurant_id", selectedRestaurantId);
      } else if (allRestaurantIds.length > 0) {
        q = q.in("restaurant_id", allRestaurantIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).reduce(
        (sum: number, row: { net_sales: number | null; total_sales: number }) =>
          sum + (row.net_sales ?? row.total_sales ?? 0),
        0
      );
    },
    enabled: canViewSalesData && (selectedRestaurantId ? true : allRestaurantIds.length > 0),
  });

  const weekInvoices = useMemo(
    () =>
      invoices.filter((inv) =>
        isWithinInterval(parseISO(inv.invoice_date), { start: weekStart, end: weekEnd })
      ),
    [invoices, weekStart, weekEnd]
  );

  const totalInvoiceCost = weekInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const foodCostPct = weekSales && weekSales > 0 ? (totalInvoiceCost / weekSales) * 100 : null;

  // ── Form ─────────────────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(invoiceSchema) as Resolver<FormValues>,
    defaultValues: {
      supplier_name: "",
      custom_supplier: "",
      category: "",
      invoice_date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      po_id: "",
      line_items: [BLANK_ITEM],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: "line_items" });
  const watchedItems = watch("line_items");
  const supplierValue = watch("supplier_name");
  const categoryValue = watch("category");

  const runningTotal = (watchedItems ?? []).reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0
  );

  const onSupplierChange = useCallback(
    async (supplierName: string) => {
      setValue("supplier_name", supplierName);

      // Auto-set category from supplier profile if it maps to a valid entry category
      const row = supplierRows.find((s) => s.name === supplierName);
      if (row?.category) {
        const mapped = canonicalCategory(row.category);
        if (ENTRY_CATEGORIES.includes(mapped)) {
          setValue("category", mapped, { shouldValidate: true });
        }
      }

      if (supplierName === "__custom__" || !row) return;

      setLoadingItems(true);
      try {
        const { data: items } = await supabase
          .from("supplier_items")
          .select("description, unit, typical_price, alt_prices")
          .eq("supplier_id", row.id)
          .order("display_order");

        if (items && items.length > 0) {
          const lineItems: Array<{ description: string; quantity: number; unit: string; unit_price: number }> = [];
          for (const item of items) {
            lineItems.push({
              description: item.description,
              quantity: 0,
              unit: item.unit,
              unit_price: item.typical_price,
            });
            const alts = (item.alt_prices as Array<{ unit: string; price: number }>) ?? [];
            for (const alt of alts) {
              lineItems.push({
                description: item.description,
                quantity: 0,
                unit: alt.unit,
                unit_price: alt.price,
              });
            }
          }
          replace(lineItems);
          toast.info(
            `${lineItems.length} items loaded from ${supplierName} — enter quantities`
          );
        }
      } finally {
        setLoadingItems(false);
      }
    },
    [supplierRows, setValue, replace]
  );

  function openFormWithPO(po: PurchaseOrder) {
    setPrefillPO(po);
    setTotalOverride("");
    reset({
      supplier_name: po.supplier_name,
      custom_supplier: "",
      category: "",
      invoice_date: format(new Date(), "yyyy-MM-dd"),
      notes: `Re: ${po.po_number}`,
      po_id: po.id,
      line_items: po.items.length > 0
        ? po.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unit_price: item.unit_price,
          }))
        : [BLANK_ITEM],
    });
    setShowForm(true);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }

  function openBlankForm() {
    setPrefillPO(null);
    setTotalOverride("");
    reset({
      supplier_name: "",
      custom_supplier: "",
      category: "",
      invoice_date: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      po_id: "",
      line_items: [BLANK_ITEM],
    });
    setShowForm(true);
  }

  const { mutate: addInvoice, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!selectedRestaurantId || !profile) throw new Error("Not authenticated");
      const supplier =
        values.supplier_name === "__custom__"
          ? (values.custom_supplier ?? "").trim()
          : values.supplier_name;
      if (!supplier) throw new Error("Supplier name is required");

      const activeItems = (values.line_items ?? []).filter(
        (i) => Number(i.quantity) > 0
      );
      if (activeItems.length === 0)
        throw new Error("Enter quantities for at least one item");

      const calculatedAmount =
        Math.round(
          activeItems.reduce(
            (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
            0
          ) * 100
        ) / 100;

      const amount = totalOverride !== ""
        ? Math.round(parseFloat(totalOverride) * 100) / 100
        : calculatedAmount;

      if (amount <= 0) throw new Error("Total must be greater than 0");

      const { data: invoiceRow, error } = await supabase
        .from("invoices")
        .insert({
          restaurant_id: selectedRestaurantId,
          supplier_name: supplier,
          amount,
          category: values.category,
          invoice_date: values.invoice_date,
          notes: values.notes || null,
          po_id: values.po_id || null,
          created_by: profile.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (values.po_id && invoiceRow) {
        await supabase
          .from("purchase_orders")
          .update({ status: "invoiced", invoice_id: invoiceRow.id })
          .eq("id", values.po_id);
      }
    },
    onSuccess: () => {
      toast.success("Invoice added");
      setTotalOverride("");
      reset({
        supplier_name: "",
        custom_supplier: "",
        category: "",
        invoice_date: format(weekAnchor, "yyyy-MM-dd"),
        notes: "",
        po_id: "",
        line_items: [BLANK_ITEM],
      });
      setPrefillPO(null);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["purchase_orders_pending"] });
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
    },
    onError: (err) => toast.error("Failed to save: " + (err as Error).message),
  });

  const { mutate: deleteInvoice } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invoice deleted");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => toast.error("Failed to delete: " + (err as Error).message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Invoices</h2>
          <span className="text-sm text-muted-foreground">
            — {restaurant?.name ?? "All Restaurants"}
          </span>
        </div>
        {!isAllRestaurants && (
          <Button size="sm" onClick={() => (showForm && !prefillPO ? setShowForm(false) : openBlankForm())}>
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
            Add Invoice
          </Button>
        )}
      </div>

      {/* All-restaurants banner */}
      {isAllRestaurants && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Select a specific restaurant to add invoices.
        </div>
      )}

      {/* ── Pending PO tasks banner ───────────────────────────────────────── */}
      {pendingPOs.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold text-amber-600">
              {pendingPOs.length} purchase order{pendingPOs.length !== 1 ? "s" : ""} awaiting invoice
            </p>
          </div>
          <div className="space-y-2">
            {pendingPOs.map((po) => (
              <div
                key={po.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-background border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {po.po_number} — {po.supplier_name}
                      {isAllRestaurants && (() => {
                        const r = restaurants.find((r) => r.id === po.restaurant_id);
                        return r ? <span className="ml-1.5 text-xs font-medium text-primary">({r.name})</span> : null;
                      })()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(po.total_amount)} · {po.items.length} item{po.items.length !== 1 ? "s" : ""} · ordered {format(parseISO(po.order_date), "d MMM yyyy")}
                    </p>
                  </div>
                </div>
                {isAllRestaurants ? (
                  <span className="text-xs text-muted-foreground shrink-0">Select restaurant to add</span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
                    onClick={() => openFormWithPO(po)}
                  >
                    <PlusCircle className="h-3.5 w-3.5 mr-1" />
                    Add Invoice
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Invoice form ─────────────────────────────────────────────────── */}
      {showForm && !isAllRestaurants && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-sm font-semibold text-foreground">
              {prefillPO ? `Invoice for ${prefillPO.po_number}` : "New Invoice"}
            </h3>
            {prefillPO && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                linked to PO
              </span>
            )}
          </div>

          <form onSubmit={handleSubmit((v) => addInvoice(v))} className="space-y-5">
            {/* Top row: supplier + date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                {allSuppliers.length > 0 ? (
                  <Select
                    value={supplierValue}
                    onValueChange={onSupplierChange}
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
                <Label htmlFor="invoice_date">Invoice Date</Label>
                <Input
                  id="invoice_date"
                  type="date"
                  {...register("invoice_date")}
                  className={cn(errors.invoice_date && "border-destructive")}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Category <span className="text-destructive">*</span></Label>
                <Select value={categoryValue} onValueChange={(val) => setValue("category", val, { shouldValidate: true })}>
                  <SelectTrigger className={cn(errors.category && "border-destructive")}>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTRY_CATEGORY_GROUPS.map((g) => (
                      <SelectGroup key={g.label}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {g.options.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label>Items</Label>
                  {loadingItems && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                {errors.line_items && !Array.isArray(errors.line_items) && (
                  <p className="text-xs text-destructive">
                    {(errors.line_items as { message?: string }).message}
                  </p>
                )}
              </div>

              {/* Column headers */}
              <div className="hidden sm:grid grid-cols-[1fr_80px_80px_100px_32px] gap-2 px-1">
                <p className="text-xs text-muted-foreground">Description</p>
                <p className="text-xs text-muted-foreground">Qty</p>
                <p className="text-xs text-muted-foreground">Unit</p>
                <p className="text-xs text-muted-foreground">Unit Price</p>
                <span />
              </div>

              <div className="space-y-2">
                {fields.map((field, index) => {
                  const qty = Number(watchedItems?.[index]?.quantity) || 0;
                  return (
                  <div
                    key={field.id}
                    className={cn(
                      "grid grid-cols-1 sm:grid-cols-[1fr_80px_80px_100px_32px] gap-2 items-start transition-opacity",
                      qty === 0 && "opacity-50"
                    )}
                  >
                    <Input
                      placeholder="e.g. Chicken breast"
                      {...register(`line_items.${index}.description`)}
                      className={cn(errors.line_items?.[index]?.description && "border-destructive")}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="1"
                      {...register(`line_items.${index}.quantity`)}
                      className={cn(errors.line_items?.[index]?.quantity && "border-destructive")}
                    />
                    <Input
                      placeholder="kg"
                      {...register(`line_items.${index}.unit`)}
                      className={cn(errors.line_items?.[index]?.unit && "border-destructive")}
                    />
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className={cn("pl-7", errors.line_items?.[index]?.unit_price && "border-destructive")}
                        {...register(`line_items.${index}.unit_price`)}
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
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append(BLANK_ITEM)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Item
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Total:</span>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={runningTotal.toFixed(2)}
                      value={totalOverride}
                      onChange={(e) => setTotalOverride(e.target.value)}
                      className="pl-6 w-28 h-8 text-sm font-semibold tabular-nums"
                    />
                  </div>
                  {totalOverride !== "" && parseFloat(totalOverride) !== runningTotal && (
                    <span className="text-xs text-muted-foreground">
                      (items: {formatCurrency(runningTotal)})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input id="notes" placeholder="e.g. Invoice #1042" {...register("notes")} />
            </div>

            {/* Hidden PO link */}
            <input type="hidden" {...register("po_id")} />

            {prefillPO && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                Linked to{" "}
                <span className="font-medium text-foreground">{prefillPO.po_number}</span> — saving will
                mark that PO as invoiced. Remove any items that weren't delivered.
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save Invoice"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowForm(false); setPrefillPO(null); reset(); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Week navigator */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setWeekAnchor((d) => subWeeks(d, 1))}
          className="rounded-lg border border-border bg-card p-1.5 hover:bg-accent transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-sm font-medium text-foreground min-w-[200px] text-center">
          {weekLabel(weekAnchor)}
        </span>
        <button
          onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
          className="rounded-lg border border-border bg-card p-1.5 hover:bg-accent transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Summary cards */}
      <div className={cn("grid gap-3", canViewSalesData ? "grid-cols-3" : "grid-cols-1")}>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Invoice Total</p>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {formatCurrency(totalInvoiceCost)}
          </p>
        </div>
        {canViewSalesData && (
          <>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground mb-1">Week Sales</p>
              <p className="text-xl font-bold tabular-nums text-foreground">
                {weekSales != null ? formatCurrency(weekSales) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Food Cost %</p>
              </div>
              <p
                className={cn(
                  "text-xl font-bold tabular-nums",
                  foodCostPct != null ? costColour(foodCostPct) : "text-muted-foreground"
                )}
              >
                {foodCostPct != null ? formatPercent(foodCostPct) : "—"}
              </p>
              {foodCostPct != null && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {foodCostPct <= 28 ? "On target" : foodCostPct <= 33 ? "Slightly high" : "Over target"}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Invoice list */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : weekInvoices.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No invoices for this week.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {weekInvoices.map((inv) => {
              const invRestaurant = restaurants.find((r) => r.id === inv.restaurant_id);
              return (
              <div key={inv.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{inv.supplier_name}</p>
                    {isAllRestaurants && invRestaurant && (
                      <span className="text-xs font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {invRestaurant.name}
                      </span>
                    )}
                    {inv.po_id && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        PO linked
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(inv.invoice_date), "d MMM yyyy")}
                    {inv.notes && ` · ${inv.notes}`}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                  {formatCurrency(inv.amount)}
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Permanently deletes the{" "}
                        <span className="font-medium text-foreground">{formatCurrency(inv.amount)}</span>{" "}
                        invoice from{" "}
                        <span className="font-medium text-foreground">{inv.supplier_name}</span>.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteInvoice(inv.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground">
              {weekInvoices.length} invoice{weekInvoices.length !== 1 ? "s" : ""} this week
            </p>
            <p className="text-sm font-bold tabular-nums text-foreground">
              {formatCurrency(totalInvoiceCost)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
