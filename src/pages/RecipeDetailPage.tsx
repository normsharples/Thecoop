import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  ChefHat,
  UtensilsCrossed,
  Clock,
  Timer,
  Wrench,
  Pencil,
  AlertTriangle,
  Boxes,
  ShieldAlert,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  useRecipe,
  useRecipeIssues,
  useRecipeAllergens,
  useRecipeCosts,
  useSaveVenueSetting,
  useProductionRuns,
  formatQty,
  recipeMediaUrl,
} from "@/hooks/useRecipes";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RecipeEditorDialog } from "@/components/recipes/RecipeEditorDialog";
import { RecipePhotoButton } from "@/components/recipes/RecipePhotoButton";
import { MakeBatchDialog, type MakeBatchTarget } from "@/components/recipes/MakeBatchDialog";
import type { RecipeCostBasis } from "@/types";

const SCALES = [0.5, 1, 2, 3];

function shelfLife(hours: number | null): string | null {
  if (!hours) return null;
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} day${days === 1 ? "" : "s"}`;
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperadmin, canViewSalesData } = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const [scale, setScale] = useState(1);
  const [basis, setBasis] = useState<RecipeCostBasis>("live");
  const [editing, setEditing] = useState(false);
  const [making, setMaking] = useState<MakeBatchTarget | null>(null);

  const canSeeCost = canViewSalesData;
  const { data: recipe, isLoading } = useRecipe(id ?? null);
  const { data: issues = [] } = useRecipeIssues(id ?? null, canSeeCost);
  const { data: allergens = [] } = useRecipeAllergens(id ?? null);
  const { data: costs = {} } = useRecipeCosts(selectedRestaurantId, basis, canSeeCost);
  const saveVenue = useSaveVenueSetting();
  const { data: runs = [] } = useProductionRuns(selectedRestaurantId, id ?? undefined, 5);

  const cost = id ? costs[id] : undefined;
  const venueSetting = useMemo(
    () => recipe?.venue_settings?.find((v) => v.restaurant_id === selectedRestaurantId),
    [recipe, selectedRestaurantId]
  );
  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading recipe…</p>;
  if (!recipe) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/recipes")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to recipes
        </Button>
        <p className="text-sm text-muted-foreground">That recipe no longer exists.</p>
      </div>
    );
  }

  const hero = recipeMediaUrl(recipe.hero_image_path);
  const scaled = (n: number | null) => (n == null ? null : n * scale);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/recipes")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Recipes
        </Button>
        <div className="flex items-center gap-2">
          {recipe?.type === "prep" && selectedRestaurantId && (
            <Button
              size="sm"
              onClick={() =>
                setMaking({
                  recipeId: recipe.id,
                  name: recipe.name,
                  yieldQty: recipe.yield_qty,
                  yieldUnit: recipe.yield_unit,
                  isStocked: recipe.is_stocked,
                })
              }
            >
              <ChefHat className="mr-1.5 h-4 w-4" /> Made it
            </Button>
          )}
          {isSuperadmin && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex h-44 items-center justify-center bg-surface-sunken sm:h-56">
          {hero ? (
            <img src={hero} alt="" className="h-full w-full object-cover" />
          ) : recipe.type === "menu" ? (
            <UtensilsCrossed className="h-10 w-10 text-muted-foreground" />
          ) : (
            <ChefHat className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
        <div className="space-y-3 p-4">
          {/* A manager can put a picture on a card without touching the spec. */}
          {canSeeCost && !isSuperadmin && (
            <RecipePhotoButton recipeId={recipe.id} hasPhoto={!!hero} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{recipe.name}</h1>
            <Badge variant={recipe.type === "menu" ? "default" : "secondary"}>
              {recipe.type === "menu" ? "Menu item" : "Prep"}
            </Badge>
            {recipe.is_stocked && (
              <Badge variant="outline" className="gap-1">
                <Boxes className="h-3 w-3" /> Stocked batch
              </Badge>
            )}
            {!recipe.active && <Badge variant="outline">Inactive</Badge>}
          </div>
          {recipe.description && (
            <p className="text-sm text-muted-foreground">{recipe.description}</p>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <p className="eyebrow text-muted-foreground">Makes</p>
              <p className="font-medium tabular-nums text-foreground">
                {formatQty(scaled(recipe.yield_qty), recipe.yield_unit)}
                {recipe.portions != null && (
                  <span className="ml-1 text-muted-foreground">
                    · {recipe.portions * scale} portions
                  </span>
                )}
              </p>
            </div>
            {recipe.prep_time_mins != null && (
              <div>
                <p className="eyebrow text-muted-foreground">Prep time</p>
                <p className="inline-flex items-center gap-1 font-medium tabular-nums text-foreground">
                  <Clock className="h-3.5 w-3.5" /> {recipe.prep_time_mins} min
                </p>
              </div>
            )}
            {shelfLife(recipe.shelf_life_hours) && (
              <div>
                <p className="eyebrow text-muted-foreground">Shelf life</p>
                <p className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Timer className="h-3.5 w-3.5" /> {shelfLife(recipe.shelf_life_hours)}
                </p>
              </div>
            )}
            {recipe.yield_loss_pct != null && (
              <div>
                <p className="eyebrow text-muted-foreground">Expected loss</p>
                <p className="font-medium tabular-nums text-foreground">{recipe.yield_loss_pct}%</p>
              </div>
            )}
            {recipe.equipment && (
              <div>
                <p className="eyebrow text-muted-foreground">Equipment</p>
                <p className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Wrench className="h-3.5 w-3.5" /> {recipe.equipment}
                </p>
              </div>
            )}
          </div>

          {allergens.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2">
              <ShieldAlert className="h-4 w-4 text-warning" />
              <span className="text-xs font-semibold uppercase tracking-wide text-warning">
                Allergens
              </span>
              {allergens.map((a) => (
                <Badge key={a} variant="outline" className="capitalize">
                  {a}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Ingredients + method */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h3 className="font-semibold text-foreground">Ingredients</h3>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">Batch</span>
                {SCALES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setScale(s)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors",
                      scale === s
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border-strong text-muted-foreground hover:text-foreground"
                    )}
                  >
                    ×{s}
                  </button>
                ))}
              </div>
            </div>
            {recipe.lines.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No ingredients on this recipe yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {recipe.lines.map((l) => {
                    const isSub = l.component_type === "recipe";
                    const name = isSub ? l.sub_recipe?.name : l.food_cost_item?.name;
                    return (
                      <tr key={l.id} className="border-b border-border last:border-0">
                        <td className="w-24 px-4 py-2 text-right font-medium tabular-nums text-foreground">
                          {formatQty(
                            scaled(l.qty_entered),
                            l.unit_entered ??
                              l.food_cost_item?.unit ??
                              l.sub_recipe?.yield_unit ??
                              null
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {isSub && l.sub_recipe ? (
                            <Link
                              to={`/recipes/${l.sub_recipe.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {name}
                            </Link>
                          ) : (
                            <span className="text-foreground">{name ?? "—"}</span>
                          )}
                          {l.note && (
                            <span className="ml-2 text-muted-foreground">— {l.note}</span>
                          )}
                          {l.optional && (
                            <Badge variant="outline" className="ml-2">
                              optional
                            </Badge>
                          )}
                          {isSub && (
                            <Badge variant="secondary" className="ml-2">
                              sub-recipe
                            </Badge>
                          )}
                        </td>
                        {l.qty_stock_units == null && (
                          <td className="px-4 py-2 text-right">
                            <span
                              className="inline-flex items-center gap-1 text-xs text-warning"
                              title="This unit can't be converted to the item's stock unit"
                            >
                              <AlertTriangle className="h-3 w-3" /> unit
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="font-semibold text-foreground">Method</h3>
            </div>
            {recipe.method_intro && (
              <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                {recipe.method_intro}
              </p>
            )}
            {recipe.steps.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No method written up yet.</p>
            ) : (
              <ol className="divide-y divide-border">
                {recipe.steps.map((s) => {
                  const img = recipeMediaUrl(s.image_path);
                  return (
                    <li key={s.id} className="flex gap-3 px-4 py-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                        {s.step_no}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="whitespace-pre-wrap text-sm text-foreground">{s.body}</p>
                        {img && (
                          <img
                            src={img}
                            alt=""
                            loading="lazy"
                            className="max-h-56 rounded-lg border border-border object-cover"
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        {/* Cost + venue — manager tier only */}
        {canSeeCost && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">Cost</h3>
                <div className="flex rounded-lg border border-border-strong p-0.5">
                  {(["live", "standard"] as RecipeCostBasis[]).map((b) => (
                    <button
                      key={b}
                      onClick={() => setBasis(b)}
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors",
                        basis === b
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {basis === "live"
                  ? `Moving average at ${restaurant?.name ?? "all venues"}, falling back to standard cost`
                  : "Standard cost per unit, the same at every venue"}
              </p>

              {!cost ? (
                <p className="mt-3 text-sm text-muted-foreground">No cost yet.</p>
              ) : (
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">Batch</dt>
                    <dd className="text-lg font-semibold tabular-nums text-foreground">
                      {formatCurrency(cost.total_cost * scale)}
                    </dd>
                  </div>
                  {cost.cost_per_yield_unit != null && (
                    <div className="flex items-baseline justify-between">
                      <dt className="text-muted-foreground">Per {recipe.yield_unit}</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatCurrency(cost.cost_per_yield_unit)}
                      </dd>
                    </div>
                  )}
                  {cost.cost_per_portion != null && (
                    <div className="flex items-baseline justify-between">
                      <dt className="text-muted-foreground">Per portion</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatCurrency(cost.cost_per_portion)}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>

            {issues.length > 0 && (
              <div className="rounded-xl border border-warning-border bg-warning-soft p-4">
                <h3 className="flex items-center gap-1.5 font-semibold text-warning">
                  <AlertTriangle className="h-4 w-4" /> Needs attention
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-foreground">
                  {issues.map((i, idx) => (
                    <li key={`${i.kind}-${idx}`}>{i.detail}</li>
                  ))}
                </ul>
              </div>
            )}

            {selectedRestaurantId && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-semibold text-foreground">{restaurant?.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recipes are the same everywhere. This venue only decides whether it makes the
                  item, and how much it wants on hand.
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <Label htmlFor="available" className="text-sm">
                    Made here
                  </Label>
                  <Switch
                    id="available"
                    checked={venueSetting?.available ?? true}
                    onCheckedChange={(v) =>
                      saveVenue.mutate({
                        recipe_id: recipe.id,
                        restaurant_id: selectedRestaurantId,
                        available: v,
                        par_qty: venueSetting?.par_qty ?? null,
                        par_unit: venueSetting?.par_unit ?? recipe.yield_unit,
                      })
                    }
                  />
                </div>
                <div className="mt-3 space-y-1">
                  <Label htmlFor="par" className="text-sm">
                    Par level ({recipe.yield_unit})
                  </Label>
                  <Input
                    id="par"
                    type="number"
                    min={0}
                    step="any"
                    defaultValue={venueSetting?.par_qty ?? ""}
                    placeholder="Not set"
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      saveVenue.mutate({
                        recipe_id: recipe.id,
                        restaurant_id: selectedRestaurantId,
                        available: venueSetting?.available ?? true,
                        par_qty: raw === "" ? null : Number(raw),
                        par_unit: recipe.yield_unit,
                      });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Drives the prep list in R2 — set it now and it's ready.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {recipe.type === "prep" && runs.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold text-foreground">Recent batches here</h3>
          </div>
          <ul className="divide-y divide-border">
            {runs.map((run) => {
              const short =
                run.expected_qty != null && run.produced_qty != null
                  ? run.produced_qty - run.expected_qty
                  : 0;
              return (
                <li
                  key={run.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm",
                    run.voided_at && "opacity-50"
                  )}
                >
                  <span className="tabular-nums text-muted-foreground">
                    {format(parseISO(run.made_at), "d MMM HH:mm")}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {formatQty(run.produced_qty, run.produced_unit)}
                    {Math.abs(short) > 1e-9 && (
                      <span className={cn("ml-1 text-xs", short < 0 ? "text-destructive" : "text-success")}>
                        {short > 0 ? "+" : ""}
                        {formatQty(short, run.produced_unit)}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">{run.made_by_name ?? "—"}</span>
                  {run.voided_at && <Badge variant="outline">voided</Badge>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {making && selectedRestaurantId && (
        <MakeBatchDialog
          target={making}
          restaurantId={selectedRestaurantId}
          venueName={restaurant?.name}
          open
          onClose={() => setMaking(null)}
        />
      )}

      {editing && (
        <RecipeEditorDialog recipeId={recipe.id} open onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
