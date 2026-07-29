import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Boxes,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  PackageOpen,
  Search,
} from "lucide-react";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useInventoryLevels, useInventoryMovements } from "@/hooks/useInventory";
import { cn, formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { InventoryMovementType } from "@/types";

// Movement type → label + colour for the drill-down ledger.
const MOVE_META: Record<InventoryMovementType, { label: string; tone: string }> = {
  opening:          { label: "Opening",     tone: "text-slate-500" },
  purchase:         { label: "Purchase",    tone: "text-green-600" },
  transfer_in:      { label: "Transfer in", tone: "text-green-600" },
  sale_depletion:   { label: "Sale",        tone: "text-blue-500" },
  waste:            { label: "Waste",       tone: "text-red-500" },
  transfer_out:     { label: "Transfer out",tone: "text-amber-600" },
  in_transit_loss:  { label: "Transit loss",tone: "text-red-500" },
  count_adjustment: { label: "Count adjust",tone: "text-purple-500" },
};

function ItemMovements({
  restaurantId,
  itemId,
}: {
  restaurantId: string | null;
  itemId: string;
}) {
  const { data: moves = [], isLoading } = useInventoryMovements(restaurantId, itemId, 50);

  if (isLoading) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">Loading movements…</p>;
  }
  if (moves.length === 0) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">No movements yet.</p>;
  }
  return (
    <div className="bg-muted/20 px-4 py-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium py-1">Date</th>
            <th className="text-left font-medium py-1">Type</th>
            <th className="text-right font-medium py-1">Qty</th>
            <th className="text-right font-medium py-1">Unit $</th>
            <th className="text-right font-medium py-1">Value</th>
            <th className="text-left font-medium py-1 pl-3">Note</th>
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => {
            const meta = MOVE_META[m.movement_type];
            return (
              <tr key={m.id} className="border-t border-border/50">
                <td className="py-1 tabular-nums">{format(parseISO(m.movement_date), "d MMM yy")}</td>
                <td className={cn("py-1 font-medium", meta?.tone)}>{meta?.label ?? m.movement_type}</td>
                <td className={cn("py-1 text-right tabular-nums", m.qty_delta < 0 ? "text-red-500" : "text-green-600")}>
                  {m.qty_delta > 0 ? "+" : ""}{m.qty_delta}
                </td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">{formatCurrency(m.unit_cost)}</td>
                <td className="py-1 text-right tabular-nums">{formatCurrency(m.value_delta)}</td>
                <td className="py-1 pl-3 text-muted-foreground truncate max-w-[160px]">{m.notes ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function InventoryPage() {
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const { data: levels = [], isLoading } = useInventoryLevels(selectedRestaurantId);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const isAll = !selectedRestaurantId;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return levels
      .filter((l) => l.food_cost_item && (!q || l.food_cost_item.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.food_cost_item?.name ?? "").localeCompare(b.food_cost_item?.name ?? ""));
  }, [levels, search]);

  const totalValue = rows.reduce((s, r) => s + (r.total_value ?? 0), 0);
  const negativeCount = rows.filter((r) => r.qty_on_hand < 0).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Inventory</h2>
          <span className="text-sm text-muted-foreground">— {restaurant?.name ?? "All Restaurants"}</span>
        </div>
      </div>

      {isAll && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Showing on-hand across all venues. Select a restaurant to see a single venue and its movement history.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Stock on Hand (value)</p>
          <p className="text-xl font-bold tabular-nums text-foreground">{formatCurrency(totalValue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Tracked Items</p>
          <p className="text-xl font-bold tabular-nums text-foreground">{rows.length}</p>
        </div>
        <div className={cn("rounded-xl border p-4", negativeCount > 0 ? "border-red-500/40 bg-red-500/5" : "border-border bg-card")}>
          <div className="flex items-center gap-1.5 mb-1">
            {negativeCount > 0 && <AlertTriangle className="h-3 w-3 text-red-500" />}
            <p className="text-xs text-muted-foreground">Negative on Hand</p>
          </div>
          <p className={cn("text-xl font-bold tabular-nums", negativeCount > 0 ? "text-red-500" : "text-foreground")}>
            {negativeCount}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Levels table */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PackageOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No stock on hand yet. It appears once you seed opening balances (a stock count),
            enter invoices, or record movements.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* header row */}
          <div className="hidden sm:grid grid-cols-[1fr_110px_110px_120px_32px] gap-2 px-4 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
            <span>Item</span>
            <span className="text-right">On Hand</span>
            <span className="text-right">Avg Cost</span>
            <span className="text-right">Value</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {rows.map((l) => {
              const item = l.food_cost_item;
              const neg = l.qty_on_hand < 0;
              const isOpen = expanded === l.food_cost_item_id;
              return (
                <div key={l.food_cost_item_id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : l.food_cost_item_id)}
                    className="w-full grid grid-cols-[1fr_110px_110px_120px_32px] gap-2 px-4 py-2.5 items-center text-left hover:bg-accent/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item?.name}</p>
                      <p className="text-xs text-muted-foreground">{item?.category}</p>
                    </div>
                    <span className={cn("text-right text-sm tabular-nums font-semibold", neg && "text-red-500")}>
                      {neg && <AlertTriangle className="inline h-3 w-3 mr-1 -mt-0.5" />}
                      {l.qty_on_hand} {item?.unit}
                    </span>
                    <span className="text-right text-sm tabular-nums text-muted-foreground">
                      {formatCurrency(l.avg_cost)}
                    </span>
                    <span className={cn("text-right text-sm tabular-nums font-semibold", neg && "text-red-500")}>
                      {formatCurrency(l.total_value)}
                    </span>
                    <span className="flex justify-end text-muted-foreground">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                  {isOpen && <ItemMovements restaurantId={selectedRestaurantId} itemId={l.food_cost_item_id} />}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground">{rows.length} items</p>
            <p className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(totalValue)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
