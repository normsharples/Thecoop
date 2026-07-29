import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShoppingBasket, Plus, Trash2, Pencil, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { FoodCostItem } from "@/types";

// ── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, "Name required"),
  category: z.string().min(1, "Category required"),
  unit: z.string().min(1, "Unit required"),
  cost_per_unit: z.preprocess(
    (v) => parseFloat(String(v)),
    z.number().min(0, "Cost must be ≥ 0")
  ),
  supplier: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ── Purchase Units Editor ───────────────────────────────────────────────────
// Lets you buy in a larger unit (e.g. a carton) while holding/selling in the
// item's stock unit (e.g. each). factor_to_stock_unit = how many stock units
// are in one purchase unit (1 carton = 24 each → factor 24). Invoice entry uses
// these to convert a purchased quantity into stock automatically.

type PurchaseUnit = {
  id: string;
  name: string;
  factor_to_stock_unit: number;
  is_default: boolean;
};

function PurchaseUnitsEditor({
  item,
  onApplyCost,
}: {
  item: FoodCostItem;
  onApplyCost?: (costPerStockUnit: number) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [factor, setFactor] = useState("");

  const { data: units = [], isLoading } = useQuery({
    queryKey: ["item_purchase_units", item.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_purchase_units")
        .select("id, name, factor_to_stock_unit, is_default")
        .eq("food_cost_item_id", item.id)
        .order("name");
      if (error) throw error;
      return data as PurchaseUnit[];
    },
  });

  // Pull this item's line(s) from its configured supplier's catalogue so we can
  // read the buy-unit price (e.g. $X per carton) and derive cost per stock unit.
  type CatalogLine = {
    description: string;
    unit: string;
    typical_price: number;
    alt_prices: { unit: string; price: number }[];
  };
  const { data: supplierCatalog = [] } = useQuery({
    queryKey: ["supplier_catalog_for_item", item.supplier ?? ""],
    enabled: !!item.supplier,
    queryFn: async () => {
      const { data: sup } = await supabase
        .from("suppliers")
        .select("id")
        .ilike("name", item.supplier ?? "")
        .limit(1)
        .maybeSingle();
      if (!sup) return [] as CatalogLine[];
      const { data } = await supabase
        .from("supplier_items")
        .select("description, unit, typical_price, alt_prices")
        .eq("supplier_id", sup.id);
      return (data ?? []) as CatalogLine[];
    },
  });

  const norm = (s: string) => (s ?? "").trim().toLowerCase();

  // The supplier catalogue line that corresponds to this inventory item.
  const catalogLine = (() => {
    const q = norm(item.name);
    if (!q) return undefined;
    return (
      supplierCatalog.find((c) => norm(c.description) === q) ??
      supplierCatalog.find((c) => {
        const d = norm(c.description);
        return d.length >= 3 && (d.includes(q) || q.includes(d));
      })
    );
  })();

  // Supplier price for a given buy-unit name (checks the line's main unit and
  // its alternate prices). Returns null when there's no matching price.
  const supplierPriceForUnit = (unitName: string): number | null => {
    if (!catalogLine) return null;
    if (norm(catalogLine.unit) === norm(unitName)) return catalogLine.typical_price;
    const alt = (catalogLine.alt_prices ?? []).find((a) => norm(a.unit) === norm(unitName));
    return alt ? alt.price : null;
  };

  const costPerStockUnit = (unitName: string, factorToStock: number): number | null => {
    const price = supplierPriceForUnit(unitName);
    if (price == null || !(factorToStock > 0)) return null;
    return Math.round((price / factorToStock) * 10000) / 10000;
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["item_purchase_units", item.id] });
    queryClient.invalidateQueries({ queryKey: ["item_purchase_units"] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      const f = parseFloat(factor);
      if (!trimmed) throw new Error("Enter a unit name (e.g. carton)");
      if (!isFinite(f) || f <= 0)
        throw new Error(`Enter how many ${item.unit} are in one ${trimmed}`);
      const { error } = await supabase.from("item_purchase_units").insert({
        food_cost_item_id: item.id,
        name: trimmed,
        factor_to_stock_unit: f,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Auto-fill cost per stock unit from the supplier's buy-unit price.
      const perStock = costPerStockUnit(name.trim(), parseFloat(factor));
      if (perStock != null && onApplyCost) {
        onApplyCost(perStock);
        toast.success(
          `Purchase unit added — cost per ${item.unit || "unit"} set to ${formatCurrency(perStock)} from supplier price`
        );
      } else {
        toast.success("Purchase unit added");
      }
      setName("");
      setFactor("");
      invalidate();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to add purchase unit"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("item_purchase_units").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Purchase unit removed");
    },
    onError: () => toast.error("Failed to remove purchase unit"),
  });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
      <div>
        <p className="text-sm font-medium text-foreground">Purchase units</p>
        <p className="text-xs text-muted-foreground">
          You count and sell in <span className="font-medium">{item.unit || "—"}</span>. Add the
          larger units you buy in, and how many {item.unit || "units"} each one holds. Invoices
          entered in these units convert to stock automatically.
        </p>
      </div>

      {item.supplier ? null : (
        <p className="text-xs text-amber-600">
          Set this item's Supplier field above to auto-calculate cost per {item.unit || "unit"} from
          the supplier's price.
        </p>
      )}

      {isLoading ? (
        <div className="h-8 rounded bg-muted/30 animate-pulse" />
      ) : units.length > 0 ? (
        <div className="space-y-1.5">
          {units.map((u) => {
            const price = supplierPriceForUnit(u.name);
            const perStock = costPerStockUnit(u.name, u.factor_to_stock_unit);
            return (
              <div
                key={u.id}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-foreground">
                    1 <span className="font-medium">{u.name}</span> ={" "}
                    <span className="font-mono">{u.factor_to_stock_unit}</span>{" "}
                    {item.unit || "units"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(u.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {perStock != null && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Supplier {formatCurrency(price ?? 0)}/{u.name} →{" "}
                      <span className="font-medium text-foreground">
                        {formatCurrency(perStock)}/{item.unit || "unit"}
                      </span>
                    </span>
                    {onApplyCost && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          onApplyCost(perStock);
                          toast.success(
                            `Cost per ${item.unit || "unit"} set to ${formatCurrency(perStock)}`
                          );
                        }}
                      >
                        Use as cost/{item.unit || "unit"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          No purchase units yet — invoices must be entered in {item.unit || "the stock unit"}.
        </p>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Buy unit</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. carton"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addMutation.mutate();
              }
            }}
          />
        </div>
        <div className="w-32 space-y-1">
          <Label className="text-xs">{item.unit || "units"} per {name.trim() || "unit"}</Label>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            placeholder="e.g. 24"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addMutation.mutate();
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => addMutation.mutate()}
          disabled={addMutation.isPending}
        >
          {addMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Item Dialog ───────────────────────────────────────────────────────────────

function ItemDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: FoodCostItem;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? {
          name: initial.name,
          category: initial.category,
          unit: initial.unit,
          cost_per_unit: initial.cost_per_unit,
          supplier: initial.supplier ?? "",
        }
      : { name: "", category: "", unit: "", cost_per_unit: 0, supplier: "" },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name,
        category: values.category,
        unit: values.unit,
        cost_per_unit: values.cost_per_unit,
        supplier: values.supplier || null,
      };
      if (initial) {
        const { error } = await supabase
          .from("food_cost_items")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("food_cost_items")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food-cost-items"] });
      toast.success(initial ? "Item updated" : "Item added");
      onClose();
    },
    onError: () => toast.error("Failed to save item"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Item" : "Add Food Cost Item"}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => saveMutation.mutate(v))}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...register("name")} placeholder="Item name" />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                {...register("category")}
                placeholder="e.g. Protein, Produce"
              />
              {errors.category && (
                <p className="text-xs text-destructive">
                  {errors.category.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                {...register("unit")}
                placeholder="e.g. kg, each, L"
              />
              {errors.unit && (
                <p className="text-xs text-destructive">{errors.unit.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cost">Cost per Unit ($)</Label>
              <Input
                id="cost"
                type="number"
                step="0.01"
                min="0"
                {...register("cost_per_unit")}
                placeholder="0.00"
              />
              {errors.cost_per_unit && (
                <p className="text-xs text-destructive">
                  {errors.cost_per_unit.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier">Supplier (optional)</Label>
              <Input
                id="supplier"
                {...register("supplier")}
                placeholder="Supplier name"
              />
            </div>
          </div>

          {initial ? (
            <PurchaseUnitsEditor
              item={initial}
              onApplyCost={(v) =>
                setValue("cost_per_unit", v, { shouldDirty: true, shouldValidate: true })
              }
            />
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Save this item first, then reopen it to set up purchase units (e.g. buy by the
              carton, stock by the each).
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              {initial ? "Save Changes" : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FoodCostItems() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<FoodCostItem | null>(null);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food-cost-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_cost_items")
        .select("*")
        .order("category")
        .order("name");
      if (error) throw error;
      return data as FoodCostItem[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("food_cost_items")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food-cost-items"] });
      toast.success("Item deleted");
    },
    onError: () => toast.error("Failed to delete item"),
  });

  // Group by category
  const grouped = items.reduce<Record<string, FoodCostItem[]>>((acc, item) => {
    const cat = item.category || "Uncategorised";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  return (
    <div className={cn("rounded-xl border border-border bg-card p-6")}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShoppingBasket className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">
            Food Cost Items
          </h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Item
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ShoppingBasket className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            No items yet. Add food cost items for stock counting.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, catItems]) => (
            <div key={category} className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
                {category}
              </h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">
                        Name
                      </th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">
                        Unit
                      </th>
                      <th className="text-right px-3 py-2 text-xs text-muted-foreground font-medium">
                        Cost/Unit
                      </th>
                      <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">
                        Supplier
                      </th>
                      <th className="w-16" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {catItems.map((item) => (
                      <tr key={item.id} className="hover:bg-accent/20 group">
                        <td className="px-3 py-2.5 text-foreground">
                          {item.name}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {item.unit}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">
                          {formatCurrency(item.cost_per_unit)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {item.supplier ?? "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => setEditItem(item)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                if (confirm("Delete this item?"))
                                  deleteMutation.mutate(item.id);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <ItemDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      {editItem && (
        <ItemDialog
          open={!!editItem}
          onClose={() => setEditItem(null)}
          initial={editItem}
        />
      )}
    </div>
  );
}
