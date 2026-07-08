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
      <DialogContent className="max-w-lg">
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
