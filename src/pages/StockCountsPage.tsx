import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ClipboardList,
  PlusCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  ShoppingBasket,
  AlertCircle,
  Send,
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
import type { FoodCostItem, StockCount, StockCountLine, RecipeWithIngredients } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CountLineWithItem extends StockCountLine {
  food_cost_item: FoodCostItem;
}

interface CountWithMeta extends StockCount {
  counter_name?: string;
  approver_name?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  draft:     { label: "Draft",     colour: "bg-muted text-muted-foreground",    icon: Pencil       },
  submitted: { label: "Submitted", colour: "bg-blue-500/10 text-blue-500",      icon: Clock        },
  approved:  { label: "Approved",  colour: "bg-green-500/10 text-green-500",    icon: CheckCircle2 },
} as const;

function StatusBadge({ status }: { status: StockCount["status"] }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", cfg.colour)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function groupItems(items: FoodCostItem[], by: "category" | "location") {
  return items.reduce<Record<string, FoodCostItem[]>>((acc, item) => {
    const key =
      by === "location"
        ? item.location || "Unassigned"
        : item.category || "Uncategorised";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
}

function calcTotal(items: FoodCostItem[], qtys: Record<string, string>): number {
  return items.reduce((sum, item) => {
    const q = parseFloat(qtys[item.id] || "0") || 0;
    return sum + q * item.cost_per_unit;
  }, 0);
}

function calcRecipeContributions(
  recipes: RecipeWithIngredients[],
  recipeQtys: Record<string, string>
): Record<string, number> {
  const contrib: Record<string, number> = {};
  for (const recipe of recipes) {
    const qty = parseFloat(recipeQtys[recipe.id] || "0") || 0;
    if (qty <= 0) continue;
    for (const ing of recipe.ingredients) {
      contrib[ing.food_cost_item_id] =
        (contrib[ing.food_cost_item_id] ?? 0) + ing.quantity * qty;
    }
  }
  return contrib;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StockCountsPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { profile } = useAuth();
  const { isSuperadmin } = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const queryClient = useQueryClient();

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const isAllRestaurants = !selectedRestaurantId;
  const allRestaurantIds = restaurants.map((r) => r.id);

  // ── Food cost items ───────────────────────────────────────────────────────
  const { data: foodCostItems = [] } = useQuery<FoodCostItem[]>({
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

  // ── Stock counts ──────────────────────────────────────────────────────────
  const { data: counts = [], isLoading } = useQuery<CountWithMeta[]>({
    queryKey: ["stock_counts", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("stock_counts")
        .select("*")
        .order("count_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (selectedRestaurantId) {
        q = q.eq("restaurant_id", selectedRestaurantId);
      } else if (allRestaurantIds.length > 0) {
        q = q.in("restaurant_id", allRestaurantIds);
      }
      const { data, error } = await q;
      if (error) throw error;

      const counts = (data ?? []) as StockCount[];

      // Resolve counter/approver names
      const profileIds = [...new Set([
        ...counts.map((c) => c.counted_by).filter(Boolean),
        ...counts.map((c) => c.approved_by).filter(Boolean),
      ])] as string[];

      let profileMap: Record<string, string> = {};
      if (profileIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", profileIds);
        profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));
      }

      return counts.map((c) => ({
        ...c,
        counter_name: profileMap[c.counted_by] ?? "Unknown",
        approver_name: c.approved_by ? profileMap[c.approved_by] : undefined,
      }));
    },
    enabled: isAllRestaurants ? allRestaurantIds.length > 0 : !!selectedRestaurantId,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const { mutate: deleteCount } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stock_counts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Count deleted");
      queryClient.invalidateQueries({ queryKey: ["stock_counts"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: async ({ id, status, approverId }: { id: string; status: string; approverId?: string }) => {
      const update: Record<string, unknown> = { status };
      if (approverId) { update.approved_by = approverId; update.approved_at = new Date().toISOString(); }
      const { error } = await supabase.from("stock_counts").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      toast.success(status === "approved" ? "Count approved" : "Count submitted for approval");
      queryClient.invalidateQueries({ queryKey: ["stock_counts"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function handleEdit(count: CountWithMeta) {
    setIsCreating(false);
    setEditingId(count.id);
    setExpandedId(null);
  }

  if (!selectedRestaurantId && !isAllRestaurants) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">Select a restaurant to continue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Stock Counts</h2>
          <span className="text-sm text-muted-foreground">
            — {restaurant?.name ?? "All Restaurants"}
          </span>
        </div>
        {!isAllRestaurants && (
          <Button
            size="sm"
            onClick={() => { setIsCreating(true); setEditingId(null); setExpandedId(null); }}
            disabled={isCreating}
          >
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
            New Count
          </Button>
        )}
      </div>

      {/* All-restaurants info */}
      {isAllRestaurants && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Select a specific restaurant to start a new stock count.
        </div>
      )}

      {/* No food cost items warning */}
      {!isAllRestaurants && foodCostItems.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-600">No food cost items set up</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Go to <strong>Settings → Food Cost Items</strong> to add items before running a stock count.
            </p>
          </div>
        </div>
      )}

      {/* New count entry panel */}
      {isCreating && selectedRestaurantId && (
        <CountEntryPanel
          restaurantId={selectedRestaurantId}
          foodCostItems={foodCostItems}
          countedBy={profile!.id}
          onSaved={() => {
            setIsCreating(false);
            queryClient.invalidateQueries({ queryKey: ["stock_counts"] });
          }}
          onCancel={() => setIsCreating(false)}
        />
      )}

      {/* Edit draft panel */}
      {editingId && selectedRestaurantId && (
        <CountEntryPanel
          restaurantId={selectedRestaurantId}
          foodCostItems={foodCostItems}
          countedBy={profile!.id}
          editCountId={editingId}
          onSaved={() => {
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: ["stock_counts"] });
          }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {/* Counts list */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : counts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No stock counts yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            {counts.map((count) => {
              const isExpanded = expandedId === count.id;
              const isEditing = editingId === count.id;
              const countRestaurant = isAllRestaurants
                ? restaurants.find((r) => r.id === count.restaurant_id)
                : null;
              const canEdit = count.status === "draft" &&
                (isSuperadmin || count.counted_by === profile?.id);
              const canApprove = count.status === "submitted" && isSuperadmin;

              return (
                <div key={count.id}>
                  {/* Summary row */}
                  <div
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/30 transition-colors",
                      isEditing && "bg-primary/5"
                    )}
                    onClick={() => {
                      if (isEditing) return;
                      setExpandedId(isExpanded ? null : count.id);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">
                          {format(parseISO(count.count_date), "d MMM yyyy")}
                        </p>
                        <StatusBadge status={count.status} />
                        {countRestaurant && (
                          <span className="text-xs font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            {countRestaurant.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Counted by {count.counter_name}
                        {count.approved_by && count.approver_name &&
                          ` · Approved by ${count.approver_name}`}
                        {count.notes && ` · ${count.notes}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canEdit && !isEditing && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleEdit(count); }}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      )}
                      {canApprove && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateStatus({ id: count.id, status: "approved", approverId: profile!.id });
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Approve
                        </Button>
                      )}
                      {(isSuperadmin || (count.status === "draft" && count.counted_by === profile?.id)) && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete stock count?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Permanently deletes the{" "}
                                <span className="font-medium text-foreground">
                                  {format(parseISO(count.count_date), "d MMM yyyy")}
                                </span>{" "}
                                count and all its lines.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteCount(count.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      {!isEditing && (
                        isExpanded
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && !isEditing && (
                    <CountDetail
                      countId={count.id}
                      foodCostItems={foodCostItems}
                      onSubmit={
                        count.status === "draft" && canEdit
                          ? () => updateStatus({ id: count.id, status: "submitted" })
                          : undefined
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Count Entry Panel ────────────────────────────────────────────────────────

function CountEntryPanel({
  restaurantId,
  foodCostItems,
  countedBy,
  editCountId,
  onSaved,
  onCancel,
}: {
  restaurantId: string;
  foodCostItems: FoodCostItem[];
  countedBy: string;
  editCountId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [recipeQtys, setRecipeQtys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [groupBy, setGroupBy] = useState<"category" | "location">("category");
  const [recipesOpen, setRecipesOpen] = useState(true);

  // Fetch recipes with ingredients
  const { data: recipes = [] } = useQuery<RecipeWithIngredients[]>({
    queryKey: ["stock_count_recipes_with_ingredients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_recipes")
        .select(
          "*, ingredients:stock_count_recipe_ingredients(*, food_cost_item:food_cost_items(*))"
        )
        .order("name");
      if (error) throw error;
      return (data ?? []) as RecipeWithIngredients[];
    },
  });

  const grouped = useMemo(
    () => groupItems(foodCostItems, groupBy),
    [foodCostItems, groupBy]
  );
  const groupKeys = Object.keys(grouped).sort();

  // Check whether any items have locations set
  const hasLocations = useMemo(
    () => foodCostItems.some((i) => i.location),
    [foodCostItems]
  );

  // Load existing count data when editing
  useQuery({
    queryKey: ["stock_count_entry", editCountId],
    queryFn: async () => {
      if (!editCountId) return null;
      const [countRes, linesRes] = await Promise.all([
        supabase.from("stock_counts").select("*").eq("id", editCountId).single(),
        supabase.from("stock_count_lines").select("*").eq("stock_count_id", editCountId),
      ]);
      if (countRes.error) throw countRes.error;
      const count = countRes.data as StockCount;
      setDate(count.count_date);
      setNotes(count.notes ?? "");
      const qtyMap: Record<string, string> = {};
      (linesRes.data ?? []).forEach((line: StockCountLine) => {
        if (line.quantity > 0) qtyMap[line.food_cost_item_id] = String(line.quantity);
      });
      setQtys(qtyMap);
      const allOpen: Record<string, boolean> = {};
      Object.keys(groupItems(foodCostItems, groupBy)).forEach((k) => {
        allOpen[k] = true;
      });
      setOpenGroups(allOpen);
      return count;
    },
    enabled: !!editCountId,
  });

  // Open all groups by default for new count
  useMemo(() => {
    if (!editCountId) {
      const allOpen: Record<string, boolean> = {};
      groupKeys.forEach((k) => {
        allOpen[k] = true;
      });
      setOpenGroups(allOpen);
    }
  }, [groupKeys.join(","), editCountId]);

  // Recipe contributions per food cost item
  const recipeContribs = useMemo(
    () => calcRecipeContributions(recipes, recipeQtys),
    [recipes, recipeQtys]
  );

  // Grand total includes manual qtys + recipe contributions
  const grandTotal = useMemo(() => {
    const manualTotal = calcTotal(foodCostItems, qtys);
    const recipeTotal = foodCostItems.reduce((sum, item) => {
      const contrib = recipeContribs[item.id] ?? 0;
      return sum + contrib * item.cost_per_unit;
    }, 0);
    return manualTotal + recipeTotal;
  }, [foodCostItems, qtys, recipeContribs]);

  const setQty = useCallback((itemId: string, val: string) => {
    setQtys((prev) => ({ ...prev, [itemId]: val }));
  }, []);

  async function save(submitAfter: boolean) {
    if (!date) {
      toast.error("Select a date");
      return;
    }
    setSaving(true);
    try {
      let countId = editCountId;

      if (editCountId) {
        const { error } = await supabase
          .from("stock_counts")
          .update({ count_date: date, notes: notes || null })
          .eq("id", editCountId);
        if (error) throw error;
        await supabase
          .from("stock_count_lines")
          .delete()
          .eq("stock_count_id", editCountId);
      } else {
        const { data, error } = await supabase
          .from("stock_counts")
          .insert({
            restaurant_id: restaurantId,
            counted_by: countedBy,
            count_date: date,
            status: "draft",
            notes: notes || null,
          })
          .select("id")
          .single();
        if (error) throw error;
        countId = data.id;
      }

      // Merge manual qtys with recipe contributions
      const finalQtys: Record<string, number> = {};
      foodCostItems.forEach((item) => {
        const manual = parseFloat(qtys[item.id] || "0") || 0;
        const contrib = recipeContribs[item.id] ?? 0;
        const total = manual + contrib;
        if (total > 0) finalQtys[item.id] = total;
      });

      const itemMap = Object.fromEntries(foodCostItems.map((i) => [i.id, i]));
      const lines = Object.entries(finalQtys).map(([itemId, qty]) => ({
        stock_count_id: countId!,
        food_cost_item_id: itemId,
        quantity: qty,
        total_value: Math.round(qty * (itemMap[itemId]?.cost_per_unit ?? 0) * 100) / 100,
      }));

      if (lines.length > 0) {
        const { error } = await supabase.from("stock_count_lines").insert(lines);
        if (error) throw error;
      }

      if (submitAfter && countId) {
        await supabase
          .from("stock_counts")
          .update({ status: "submitted" })
          .eq("id", countId);
      }

      toast.success(
        submitAfter
          ? "Count submitted for approval"
          : editCountId
          ? "Count updated"
          : "Count saved as draft"
      );
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (foodCostItems.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No food cost items set up. Go to{" "}
        <strong>Settings → Food Cost Items</strong> first.
      </div>
    );
  }

  const totalRecipesEntered = Object.values(recipeQtys).filter(
    (v) => parseFloat(v) > 0
  ).length;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {editCountId ? "Edit Stock Count" : "New Stock Count"}
        </h3>
        <p className="text-sm font-semibold tabular-nums text-foreground">
          Total: {formatCurrency(grandTotal)}
        </p>
      </div>

      {/* Date + notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="count_date">Count Date</Label>
          <Input
            id="count_date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="count_notes">Notes (optional)</Label>
          <Input
            id="count_notes"
            placeholder="e.g. End of week count"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Recipes section */}
      {recipes.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setRecipesOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-primary/5 hover:bg-primary/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ShoppingBasket className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Recipes
              </span>
              <span className="text-xs text-muted-foreground">
                — count finished items, ingredients calculated automatically
              </span>
              {totalRecipesEntered > 0 && (
                <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 font-medium">
                  {totalRecipesEntered}
                </span>
              )}
            </div>
            {recipesOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>

          {recipesOpen && (
            <div>
              <div className="grid grid-cols-[1fr_auto_80px] gap-2 px-4 py-1.5 border-b border-border bg-muted/10">
                <p className="text-xs text-muted-foreground">Recipe</p>
                <p className="text-xs text-muted-foreground">Ingredients</p>
                <p className="text-xs text-muted-foreground text-right">Qty</p>
              </div>
              <div className="divide-y divide-border">
                {recipes.map((recipe) => {
                  const rqty = parseFloat(recipeQtys[recipe.id] || "0") || 0;
                  return (
                    <div
                      key={recipe.id}
                      className={cn(
                        "grid grid-cols-[1fr_auto_80px] gap-2 px-4 py-2 items-center",
                        rqty > 0 && "bg-primary/3"
                      )}
                    >
                      <div>
                        <p className="text-sm text-foreground leading-tight">
                          {recipe.name}
                        </p>
                        {rqty > 0 && recipe.ingredients.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {recipe.ingredients.map((ing) => {
                              const qty = ing.quantity * rqty;
                              return `${qty % 1 === 0 ? qty : qty.toFixed(3)} ${ing.food_cost_item?.unit ?? ""} ${ing.food_cost_item?.name ?? ""}`;
                            }).join(", ")}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {recipe.ingredients.length} ingredient
                        {recipe.ingredients.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          placeholder="0"
                          value={recipeQtys[recipe.id] ?? ""}
                          onChange={(e) =>
                            setRecipeQtys((prev) => ({
                              ...prev,
                              [recipe.id]: e.target.value,
                            }))
                          }
                          className="h-8 text-right tabular-nums text-sm w-full"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {recipe.yield_unit}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Group by toggle (only shown if locations are configured) */}
      {hasLocations && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Group by:</span>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setGroupBy("category")}
              className={cn(
                "px-3 py-1.5 transition-colors",
                groupBy === "category"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              Category
            </button>
            <button
              type="button"
              onClick={() => setGroupBy("location")}
              className={cn(
                "px-3 py-1.5 border-l border-border transition-colors",
                groupBy === "location"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              Location
            </button>
          </div>
        </div>
      )}

      {/* Items by group */}
      <div className="space-y-3">
        {groupKeys.map((groupKey) => {
          const items = grouped[groupKey];
          const manualCatTotal = calcTotal(items, qtys);
          const recipeCatTotal = items.reduce((sum, item) => {
            return sum + (recipeContribs[item.id] ?? 0) * item.cost_per_unit;
          }, 0);
          const catTotal = manualCatTotal + recipeCatTotal;
          const isOpen = openGroups[groupKey] ?? true;
          const filledCount = items.filter(
            (i) =>
              (parseFloat(qtys[i.id] || "0") > 0) ||
              (recipeContribs[i.id] ?? 0) > 0
          ).length;

          return (
            <div
              key={groupKey}
              className="rounded-lg border border-border overflow-hidden"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((prev) => ({ ...prev, [groupKey]: !isOpen }))
                }
                className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    {groupKey}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {filledCount}/{items.length} items
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {catTotal > 0 && (
                    <span className="text-xs font-semibold tabular-nums text-foreground">
                      {formatCurrency(catTotal)}
                    </span>
                  )}
                  {isOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              </button>

              {isOpen && (
                <div>
                  <div className="grid grid-cols-[1fr_80px_72px_80px] gap-2 px-4 py-1.5 border-b border-border bg-muted/10">
                    <p className="text-xs text-muted-foreground">Item</p>
                    <p className="text-xs text-muted-foreground text-right">Unit</p>
                    <p className="text-xs text-muted-foreground text-right">$/unit</p>
                    <p className="text-xs text-muted-foreground text-right">Qty</p>
                  </div>
                  <div className="divide-y divide-border">
                    {items.map((item) => {
                      const manualQty =
                        parseFloat(qtys[item.id] || "0") || 0;
                      const recipeContrib = recipeContribs[item.id] ?? 0;
                      const displayQty = manualQty + recipeContrib;
                      const lineTotal = displayQty * item.cost_per_unit;
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "grid grid-cols-[1fr_80px_72px_80px] gap-2 px-4 py-2 items-center",
                            displayQty > 0 && "bg-primary/3"
                          )}
                        >
                          <div>
                            <p className="text-sm text-foreground leading-tight">
                              {item.name}
                            </p>
                            {displayQty > 0 && (
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {recipeContrib > 0 && (
                                  <span className="text-primary/70">
                                    +{recipeContrib % 1 === 0
                                      ? recipeContrib
                                      : recipeContrib.toFixed(3)} from recipes{" "}
                                  </span>
                                )}
                                = {formatCurrency(lineTotal)}
                              </p>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground text-right">
                            {item.unit}
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums text-right">
                            {formatCurrency(item.cost_per_unit)}
                          </p>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={
                              recipeContrib > 0
                                ? String(recipeContrib % 1 === 0 ? recipeContrib : recipeContrib.toFixed(3))
                                : "0"
                            }
                            value={qtys[item.id] ?? ""}
                            onChange={(e) => setQty(item.id, e.target.value)}
                            className="h-8 text-right tabular-nums text-sm w-full"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary + actions */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            Total stock value: {formatCurrency(grandTotal)}
          </p>
          <p className="text-xs text-muted-foreground">
            {
              Object.keys(
                (() => {
                  const final: Record<string, number> = {};
                  foodCostItems.forEach((item) => {
                    const m = parseFloat(qtys[item.id] || "0") || 0;
                    const c = recipeContribs[item.id] ?? 0;
                    if (m + c > 0) final[item.id] = m + c;
                  });
                  return final;
                })()
              ).length
            }{" "}
            of {foodCostItems.length} items counted
            {totalRecipesEntered > 0 &&
              ` · ${totalRecipesEntered} recipe${totalRecipesEntered !== 1 ? "s" : ""} included`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => save(false)}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Draft"}
          </Button>
          <Button onClick={() => save(true)} disabled={saving}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Count Detail ─────────────────────────────────────────────────────────────

function CountDetail({
  countId,
  foodCostItems: _foodCostItems,
  onSubmit,
}: {
  countId: string;
  foodCostItems: FoodCostItem[];
  onSubmit?: () => void;
}) {
  const { data: lines = [], isLoading } = useQuery<CountLineWithItem[]>({
    queryKey: ["stock_count_lines", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_lines")
        .select("*, food_cost_item:food_cost_items(*)")
        .eq("stock_count_id", countId)
        .gt("quantity", 0)
        .order("food_cost_item(category)")
        .order("food_cost_item(name)");
      if (error) throw error;
      return (data ?? []) as CountLineWithItem[];
    },
  });

  if (isLoading) {
    return (
      <div className="border-t border-border bg-muted/10 px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="border-t border-border bg-muted/10 px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">No items counted.</p>
        {onSubmit && (
          <Button size="sm" variant="outline" className="mt-3" onClick={onSubmit}>
            Submit anyway
          </Button>
        )}
      </div>
    );
  }

  // Group by category
  const grouped: Record<string, CountLineWithItem[]> = {};
  lines.forEach((line) => {
    const cat = line.food_cost_item?.category || "Uncategorised";
    (grouped[cat] ??= []).push(line);
  });

  const grandTotal = lines.reduce((s, l) => s + l.total_value, 0);

  return (
    <div className="border-t border-border bg-muted/10 px-4 py-4 space-y-4">
      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, catLines]) => {
        const catTotal = catLines.reduce((s, l) => s + l.total_value, 0);
        return (
          <div key={category} className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">{category}</p>
              <p className="text-xs font-semibold tabular-nums text-foreground">{formatCurrency(catTotal)}</p>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {catLines.map((line) => (
                  <tr key={line.id} className="hover:bg-accent/20">
                    <td className="px-3 py-2 text-foreground">{line.food_cost_item?.name}</td>
                    <td className="px-3 py-2 text-muted-foreground text-right tabular-nums">
                      {line.quantity} {line.food_cost_item?.unit}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-right tabular-nums">
                      @ {formatCurrency(line.food_cost_item?.cost_per_unit ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-foreground font-medium text-right tabular-nums">
                      {formatCurrency(line.total_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Grand total + submit */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-sm font-bold text-foreground tabular-nums">
            Total: {formatCurrency(grandTotal)}
          </p>
          <p className="text-xs text-muted-foreground">
            {lines.length} item{lines.length !== 1 ? "s" : ""} counted
          </p>
        </div>
        {onSubmit && (
          <Button size="sm" onClick={onSubmit}>
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Submit for Approval
          </Button>
        )}
      </div>
    </div>
  );
}
