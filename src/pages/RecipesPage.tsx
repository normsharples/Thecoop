import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { subDays, format } from "date-fns";
import {
  BookOpen,
  Plus,
  Search,
  ChefHat,
  UtensilsCrossed,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Boxes,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  useRecipeList,
  useRecipeCosts,
  useRecipeCoverage,
  useUnmappedProducts,
  formatQty,
  recipeMediaUrl,
} from "@/hooks/useRecipes";
import { cn, formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RecipeEditorDialog } from "@/components/recipes/RecipeEditorDialog";
import type { RecipeCostBasis, RecipeType } from "@/types";

const FILTERS: { key: RecipeType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "menu", label: "Menu items" },
  { key: "prep", label: "Prep" },
];

export default function RecipesPage() {
  const { isSuperadmin, canViewSalesData } = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const [filter, setFilter] = useState<RecipeType | "all">("all");
  const [search, setSearch] = useState("");
  const [basis, setBasis] = useState<RecipeCostBasis>("live");
  const [editing, setEditing] = useState<{ id?: string; presetName?: string } | null>(null);
  const [showUnmapped, setShowUnmapped] = useState(false);

  // Cost figures never leave the server for staff — gate the query, not the render.
  const canSeeCost = canViewSalesData;

  const { data: recipes = [], isLoading } = useRecipeList(filter);
  const { data: costs = {} } = useRecipeCosts(selectedRestaurantId, basis, canSeeCost);

  const to = format(new Date(), "yyyy-MM-dd");
  const from = format(subDays(new Date(), 27), "yyyy-MM-dd");
  const { data: coverage } = useRecipeCoverage(selectedRestaurantId, from, to, canSeeCost);
  const { data: unmapped = [] } = useUnmappedProducts(
    selectedRestaurantId,
    from,
    to,
    canSeeCost && showUnmapped
  );

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q)
    );
  }, [recipes, search]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Recipes</h2>
          <span className="text-sm text-muted-foreground">
            — {restaurant?.name ?? "All venues"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canSeeCost && (
            <div className="flex rounded-lg border border-border-strong p-0.5">
              {(["live", "standard"] as RecipeCostBasis[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setBasis(b)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    basis === b
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title={
                    b === "live"
                      ? "This venue's moving-average cost right now"
                      : "The standard cost you price against"
                  }
                >
                  {b}
                </button>
              ))}
            </div>
          )}
          {isSuperadmin && (
            <Button size="sm" onClick={() => setEditing({})}>
              <Plus className="mr-1.5 h-4 w-4" />
              New recipe
            </Button>
          )}
        </div>
      </div>

      {/* Coverage — the rollout meter. How much of the money is explained? */}
      {canSeeCost && coverage && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="eyebrow text-muted-foreground">Recipe coverage — last 28 days</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {coverage.coverage_pct}%
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  of sales $ have a recipe
                </span>
              </p>
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatCurrency(coverage.mapped_sales)} of {formatCurrency(coverage.total_sales)}
            </p>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${Math.min(100, coverage.coverage_pct)}%` }}
            />
          </div>
          {coverage.total_sales === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No product-level sales for this period yet — coverage lights up once the sales-mix
              product feed is reading real rows.
            </p>
          ) : (
            <button
              onClick={() => setShowUnmapped((v) => !v)}
              className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {showUnmapped ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {coverage.unmapped_products} product{coverage.unmapped_products === 1 ? "" : "s"} with no
              recipe — biggest money first
            </button>
          )}

          {showUnmapped && unmapped.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle">
                  <tr className="text-muted-foreground">
                    <th className="px-3 py-1.5 text-left font-medium">Product</th>
                    <th className="px-3 py-1.5 text-left font-medium">Category</th>
                    <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-1.5 text-right font-medium">Sales</th>
                    {isSuperadmin && <th className="px-3 py-1.5" />}
                  </tr>
                </thead>
                <tbody>
                  {unmapped.map((u) => (
                    <tr key={u.item_name} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium text-foreground">{u.item_name}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{u.category_name ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{u.quantity}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatCurrency(u.sales_amount)}
                      </td>
                      {isSuperadmin && (
                        <td className="px-3 py-1.5 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ presetName: u.item_name })}
                          >
                            Create
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border-strong p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="pl-8"
          />
        </div>
      </div>

      {/* The book */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading recipes…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSuperadmin
              ? "Start with your biggest sellers — the coverage meter above ranks them by money."
              : "Recipes will appear here once they're written up."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const cost = costs[r.id];
            const lineCount = r.lines?.length ?? 0;
            const perPortion = cost?.cost_per_portion ?? cost?.cost_per_yield_unit ?? null;
            const flagged = !!cost && (cost.incomplete || cost.missing_cost_items > 0);
            return (
              <Link
                key={r.id}
                to={`/recipes/${r.id}`}
                className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-border-strong"
              >
                <div className="flex h-28 items-center justify-center bg-surface-sunken">
                  {r.hero_image_path ? (
                    <img
                      src={recipeMediaUrl(r.hero_image_path) ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : r.type === "menu" ? (
                    <UtensilsCrossed className="h-7 w-7 text-muted-foreground" />
                  ) : (
                    <ChefHat className="h-7 w-7 text-muted-foreground" />
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium leading-tight text-foreground">{r.name}</p>
                    <Badge variant={r.type === "menu" ? "default" : "secondary"} className="shrink-0">
                      {r.type === "menu" ? "Menu" : "Prep"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{r.category ?? "Uncategorised"}</span>
                    <span className="tabular-nums">
                      Makes {formatQty(r.yield_qty, r.yield_unit)}
                    </span>
                    {r.prep_time_mins != null && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock className="h-3 w-3" />
                        {r.prep_time_mins}m
                      </span>
                    )}
                    {r.is_stocked && (
                      <span className="inline-flex items-center gap-1">
                        <Boxes className="h-3 w-3" />
                        Stocked
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-xs text-muted-foreground">
                      {lineCount} ingredient{lineCount === 1 ? "" : "s"}
                    </span>
                    {canSeeCost && perPortion != null && (
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          flagged ? "text-warning" : "text-foreground"
                        )}
                      >
                        {formatCurrency(perPortion)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          / {r.portions ? "portion" : r.yield_unit}
                        </span>
                      </span>
                    )}
                  </div>
                  {canSeeCost && flagged && (
                    <p className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      {cost.incomplete
                        ? "A quantity can't be converted"
                        : `${cost.missing_cost_items} ingredient${cost.missing_cost_items === 1 ? "" : "s"} with no cost`}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {editing && (
        <RecipeEditorDialog
          recipeId={editing.id}
          presetName={editing.presetName}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
