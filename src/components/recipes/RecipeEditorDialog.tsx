import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePositions } from "@/hooks/usePositions";
import { useFileUpload } from "@/hooks/useFileUpload";
import {
  useRecipe,
  useRecipeList,
  useRecipeDescendants,
  useSaveRecipe,
  useDeleteRecipe,
  recipeMediaUrl,
  UNIT_OPTIONS,
  type LineDraft,
  type StepDraft,
} from "@/hooks/useRecipes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FoodCostItem, RecipeType } from "@/types";

interface Props {
  recipeId?: string;
  /** Pre-fill the name — used by "create" on an unmapped POS product. */
  presetName?: string;
  open: boolean;
  onClose: () => void;
}

const NONE = "__none__";

function useFoodCostItems() {
  return useQuery<FoodCostItem[]>({
    queryKey: ["food-cost-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("food_cost_items").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as FoodCostItem[];
    },
  });
}

export function RecipeEditorDialog({ recipeId, presetName, open, onClose }: Props) {
  const { data: existing } = useRecipe(recipeId ?? null);
  const { data: items = [] } = useFoodCostItems();
  const { data: allRecipes = [] } = useRecipeList("all");
  const { activePositions } = usePositions(null);
  const descendantsOf = useRecipeDescendants();
  const save = useSaveRecipe();
  const remove = useDeleteRecipe();
  const heroUpload = useFileUpload({ bucket: "recipe-media", folder: "hero" });
  const stepUpload = useFileUpload({ bucket: "recipe-media", folder: "steps" });

  const [form, setForm] = useState({
    name: presetName ?? "",
    type: (presetName ? "menu" : "prep") as RecipeType,
    category: "",
    description: "",
    method_intro: "",
    yield_qty: "1",
    yield_unit: "each",
    portions: "",
    yield_loss_pct: "",
    is_stocked: false,
    output_food_cost_item_id: "",
    shelf_life_hours: "",
    prep_time_mins: "",
    equipment: "",
    station_id: "",
    extra_allergens: "",
    active: true,
    hero_image_path: "",
  });
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [uploadingStep, setUploadingStep] = useState<number | null>(null);

  // Load an existing recipe into the form once it arrives.
  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      type: existing.type,
      category: existing.category ?? "",
      description: existing.description ?? "",
      method_intro: existing.method_intro ?? "",
      yield_qty: String(existing.yield_qty),
      yield_unit: existing.yield_unit,
      portions: existing.portions == null ? "" : String(existing.portions),
      yield_loss_pct: existing.yield_loss_pct == null ? "" : String(existing.yield_loss_pct),
      is_stocked: existing.is_stocked,
      output_food_cost_item_id: existing.output_food_cost_item_id ?? "",
      shelf_life_hours: existing.shelf_life_hours == null ? "" : String(existing.shelf_life_hours),
      prep_time_mins: existing.prep_time_mins == null ? "" : String(existing.prep_time_mins),
      equipment: existing.equipment ?? "",
      station_id: existing.station_id ?? "",
      extra_allergens: (existing.extra_allergens ?? []).join(", "),
      active: existing.active,
      hero_image_path: existing.hero_image_path ?? "",
    });
    setLines(
      existing.lines.map((l) => ({
        component_type: l.component_type,
        food_cost_item_id: l.food_cost_item_id,
        sub_recipe_id: l.sub_recipe_id,
        qty_entered: l.qty_entered,
        unit_entered: l.unit_entered,
        note: l.note,
        optional: l.optional,
        sort_order: l.sort_order,
      }))
    );
    setSteps(existing.steps.map((s) => ({ step_no: s.step_no, body: s.body, image_path: s.image_path })));
  }, [existing]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // A recipe may not depend on anything that already depends on it.
  const blockedSubRecipes = useMemo(() => {
    const blocked = new Set<string>();
    if (recipeId) {
      blocked.add(recipeId);
      // anything that reaches this recipe would close a loop
      for (const r of allRecipes) {
        if (r.id !== recipeId && descendantsOf(r.id).has(recipeId)) blocked.add(r.id);
      }
    }
    return blocked;
  }, [recipeId, allRecipes, descendantsOf]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  function addLine(kind: "item" | "recipe") {
    setLines((ls) => [
      ...ls,
      {
        component_type: kind,
        food_cost_item_id: null,
        sub_recipe_id: null,
        qty_entered: 1,
        unit_entered: null,
        note: null,
        optional: false,
        sort_order: ls.length + 1,
      },
    ]);
  }

  function patchLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function moveStep(i: number, dir: -1 | 1) {
    setSteps((ss) => {
      const next = [...ss];
      const j = i + dir;
      if (j < 0 || j >= next.length) return ss;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, idx) => ({ ...s, step_no: idx + 1 }));
    });
  }

  async function onHeroFile(file: File) {
    try {
      const { path } = await heroUpload.upload(file);
      set("hero_image_path", path);
    } catch {
      toast.error("Couldn't upload that photo");
    }
  }

  async function onStepFile(i: number, file: File) {
    setUploadingStep(i);
    try {
      const { path } = await stepUpload.upload(file);
      setSteps((ss) => ss.map((s, idx) => (idx === i ? { ...s, image_path: path } : s)));
    } catch {
      toast.error("Couldn't upload that photo");
    } finally {
      setUploadingStep(null);
    }
  }

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!form.name.trim()) out.push("Give the recipe a name.");
    if (!(Number(form.yield_qty) > 0)) out.push("Yield must be greater than zero.");
    if (form.is_stocked && !form.output_food_cost_item_id)
      out.push("A stocked batch needs an output item so production can post to the ledger.");
    lines.forEach((l, i) => {
      if (l.component_type === "item" && !l.food_cost_item_id) out.push(`Line ${i + 1} has no ingredient.`);
      if (l.component_type === "recipe" && !l.sub_recipe_id) out.push(`Line ${i + 1} has no sub-recipe.`);
      if (!(Number(l.qty_entered) > 0)) out.push(`Line ${i + 1} needs a quantity.`);
    });
    return out;
  }, [form, lines]);

  async function onSave() {
    if (problems.length) return;
    try {
      await save.mutateAsync({
        recipe: {
          ...(recipeId ? { id: recipeId } : {}),
          name: form.name.trim(),
          type: form.type,
          category: form.category.trim() || null,
          description: form.description.trim() || null,
          method_intro: form.method_intro.trim() || null,
          yield_qty: Number(form.yield_qty),
          yield_unit: form.yield_unit.trim() || "each",
          portions: form.portions === "" ? null : Number(form.portions),
          yield_loss_pct: form.yield_loss_pct === "" ? null : Number(form.yield_loss_pct),
          is_stocked: form.type === "prep" ? form.is_stocked : false,
          output_food_cost_item_id: form.output_food_cost_item_id || null,
          shelf_life_hours: form.shelf_life_hours === "" ? null : Number(form.shelf_life_hours),
          prep_time_mins: form.prep_time_mins === "" ? null : Number(form.prep_time_mins),
          equipment: form.equipment.trim() || null,
          station_id: form.station_id || null,
          extra_allergens: form.extra_allergens
            .split(",")
            .map((a) => a.trim().toLowerCase())
            .filter(Boolean),
          active: form.active,
          hero_image_path: form.hero_image_path || null,
        },
        lines,
        steps: steps.filter((s) => s.body.trim()),
      });
      toast.success(recipeId ? "Recipe updated" : "Recipe created");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the recipe");
    }
  }

  const heroPreview = recipeMediaUrl(form.hero_image_path || null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipeId ? "Edit recipe" : "New recipe"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
              {form.type === "menu" && (
                <p className="text-xs text-muted-foreground">
                  Match the POS product name exactly and it maps itself.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v as RecipeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prep">Prep — a batch you make</SelectItem>
                  <SelectItem value="menu">Menu item — what the POS sells</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="category">Category</Label>
              <Input id="category" value={form.category} onChange={(e) => set("category", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
          </div>

          {/* Photo */}
          <div className="space-y-1">
            <Label>Photo</Label>
            <div className="flex items-center gap-3">
              {heroPreview ? (
                <div className="relative">
                  <img src={heroPreview} alt="" className="h-20 w-28 rounded-lg border border-border object-cover" />
                  <button
                    type="button"
                    onClick={() => set("hero_image_path", "")}
                    className="absolute -right-2 -top-2 rounded-full border border-border bg-card p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <label className="flex h-20 w-28 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border-strong text-muted-foreground hover:text-foreground">
                  {heroUpload.uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && onHeroFile(e.target.files[0])}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Yield */}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="yq">Makes</Label>
              <Input id="yq" type="number" step="any" min="0" value={form.yield_qty} onChange={(e) => set("yield_qty", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yu">Unit</Label>
              <Input id="yu" list="unit-options" value={form.yield_unit} onChange={(e) => set("yield_unit", e.target.value)} />
              <datalist id="unit-options">
                {UNIT_OPTIONS.map((u) => <option key={u} value={u} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="portions">Portions</Label>
              <Input id="portions" type="number" step="any" min="0" value={form.portions} onChange={(e) => set("portions", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loss">Expected loss %</Label>
              <Input id="loss" type="number" step="any" min="0" max="99" value={form.yield_loss_pct} onChange={(e) => set("yield_loss_pct", e.target.value)} />
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            "Makes" is the net usable output — what you actually end up with after trim and cook
            loss. Expected loss is for the variance check, not the cost maths.
          </p>

          {/* Stocked batch */}
          {form.type === "prep" && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="stocked">Track this batch as stock</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Off (default): selling an item that uses this consumes its ingredients. On:
                    the team logs each batch and the output becomes stock in its own right, so
                    you get yield variance. Production logging arrives in R2.
                  </p>
                </div>
                <Switch id="stocked" checked={form.is_stocked} onCheckedChange={(v) => set("is_stocked", v)} />
              </div>
              {form.is_stocked && (
                <div className="mt-3 space-y-1">
                  <Label>Output item</Label>
                  <Select
                    value={form.output_food_cost_item_id || NONE}
                    onValueChange={(v) => set("output_food_cost_item_id", v === NONE ? "" : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Pick the stocked item" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Ingredients */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Ingredients</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => addLine("item")}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Ingredient
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => addLine("recipe")}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Sub-recipe
                </Button>
              </div>
            </div>
            {lines.length === 0 && (
              <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-sm text-muted-foreground">
                Nothing yet. Add ingredients, or a sub-recipe you already wrote up.
              </p>
            )}
            {lines.map((l, i) => {
              const item = l.food_cost_item_id ? itemById.get(l.food_cost_item_id) : null;
              return (
                <div key={i} className="flex flex-wrap items-start gap-2 rounded-lg border border-border p-2">
                  <div className="min-w-[180px] flex-1">
                    {l.component_type === "item" ? (
                      <Select
                        value={l.food_cost_item_id ?? NONE}
                        onValueChange={(v) =>
                          patchLine(i, {
                            food_cost_item_id: v === NONE ? null : v,
                            unit_entered: l.unit_entered ?? itemById.get(v)?.unit ?? null,
                          })
                        }
                      >
                        <SelectTrigger><SelectValue placeholder="Ingredient" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Choose…</SelectItem>
                          {items.map((it) => (
                            <SelectItem key={it.id} value={it.id}>{it.name} ({it.unit})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={l.sub_recipe_id ?? NONE}
                        onValueChange={(v) => {
                          const sub = allRecipes.find((r) => r.id === v);
                          patchLine(i, {
                            sub_recipe_id: v === NONE ? null : v,
                            unit_entered: l.unit_entered ?? sub?.yield_unit ?? null,
                          });
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Sub-recipe" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Choose…</SelectItem>
                          {allRecipes
                            .filter((r) => !blockedSubRecipes.has(r.id))
                            .map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name} ({r.yield_unit})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <Input
                    className="w-24"
                    type="number"
                    step="any"
                    min="0"
                    value={l.qty_entered}
                    onChange={(e) => patchLine(i, { qty_entered: Number(e.target.value) })}
                  />
                  <Input
                    className="w-24"
                    list="unit-options"
                    placeholder={item?.unit ?? "unit"}
                    value={l.unit_entered ?? ""}
                    onChange={(e) => patchLine(i, { unit_entered: e.target.value || null })}
                  />
                  <Input
                    className="min-w-[120px] flex-1"
                    placeholder="Note (finely diced…)"
                    value={l.note ?? ""}
                    onChange={(e) => patchLine(i, { note: e.target.value || null })}
                  />
                  <label className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={l.optional}
                      onChange={(e) => patchLine(i, { optional: e.target.checked })}
                    />
                    optional
                  </label>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Method */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Method</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSteps((ss) => [...ss, { step_no: ss.length + 1, body: "", image_path: null }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Step
              </Button>
            </div>
            <Textarea
              rows={2}
              placeholder="Anything to say before step 1…"
              value={form.method_intro}
              onChange={(e) => set("method_intro", e.target.value)}
            />
            {steps.map((s, i) => {
              const img = recipeMediaUrl(s.image_path);
              return (
                <div key={i} className="flex gap-2 rounded-lg border border-border p-2">
                  <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 space-y-2">
                    <Textarea
                      rows={2}
                      value={s.body}
                      placeholder="What to do"
                      onChange={(e) =>
                        setSteps((ss) => ss.map((x, idx) => (idx === i ? { ...x, body: e.target.value } : x)))
                      }
                    />
                    {img ? (
                      <div className="relative w-fit">
                        <img src={img} alt="" className="h-16 rounded-md border border-border object-cover" />
                        <button
                          type="button"
                          onClick={() => setSteps((ss) => ss.map((x, idx) => (idx === i ? { ...x, image_path: null } : x)))}
                          className="absolute -right-2 -top-2 rounded-full border border-border bg-card p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <label className={cn(
                        "inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground",
                        uploadingStep === i && "opacity-60"
                      )}>
                        {uploadingStep === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                        Add a photo
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && onStepFile(i, e.target.files[0])}
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button type="button" size="icon" variant="ghost" onClick={() => moveStep(i, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => moveStep(i, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setSteps((ss) => ss.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, step_no: idx + 1 })))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Kitchen detail */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="prep">Prep time (min)</Label>
              <Input id="prep" type="number" min="0" value={form.prep_time_mins} onChange={(e) => set("prep_time_mins", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shelf">Shelf life (hours)</Label>
              <Input id="shelf" type="number" step="any" min="0" value={form.shelf_life_hours} onChange={(e) => set("shelf_life_hours", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="equip">Equipment</Label>
              <Input id="equip" value={form.equipment} onChange={(e) => set("equipment", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Station</Label>
              <Select value={form.station_id || NONE} onValueChange={(v) => set("station_id", v === NONE ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {activePositions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="alg">Extra allergens</Label>
              <Input
                id="alg"
                placeholder="sesame, mustard"
                value={form.extra_allergens}
                onChange={(e) => set("extra_allergens", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Only what the process adds. Ingredient allergens roll up on their own.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="active">Active</Label>
            <Switch id="active" checked={form.active} onCheckedChange={(v) => set("active", v)} />
          </div>

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-foreground">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          {recipeId && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={async () => {
                await remove.mutateAsync(recipeId);
                toast.success("Recipe deleted");
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={problems.length > 0 || save.isPending}>
            {save.isPending ? "Saving…" : "Save recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
