/*
  Required Supabase migrations — run in the SQL editor before using this page:

  CREATE TABLE IF NOT EXISTS stock_count_recipes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text    NOT NULL,
    category    text,
    description text,
    yield_unit  text    DEFAULT 'each',
    created_at  timestamptz DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS stock_count_recipe_ingredients (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id         uuid REFERENCES stock_count_recipes(id) ON DELETE CASCADE,
    food_cost_item_id uuid REFERENCES food_cost_items(id) ON DELETE CASCADE,
    quantity          numeric NOT NULL,
    created_at        timestamptz DEFAULT now()
  );
*/

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Soup,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Recipe, RecipeIngredient, FoodCostItem } from "@/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const recipeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().optional(),
  description: z.string().optional(),
  yield_unit: z.string().min(1, "Yield unit is required"),
});
type RecipeFormValues = z.infer<typeof recipeSchema>;

const ingredientSchema = z.object({
  food_cost_item_id: z.string().min(1, "Select an ingredient"),
  quantity: z.coerce.number().min(0.001, "Must be > 0"),
});
type IngredientFormValues = z.infer<typeof ingredientSchema>;

// ─── Recipe Dialog ─────────────────────────────────────────────────────────────

function RecipeDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Recipe;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!initial;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RecipeFormValues>({
    resolver: zodResolver(recipeSchema),
    defaultValues: {
      name: initial?.name ?? "",
      category: initial?.category ?? "",
      description: initial?.description ?? "",
      yield_unit: initial?.yield_unit ?? "each",
    },
  });

  const { mutate: save } = useMutation({
    mutationFn: async (values: RecipeFormValues) => {
      const payload = {
        name: values.name.trim(),
        category: values.category?.trim() || null,
        description: values.description?.trim() || null,
        yield_unit: values.yield_unit.trim(),
      };
      if (isEdit && initial) {
        const { error } = await supabase
          .from("stock_count_recipes")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("stock_count_recipes")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Recipe updated" : "Recipe added");
      queryClient.invalidateQueries({ queryKey: ["stock_count_recipes"] });
      reset();
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Recipe" : "Add Recipe"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="recipe-name">
                Recipe Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="recipe-name"
                placeholder="e.g. Caesar Salad Bowl, Cheeseburger"
                {...register("name")}
                className={cn(errors.name && "border-destructive")}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipe-category">Category (optional)</Label>
              <Input
                id="recipe-category"
                placeholder="e.g. Mains, Salads, Drinks"
                {...register("category")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recipe-yield">
                Yield Unit <span className="text-destructive">*</span>
              </Label>
              <Input
                id="recipe-yield"
                placeholder="e.g. each, bowl, serve"
                {...register("yield_unit")}
                className={cn(errors.yield_unit && "border-destructive")}
              />
              <p className="text-xs text-muted-foreground">
                What 1 unit of this recipe represents
              </p>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="recipe-desc">Description (optional)</Label>
              <Textarea
                id="recipe-desc"
                rows={2}
                placeholder="Notes about this recipe..."
                {...register("description")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving..."
                : isEdit
                ? "Save Changes"
                : "Add Recipe"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ingredients Panel ─────────────────────────────────────────────────────────

function IngredientsPanel({ recipe }: { recipe: RecipeWithIngredients }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState<string>("");
  const [selectedItemId, setSelectedItemId] = useState<string>("");

  const { data: foodItems = [] } = useQuery<FoodCostItem[]>({
    queryKey: ["food-cost-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_cost_items")
        .select("*")
        .order("category")
        .order("name");
      if (error) throw error;
      return (data ?? []) as FoodCostItem[];
    },
  });

  const { data: ingredients = [], isLoading } = useQuery<RecipeIngredient[]>({
    queryKey: ["recipe_ingredients", recipe.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_recipe_ingredients")
        .select("*, food_cost_item:food_cost_items(*)")
        .eq("recipe_id", recipe.id);
      if (error) throw error;
      return (data ?? []) as RecipeIngredient[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<IngredientFormValues>({
    resolver: zodResolver(ingredientSchema),
    defaultValues: { food_cost_item_id: "", quantity: 0 },
  });

  const watchedItemId = watch("food_cost_item_id");

  const { mutate: addIngredient } = useMutation({
    mutationFn: async (values: IngredientFormValues) => {
      const { error } = await supabase
        .from("stock_count_recipe_ingredients")
        .insert({
          recipe_id: recipe.id,
          food_cost_item_id: values.food_cost_item_id,
          quantity: Number(values.quantity),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe_ingredients", recipe.id] });
      reset({ food_cost_item_id: "", quantity: 0 });
      setSelectedItemId("");
      toast.success("Ingredient added");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: updateIngredient, isPending: isSavingEdit } = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
      const { error } = await supabase
        .from("stock_count_recipe_ingredients")
        .update({ quantity: qty })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe_ingredients", recipe.id] });
      setEditingId(null);
      toast.success("Ingredient updated");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: removeIngredient } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("stock_count_recipe_ingredients")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe_ingredients", recipe.id] });
      toast.success("Ingredient removed");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const usedItemIds = new Set(ingredients.map((i) => i.food_cost_item_id));
  const availableItems = foodItems.filter((fi) => !usedItemIds.has(fi.id));

  return (
    <div className="border-t border-border bg-muted/20 px-4 py-4 space-y-4">
      <div className="flex items-center gap-2">
        <Soup className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Ingredients
        </p>
        <p className="text-xs text-muted-foreground">
          — quantities per 1 {recipe.yield_unit}
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : ingredients.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No ingredients yet. Add ingredients below.
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                  Ingredient
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-24">
                  Qty
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-16">
                  Unit
                </th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ingredients.map((ing) =>
                editingId === ing.id ? (
                  <tr key={ing.id} className="bg-accent/30">
                    <td className="px-3 py-2 text-foreground">
                      {ing.food_cost_item?.name}
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.001"
                        min="0.001"
                        value={editQty}
                        onChange={(e) => setEditQty(e.target.value)}
                        className="h-7 text-sm w-20"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            updateIngredient({
                              id: ing.id,
                              qty: parseFloat(editQty),
                            });
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {ing.food_cost_item?.unit}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            updateIngredient({
                              id: ing.id,
                              qty: parseFloat(editQty),
                            })
                          }
                          disabled={isSavingEdit}
                          className="rounded p-1 text-green-600 hover:bg-green-500/10 transition-colors"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={ing.id} className="group">
                    <td className="px-3 py-2 text-foreground">
                      {ing.food_cost_item?.name}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {ing.quantity}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {ing.food_cost_item?.unit}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditingId(ing.id);
                            setEditQty(String(ing.quantity));
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => removeIngredient(ing.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add ingredient form */}
      <form
        onSubmit={handleSubmit((v) => addIngredient(v))}
        className="grid grid-cols-[1fr_100px_auto] gap-2 items-start"
      >
        <div>
          <Select
            value={watchedItemId}
            onValueChange={(val) => {
              setValue("food_cost_item_id", val);
              setSelectedItemId(val);
            }}
          >
            <SelectTrigger
              className={cn(
                "h-8 text-sm",
                errors.food_cost_item_id && "border-destructive"
              )}
            >
              <SelectValue placeholder="Select ingredient..." />
            </SelectTrigger>
            <SelectContent>
              {availableItems.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  All food cost items are already added
                </div>
              ) : (
                availableItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}{" "}
                    <span className="text-muted-foreground">({item.unit})</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {errors.food_cost_item_id && (
            <p className="text-xs text-destructive mt-0.5">
              {errors.food_cost_item_id.message}
            </p>
          )}
        </div>
        <div>
          <Input
            type="number"
            step="0.001"
            min="0.001"
            placeholder="Qty"
            className={cn(
              "h-8 text-sm",
              errors.quantity && "border-destructive"
            )}
            {...register("quantity")}
          />
          {errors.quantity && (
            <p className="text-xs text-destructive mt-0.5">
              {errors.quantity.message}
            </p>
          )}
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={isSubmitting || availableItems.length === 0}
          className="h-8"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </form>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RecipesSettings() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | undefined>();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: recipes = [], isLoading } = useQuery<RecipeWithIngredients[]>({
    queryKey: ["stock_count_recipes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_recipes")
        .select("*, ingredients:stock_count_recipe_ingredients(*, food_cost_item:food_cost_items(*))")
        .order("name");
      if (error) throw error;
      return (data ?? []) as RecipeWithIngredients[];
    },
  });

  const { mutate: remove } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("stock_count_recipes")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recipe deleted");
      queryClient.invalidateQueries({ queryKey: ["stock_count_recipes"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  // Group by category
  const grouped = recipes.reduce<Record<string, RecipeWithIngredients[]>>(
    (acc, recipe) => {
      const cat = recipe.category || "Uncategorised";
      (acc[cat] ??= []).push(recipe);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-card-foreground">
                Recipes
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Define recipes so you can count finished items during a stock count
                — the ingredients are automatically accounted for.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Recipe
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading recipes...</p>
        </div>
      )}

      {!isLoading && recipes.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">
            No recipes yet
          </p>
          <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
            Add recipes like "Caesar Salad Bowl" and define their ingredients.
            When counting stock, enter how many bowls you have and the lettuce,
            croutons, and dressing quantities are calculated automatically.
          </p>
          <Button
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add First Recipe
          </Button>
        </div>
      )}

      {Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, catRecipes]) => (
          <div
            key={category}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {category}
              </h3>
            </div>
            <div className="divide-y divide-border">
              {catRecipes.map((recipe) => {
                const isExpanded = expandedId === recipe.id;
                return (
                  <div key={recipe.id}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground">
                            {recipe.name}
                          </span>
                          <Badge variant="outline" className="text-xs py-0">
                            per {recipe.yield_unit}
                          </Badge>
                          {recipe.ingredients.length > 0 && (
                            <Badge
                              variant="secondary"
                              className="text-xs py-0"
                            >
                              {recipe.ingredients.length} ingredient
                              {recipe.ingredients.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                        {recipe.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic">
                            {recipe.description}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() =>
                            setExpandedId(isExpanded ? null : recipe.id)
                          }
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors",
                            isExpanded
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                        >
                          <Soup className="h-3 w-3" />
                          <span>Ingredients</span>
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setEditing(recipe);
                            setDialogOpen(true);
                          }}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete recipe?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently deletes{" "}
                                <span className="font-medium text-foreground">
                                  {recipe.name}
                                </span>{" "}
                                and all its ingredients.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => remove(recipe.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {isExpanded && <IngredientsPanel recipe={recipe} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      <RecipeDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(undefined);
        }}
        initial={editing}
      />
    </div>
  );
}
