import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Recipe,
  RecipeLine,
  RecipeStep,
  RecipeVenueSetting,
  RecipeWithDetail,
  RecipeCostRow,
  RecipeCostBasis,
  RecipeIssue,
  RecipeCoverage,
  UnmappedProduct,
  RecipeType,
  PrepBoardRow,
  ProductionRun,
} from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export interface RecipeListRow extends Recipe {
  lines: { id: string }[];
}

/** The whole book. Readable by every signed-in role — it carries no cost. */
export function useRecipeList(type?: RecipeType | "all") {
  return useQuery<RecipeListRow[]>({
    queryKey: ["recipes", type ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("recipes")
        .select("*, lines:recipe_lines!recipe_lines_recipe_id_fkey(id)")
        .order("name");
      if (type && type !== "all") q = q.eq("type", type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RecipeListRow[];
    },
  });
}

/** One recipe with its lines, method and per-venue settings. */
export function useRecipe(id: string | null) {
  return useQuery<RecipeWithDetail | null>({
    queryKey: ["recipe", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select(
          `*,
           lines:recipe_lines!recipe_lines_recipe_id_fkey(*, food_cost_item:food_cost_items(*), sub_recipe:recipes!recipe_lines_sub_recipe_id_fkey(*)),
           steps:recipe_steps(*),
           venue_settings:recipe_venue_settings(*)`
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as RecipeWithDetail;
      r.lines = [...(r.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order);
      r.steps = [...(r.steps ?? [])].sort((a, b) => a.step_no - b.step_no);
      return r;
    },
  });
}

/**
 * Costs for the whole book in one round trip. The RPC refuses anyone below the
 * manager tier, so `enabled` must gate it — never call it for staff.
 */
export function useRecipeCosts(
  restaurantId: string | null,
  basis: RecipeCostBasis,
  enabled: boolean
) {
  return useQuery<Record<string, RecipeCostRow>>({
    queryKey: ["recipe-costs", restaurantId ?? "all", basis],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recipe_cost_all", {
        p_restaurant_id: restaurantId,
        p_basis: basis,
      });
      if (error) throw error;
      const map: Record<string, RecipeCostRow> = {};
      for (const row of (data ?? []) as RecipeCostRow[]) map[row.recipe_id] = row;
      return map;
    },
  });
}

/** What's wrong with this recipe. Manager tier only. */
export function useRecipeIssues(id: string | null, enabled: boolean) {
  return useQuery<RecipeIssue[]>({
    queryKey: ["recipe-issues", id],
    enabled: !!id && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recipe_issues", { p_recipe_id: id });
      if (error) throw error;
      return (data ?? []) as RecipeIssue[];
    },
  });
}

/** Derived from the ingredients — staff-safe, no cost involved. */
export function useRecipeAllergens(id: string | null) {
  return useQuery<string[]>({
    queryKey: ["recipe-allergens", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recipe_allergens", { p_recipe_id: id });
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
}

/** % of sales $ covered by a menu recipe. Manager tier only. */
export function useRecipeCoverage(
  restaurantId: string | null,
  from: string,
  to: string,
  enabled: boolean
) {
  return useQuery<RecipeCoverage | null>({
    queryKey: ["recipe-coverage", restaurantId ?? "all", from, to],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recipe_coverage", {
        p_restaurant_id: restaurantId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      const rows = (data ?? []) as RecipeCoverage[];
      return rows[0] ?? null;
    },
  });
}

/** The work list: POS products with no recipe yet, biggest money first. */
export function useUnmappedProducts(
  restaurantId: string | null,
  from: string,
  to: string,
  enabled: boolean,
  limit = 50
) {
  return useQuery<UnmappedProduct[]>({
    queryKey: ["recipe-unmapped", restaurantId ?? "all", from, to, limit],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recipe_unmapped_products", {
        p_restaurant_id: restaurantId,
        p_from: from,
        p_to: to,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as UnmappedProduct[];
    },
  });
}

/**
 * Every recipe reachable from each recipe, so the sub-recipe picker can refuse
 * a choice that would create a cycle. The database guards against runaway
 * recursion, but it should never get the chance.
 */
export function useRecipeDescendants() {
  const { data: edges = [] } = useQuery<{ recipe_id: string; sub_recipe_id: string }[]>({
    queryKey: ["recipe-edges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_lines")
        .select("recipe_id, sub_recipe_id")
        .eq("component_type", "recipe");
      if (error) throw error;
      return (data ?? []) as { recipe_id: string; sub_recipe_id: string }[];
    },
  });

  return useMemo(() => {
    const children = new Map<string, string[]>();
    for (const e of edges) {
      if (!e.sub_recipe_id) continue;
      const list = children.get(e.recipe_id) ?? [];
      list.push(e.sub_recipe_id);
      children.set(e.recipe_id, list);
    }
    /** Ids that `root` already depends on (so picking one would loop). */
    return (root: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [...(children.get(root) ?? [])];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...(children.get(id) ?? []));
      }
      return seen;
    };
  }, [edges]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes — superadmin owns the spec (enforced by RLS, not just by the UI)
// ─────────────────────────────────────────────────────────────────────────────

export type RecipeDraft = Partial<Recipe> & { name: string };
export type LineDraft = Omit<
  RecipeLine,
  "id" | "recipe_id" | "qty_stock_units" | "created_at" | "food_cost_item" | "sub_recipe"
>;
export type StepDraft = Omit<RecipeStep, "id" | "recipe_id" | "created_at">;

/**
 * Upsert a recipe with its lines and steps. Lines and steps are replaced
 * wholesale — the editor holds the full list, and the ledger has no opinion
 * about a recipe's history in R1.
 */
export function useSaveRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      recipe: RecipeDraft & { id?: string };
      lines: LineDraft[];
      steps: StepDraft[];
    }) => {
      const { recipe, lines, steps } = args;
      const { data: saved, error: rErr } = await supabase
        .from("recipes")
        .upsert(recipe)
        .select()
        .single();
      if (rErr) throw rErr;
      const id = (saved as Recipe).id;

      const { error: dlErr } = await supabase.from("recipe_lines").delete().eq("recipe_id", id);
      if (dlErr) throw dlErr;
      if (lines.length) {
        const { error } = await supabase
          .from("recipe_lines")
          .insert(lines.map((l, i) => ({ ...l, recipe_id: id, sort_order: i + 1 })));
        if (error) throw error;
      }

      const { error: dsErr } = await supabase.from("recipe_steps").delete().eq("recipe_id", id);
      if (dsErr) throw dsErr;
      if (steps.length) {
        const { error } = await supabase
          .from("recipe_steps")
          .insert(steps.map((s, i) => ({ ...s, recipe_id: id, step_no: i + 1 })));
        if (error) throw error;
      }
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["recipe", id] });
      qc.invalidateQueries({ queryKey: ["recipe-costs"] });
      qc.invalidateQueries({ queryKey: ["recipe-issues", id] });
      qc.invalidateQueries({ queryKey: ["recipe-allergens", id] });
      qc.invalidateQueries({ queryKey: ["recipe-edges"] });
      qc.invalidateQueries({ queryKey: ["recipe-coverage"] });
      qc.invalidateQueries({ queryKey: ["recipe-unmapped"] });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["recipe-edges"] });
    },
  });
}

/**
 * Photos go through a definer RPC so a manager can put a picture on a card
 * without being able to touch the spec (Postgres has no column-level RLS).
 */
export function useSetRecipePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipeId, path }: { recipeId: string; path: string | null }) => {
      const { error } = await supabase.rpc("recipe_set_photo", {
        p_recipe_id: recipeId,
        p_path: path,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["recipe", v.recipeId] });
      qc.invalidateQueries({ queryKey: ["recipes"] });
    },
  });
}

export function useSetStepPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, path }: { stepId: string; path: string | null; recipeId: string }) => {
      const { error } = await supabase.rpc("recipe_step_set_photo", {
        p_step_id: stepId,
        p_path: path,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["recipe", v.recipeId] }),
  });
}

/** Availability + par level are the venue's call: manager tier, own venues. */
export function useSaveVenueSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<RecipeVenueSetting> & { recipe_id: string; restaurant_id: string }) => {
      const { error } = await supabase
        .from("recipe_venue_settings")
        .upsert({ ...row, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["recipe", v.recipe_id] }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

/** 0.045 kg reads badly on a bench. Show it as 45 g. */
export function formatQty(qty: number | null, unit: string | null): string {
  if (qty === null || qty === undefined || Number.isNaN(qty)) return "—";
  const u = (unit ?? "").trim().toLowerCase();
  let value = qty;
  let shown = unit ?? "";

  if ((u === "kg" || u === "kilogram" || u === "kilograms") && Math.abs(qty) < 1) {
    value = qty * 1000;
    shown = "g";
  } else if ((u === "l" || u === "litre" || u === "litres" || u === "liter") && Math.abs(qty) < 1) {
    value = qty * 1000;
    shown = "ml";
  }

  const rounded =
    Math.abs(value) >= 100 ? Math.round(value)
    : Math.abs(value) >= 10 ? Math.round(value * 10) / 10
    : Math.round(value * 100) / 100;

  return `${rounded.toLocaleString()}${shown ? ` ${shown}` : ""}`;
}

/** Units the editor offers, grouped by family. Anything else is free text. */
export const UNIT_OPTIONS = ["g", "kg", "ml", "L", "each"] as const;

/**
 * Resolve a stored media reference. Accepts either a bucket path or an already
 * public URL, so it keeps working whichever the editor happened to save.
 */
export function recipeMediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return supabase.storage.from("recipe-media").getPublicUrl(path).data.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client-side explode — mirrors public.recipe_explode() exactly, for screens
// that need to recompute as the user types (stock counts) without a round trip
// per keystroke. Same rules: stop at a stocked prep recipe, guard cycles, cap
// depth. If you change one, change the other.
// ─────────────────────────────────────────────────────────────────────────────

interface ExploderRecipe {
  id: string;
  yield_qty: number;
  is_stocked: boolean;
  output_food_cost_item_id: string | null;
  lines: Pick<RecipeLine, "component_type" | "food_cost_item_id" | "sub_recipe_id" | "qty_stock_units">[];
}

export function useRecipeExploder() {
  const { data: recipes = [] } = useQuery<ExploderRecipe[]>({
    queryKey: ["recipe-exploder"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select(
          `id, yield_qty, is_stocked, output_food_cost_item_id,
           lines:recipe_lines!recipe_lines_recipe_id_fkey(component_type, food_cost_item_id, sub_recipe_id, qty_stock_units)`
        );
      if (error) throw error;
      return (data ?? []) as ExploderRecipe[];
    },
  });

  return useMemo(() => {
    const byId = new Map(recipes.map((r) => [r.id, r]));

    return (recipeId: string, batches: number): Map<string, number> => {
      const out = new Map<string, number>();
      const add = (itemId: string, qty: number) =>
        out.set(itemId, (out.get(itemId) ?? 0) + qty);

      const walk = (id: string, mult: number, path: Set<string>) => {
        const r = byId.get(id);
        if (!r || path.size >= 12) return;
        for (const l of r.lines ?? []) {
          const qty = (l.qty_stock_units ?? 0) * mult;
          if (l.component_type === "item") {
            if (l.food_cost_item_id) add(l.food_cost_item_id, qty);
            continue;
          }
          if (!l.sub_recipe_id) continue;
          const sub = byId.get(l.sub_recipe_id);
          if (!sub) continue;
          if (sub.is_stocked) {
            // A stocked batch is stock in its own right — take its output item.
            if (sub.output_food_cost_item_id) add(sub.output_food_cost_item_id, qty);
          } else if (!path.has(l.sub_recipe_id) && sub.yield_qty > 0) {
            walk(l.sub_recipe_id, qty / sub.yield_qty, new Set([...path, id]));
          }
        }
      };

      walk(recipeId, batches, new Set());
      return out;
    };
  }, [recipes]);
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 — prep list, production logging (migration 074)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every prep recipe at the venue, with today's plan on top of it. Par is only a
 * suggestion here — what the team works through is what a manager set.
 * No cost, so it is safe for every role.
 */
export function usePrepBoard(restaurantId: string | null, date?: string) {
  return useQuery<PrepBoardRow[]>({
    queryKey: ["prep-board", restaurantId ?? "none", date ?? "today"],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("prep_board", {
        p_restaurant_id: restaurantId,
        p_date: date ?? null,
      });
      if (error) throw error;
      return (data ?? []) as PrepBoardRow[];
    },
  });
}

/** Manager tier only. A target of 0 takes the recipe off today's list. */
export function useSetPrepPlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      restaurantId: string;
      recipeId: string;
      targetQty: number | null;
      note?: string | null;
      date?: string;
    }) => {
      const { error } = await supabase.rpc("set_prep_plan_item", {
        p_restaurant_id: args.restaurantId,
        p_recipe_id: args.recipeId,
        p_target_qty: args.targetQty,
        p_note: args.note ?? null,
        p_date: args.date ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prep-board"] }),
  });
}

/** Ticking a line off is the team's job — venue access is enough. */
export function useCompletePrepPlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      restaurantId: string;
      recipeId: string;
      done: boolean;
      date?: string;
    }) => {
      const { error } = await supabase.rpc("complete_prep_plan_item", {
        p_restaurant_id: args.restaurantId,
        p_recipe_id: args.recipeId,
        p_done: args.done,
        p_date: args.date ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prep-board"] }),
  });
}

/** Most days look like yesterday. Returns how many lines were copied. */
export function useCopyPrepPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { restaurantId: string; from?: string; to?: string }) => {
      const { data, error } = await supabase.rpc("copy_prep_plan", {
        p_restaurant_id: args.restaurantId,
        p_from: args.from ?? null,
        p_to: args.to ?? null,
      });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prep-board"] }),
  });
}

export function useClearPrepPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { restaurantId: string; date?: string }) => {
      const { data, error } = await supabase.rpc("clear_prep_plan", {
        p_restaurant_id: args.restaurantId,
        p_date: args.date ?? null,
      });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prep-board"] }),
  });
}

/** Recent batches, newest first. Optionally for one recipe. */
export function useProductionRuns(
  restaurantId: string | null,
  recipeId?: string,
  limit = 50
) {
  return useQuery<ProductionRun[]>({
    queryKey: ["production-runs", restaurantId ?? "all", recipeId ?? "all", limit],
    queryFn: async () => {
      let q = supabase
        .from("production_runs")
        .select("*, recipe:recipes(*)")
        .order("made_at", { ascending: false })
        .limit(limit);
      if (restaurantId) q = q.eq("restaurant_id", restaurantId);
      if (recipeId) q = q.eq("recipe_id", recipeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProductionRun[];
    },
  });
}

/**
 * Log a batch. Returns the new run so the caller can print a label from it.
 * Stock only moves for a stocked recipe — `posted` on the returned row says
 * whether it did, and false there is deliberate, not a failure.
 */
export function usePostProductionRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      restaurantId: string;
      recipeId: string;
      batches: number;
      producedQty?: number | null;
      notes?: string | null;
      madeByName?: string | null;
    }): Promise<ProductionRun> => {
      const { data, error } = await supabase.rpc("post_production_run", {
        p_restaurant_id: args.restaurantId,
        p_recipe_id: args.recipeId,
        p_batches: args.batches,
        p_produced_qty: args.producedQty ?? null,
        p_notes: args.notes ?? null,
        p_made_by_name: args.madeByName ?? null,
      });
      if (error) throw error;
      const { data: run, error: rErr } = await supabase
        .from("production_runs")
        .select("*, recipe:recipes(*)")
        .eq("id", data as string)
        .single();
      if (rErr) throw rErr;
      return run as ProductionRun;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prep-board"] });
      qc.invalidateQueries({ queryKey: ["production-runs"] });
      qc.invalidateQueries({ queryKey: ["inventory-levels"] });
      qc.invalidateQueries({ queryKey: ["inventory-movements"] });
      qc.invalidateQueries({ queryKey: ["recipe-costs"] });
    },
  });
}

export function useVoidProductionRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, reason }: { runId: string; reason?: string }) => {
      const { error } = await supabase.rpc("void_production_run", {
        p_run_id: runId,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prep-board"] });
      qc.invalidateQueries({ queryKey: ["production-runs"] });
      qc.invalidateQueries({ queryKey: ["inventory-levels"] });
      qc.invalidateQueries({ queryKey: ["inventory-movements"] });
    },
  });
}

/** One glance at the shelf, once a day — makes par work for non-stocked prep. */
export function useSavePrepCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      restaurantId: string;
      recipeId: string;
      onHandQty: number;
      unit: string | null;
    }) => {
      const { error } = await supabase.from("prep_checks").upsert(
        {
          restaurant_id: args.restaurantId,
          recipe_id: args.recipeId,
          on_hand_qty: args.onHandQty,
          unit: args.unit,
          checked_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,recipe_id,business_date" }
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prep-board"] }),
  });
}
