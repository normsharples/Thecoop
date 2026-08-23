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
  Search,
  X,
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
  food_cost_item_id: z.string().optional(), // optional link to a tracked catalogue item
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
  if (pct <= 28) return "text-success";
  if (pct <= 33) return "text-warning";
  return "text-destructive";
}

const BLANK_ITEM = { food_cost_item_id: "", description: "", quantity: 1, unit: "kg", unit_price: 0 };

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

  // ── Tracked items + purchase-unit conversions (for feeding live inventory) ──
  type TrackedItem = { id: string; name: string; unit: string | null; category: string | null; track_inventory: boolean };
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

  // Auto-match a line description to a tracked inventory item by name.
  // Uses the same exact-name rule the save logic uses, so the dropdown
  // selection always reflects what will actually feed stock on save.
  const matchFoodItemId = useCallback(
    (description: string) => {
      const q = (description ?? "").trim().toLowerCase();
      if (!q) return "";
      const tracked = foodItems.filter((f) => f.track_inventory);
      // 1. Exact name match (safest).
      const exact = tracked.find((f) => f.name.trim().toLowerCase() === q);
      if (exact) return exact.id;
      // 2. Unambiguous contains match: exactly one item's name appears inside the
      //    description (handles "Chicken Breast 5kg" → "Chicken breast"). Require
      //    a single hit so we never guess when it could be more than one item.
      const contained = tracked.filter((f) => {
        const name = f.name.trim().toLowerCase();
        return name.length >= 3 && q.includes(name);
      });
      return contained.length === 1 ? contained[0].id : "";
    },
    [foodItems]
  );

  // Tracked items grouped by category for the line picker.
  const trackedItemGroups = useMemo(() => {
    const groups: Record<string, TrackedItem[]> = {};
    for (const it of foodItems) {
      if (!it.track_inventory) continue;
      const cat = it.category ?? "Other";
      (groups[cat] ??= []).push(it);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [foodItems]);

  const { data: purchaseUnits = [] } = useQuery<
    { food_cost_item_id: string; name: string; factor_to_stock_unit: number }[]
  >({
    queryKey: ["item_purchase_units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_purchase_units")
        .select("food_cost_item_id, name, factor_to_stock_unit");
      if (error) throw error;
      return (data ?? []) as { food_cost_item_id: string; name: string; factor_to_stock_unit: number }[];
    },
  });

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

  const [itemSearch, setItemSearch] = useState("");
  const itemQuery = itemSearch.trim().toLowerCase();
  const rowMatchesSearch = (index: number) => {
    if (!itemQuery) return true;
    const it = watchedItems?.[index];
    return (
      (it?.description ?? "").toLowerCase().includes(itemQuery) ||
      (it?.unit ?? "").toLowerCase().includes(itemQuery)
    );
  };
  const matchedCount = itemQuery
    ? fields.filter((_, i) => rowMatchesSearch(i)).length
    : fields.length;
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
          const lineItems: Array<{ food_cost_item_id: string; description: string; quantity: number; unit: string; unit_price: number }> = [];
          for (const item of items) {
            lineItems.push({
              food_cost_item_id: matchFoodItemId(item.description),
              description: item.description,
              quantity: 0,
              unit: item.unit,
              unit_price: item.typical_price,
            });
            const alts = (item.alt_prices as Array<{ unit: string; price: number }>) ?? [];
            for (const alt of alts) {
              lineItems.push({
                food_cost_item_id: matchFoodItemId(item.description),
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
    [supplierRows, setValue, replace, matchFoodItemId]
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
            food_cost_item_id: matchFoodItemId(item.description),
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

      // Persist line items and feed live inventory. A line feeds the ledger only
      // when its description matches a tracked catalogue item AND its unit is
      // unambiguous (matches the item's stock unit, or a configured conversion),
      // so we never inject a wrong quantity. Unmatched lines are money-only.
      let fedCount = 0;
      let newCatalogCount = 0;
      let updatedCatalogCount = 0;
      if (invoiceRow) {
        const norm = (s: string) => s.trim().toLowerCase();
        const lines = activeItems.map((i) => {
          // Prefer the explicit item picked on the line; fall back to name-match.
          const item =
            (i.food_cost_item_id
              ? foodItems.find((f) => f.id === i.food_cost_item_id && f.track_inventory)
              : undefined) ??
            foodItems.find((f) => f.track_inventory && norm(f.name) === norm(i.description));
          let qtyStock = 0;
          if (item) {
            if (item.unit && norm(item.unit) === norm(i.unit)) {
              qtyStock = Number(i.quantity) || 0;
            } else {
              const pu = purchaseUnits.find(
                (p) => p.food_cost_item_id === item.id && norm(p.name) === norm(i.unit)
              );
              if (pu) qtyStock = (Number(i.quantity) || 0) * pu.factor_to_stock_unit;
            }
          }
          if (qtyStock > 0) fedCount += 1;
          return {
            invoice_id: invoiceRow.id,
            food_cost_item_id: qtyStock > 0 && item ? item.id : null,
            description: i.description,
            purchase_unit: i.unit,
            quantity: Number(i.quantity) || 0,
            unit_cost: Number(i.unit_price) || 0,
            qty_stock_units: qtyStock,
            line_total: Math.round((Number(i.quantity) || 0) * (Number(i.unit_price) || 0) * 100) / 100,
          };
        });
        const { error: lineErr } = await supabase.from("invoice_lines").insert(lines);
        if (lineErr) throw lineErr;

        // Keep this supplier's catalogue in sync with what was actually invoiced:
        //  • brand-new descriptions are added,
        //  • existing items whose price changed have their saved price refreshed
        //    (matched by unit — the main unit or an alternate price entry).
        // Best-effort: a catalogue hiccup must never fail an already-saved invoice.
        try {
          const supplierRow = supplierRows.find((s) => norm(s.name) === norm(supplier));
          if (supplierRow) {
            type CatRow = {
              id: string;
              description: string;
              unit: string;
              typical_price: number;
              alt_prices: { unit: string; price: number }[] | null;
            };
            const { data: existing } = await supabase
              .from("supplier_items")
              .select("id, description, unit, typical_price, alt_prices")
              .eq("supplier_id", supplierRow.id);
            const rows = (existing ?? []) as CatRow[];
            const byDesc = new Map(rows.map((r) => [norm(r.description), r]));
            const seen = new Set<string>();
            let order = rows.length;

            const newItems: Array<{
              supplier_id: string;
              description: string;
              unit: string;
              typical_price: number;
              display_order: number;
            }> = [];

            for (const i of activeItems) {
              const desc = (i.description ?? "").trim();
              if (!desc) continue;
              const key = norm(desc);
              if (seen.has(key)) continue;
              seen.add(key);

              const lineUnit = i.unit || "each";
              const linePrice = Number(i.unit_price) || 0;
              const row = byDesc.get(key);

              if (!row) {
                // Brand-new item → add to catalogue.
                newItems.push({
                  supplier_id: supplierRow.id,
                  description: desc,
                  unit: lineUnit,
                  typical_price: linePrice,
                  display_order: order++,
                });
                continue;
              }

              // Existing item → refresh the saved price if it changed (never
              // overwrite with a zero/blank price).
              if (linePrice <= 0) continue;

              if (norm(row.unit) === norm(lineUnit)) {
                if (Math.abs(row.typical_price - linePrice) > 0.0001) {
                  const { error: upErr } = await supabase
                    .from("supplier_items")
                    .update({ typical_price: linePrice })
                    .eq("id", row.id);
                  if (!upErr) updatedCatalogCount += 1;
                }
              } else {
                const alts = [...(row.alt_prices ?? [])];
                const idx = alts.findIndex((a) => norm(a.unit) === norm(lineUnit));
                let changed = false;
                if (idx === -1) {
                  alts.push({ unit: lineUnit, price: linePrice });
                  changed = true;
                } else if (Math.abs(alts[idx].price - linePrice) > 0.0001) {
                  alts[idx] = { unit: alts[idx].unit, price: linePrice };
                  changed = true;
                }
                if (changed) {
                  const { error: upErr } = await supabase
                    .from("supplier_items")
                    .update({ alt_prices: alts })
                    .eq("id", row.id);
                  if (!upErr) updatedCatalogCount += 1;
                }
              }
            }

            if (newItems.length > 0) {
              const { error: catErr } = await supabase.from("supplier_items").insert(newItems);
              if (!catErr) newCatalogCount = newItems.length;
            }
          }
        } catch {
          // ignore — catalogue sync is non-critical
        }
      }

      if (values.po_id && invoiceRow) {
        await supabase
          .from("purchase_orders")
          .update({ status: "invoiced", invoice_id: invoiceRow.id })
          .eq("id", values.po_id);
      }

      return { fedCount, newCatalogCount, updatedCatalogCount };
    },
    onSuccess: (result) => {
      const fed = result?.fedCount ?? 0;
      const added = result?.newCatalogCount ?? 0;
      const updated = result?.updatedCatalogCount ?? 0;
      const parts = ["Invoice added"];
      if (fed > 0) parts.push(`${fed} item${fed !== 1 ? "s" : ""} added to inventory`);
      if (added > 0) parts.push(`${added} new item${added !== 1 ? "s" : ""} saved to supplier catalogue`);
      if (updated > 0) parts.push(`${updated} price${updated !== 1 ? "s" : ""} updated`);
      toast.success(parts.join(" · "));
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
      queryClient.invalidateQueries({ queryKey: ["inventory-levels"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["supplier_catalog_for_item"] });
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
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-warning" />
            <p className="text-sm font-semibold text-warning">
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
                    className="shrink-0 text-warning border-warning/30 hover:bg-warning-soft dark:hover:bg-warning-soft"
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

              {fields.length > 3 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    placeholder="Search this supplier's catalogue…"
                    className="pl-8 pr-16"
                  />
                  {itemQuery && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground tabular-nums">{matchedCount}</span>
                      <button
                        type="button"
                        onClick={() => setItemSearch("")}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
              {itemQuery && matchedCount === 0 && (
                <p className="text-xs text-muted-foreground px-1">No items match "{itemSearch}".</p>
              )}

              {/* Column headers */}
              <div className="hidden sm:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_70px_70px_90px_32px] gap-2 px-1">
                <p className="text-xs text-muted-foreground">Item (inventory)</p>
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
                      "grid grid-cols-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_70px_70px_90px_32px] gap-2 items-start transition-opacity",
                      qty === 0 && "opacity-50",
                      !rowMatchesSearch(index) && "hidden"
                    )}
                  >
                    <Select
                      value={watchedItems?.[index]?.food_cost_item_id || "__none__"}
                      onValueChange={(val) => {
                        if (val === "__none__") {
                          setValue(`line_items.${index}.food_cost_item_id`, "");
                          return;
                        }
                        const picked = foodItems.find((f) => f.id === val);
                        setValue(`line_items.${index}.food_cost_item_id`, val);
                        if (picked) {
                          // auto-fill so the common case (qty in the item's stock unit) converts 1:1
                          if (!watchedItems?.[index]?.description?.trim()) {
                            setValue(`line_items.${index}.description`, picked.name);
                          }
                          if (picked.unit) setValue(`line_items.${index}.unit`, picked.unit);
                        }
                      }}
                    >
                      <SelectTrigger className="text-xs">
                        <SelectValue placeholder="Untracked" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Untracked (money only) —</SelectItem>
                        {trackedItemGroups.map(([cat, items]) => (
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
                  onClick={() => { setItemSearch(""); append(BLANK_ITEM); }}
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
