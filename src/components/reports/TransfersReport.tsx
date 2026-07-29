import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, subDays, subMonths } from "date-fns";
import { ArrowLeftRight, ArrowRight, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency } from "@/lib/utils";
import type { StockTransfer } from "@/types";

type Preset = "thisMonth" | "last30" | "last3m" | "last12m";
const PRESETS: { label: string; value: Preset }[] = [
  { label: "This Month", value: "thisMonth" },
  { label: "Last 30 Days", value: "last30" },
  { label: "Last 3 Months", value: "last3m" },
  { label: "Last 12 Months", value: "last12m" },
];
const fmt = (d: Date) => format(d, "yyyy-MM-dd");
function getRange(p: Preset) {
  const today = new Date();
  switch (p) {
    case "thisMonth": return { from: fmt(startOfMonth(today)), to: fmt(today) };
    case "last30": return { from: fmt(subDays(today, 29)), to: fmt(today) };
    case "last3m": return { from: fmt(subMonths(today, 3)), to: fmt(today) };
    case "last12m": return { from: fmt(subMonths(today, 12)), to: fmt(today) };
  }
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  in_transit: { label: "In transit", cls: "bg-amber-500/10 text-amber-600" },
  received: { label: "Received", cls: "bg-green-500/10 text-green-600" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
};

function lineValue(t: StockTransfer) {
  return (t.lines ?? []).reduce((s, l) => s + (l.qty_sent ?? 0) * (l.unit_cost ?? 0), 0);
}

export default function TransfersReport() {
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const { selectedRestaurantIds } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const range = getRange(preset);
  const scopeKey = selectedRestaurantIds.join(",") || "all";

  const { data: transfers = [], isLoading } = useQuery<StockTransfer[]>({
    queryKey: ["transfers-report", scopeKey, range.from, range.to],
    queryFn: async () => {
      let q = supabase
        .from("stock_transfers")
        .select(
          `*,
           from_restaurant:restaurants!from_restaurant_id(id, name),
           to_restaurant:restaurants!to_restaurant_id(id, name),
           lines:stock_transfer_lines(*, food_cost_item:food_cost_items(id, name, unit))`
        )
        .gte("sent_at", range.from)
        .lte("sent_at", range.to + "T23:59:59")
        .order("sent_at", { ascending: false });
      if (selectedRestaurantIds.length) {
        const list = selectedRestaurantIds.join(",");
        q = q.or(`from_restaurant_id.in.(${list}),to_restaurant_id.in.(${list})`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as StockTransfer[];
    },
  });

  // Per-venue in/out cost (only non-cancelled transfers count as cost movement).
  const perVenue = useMemo(() => {
    const map: Record<string, { name: string; inVal: number; outVal: number }> = {};
    for (const r of restaurants) map[r.id] = { name: r.name, inVal: 0, outVal: 0 };
    for (const t of transfers) {
      if (t.status === "cancelled") continue;
      const v = lineValue(t);
      if (map[t.from_restaurant_id]) map[t.from_restaurant_id].outVal += v;
      if (map[t.to_restaurant_id]) map[t.to_restaurant_id].inVal += v;
    }
    return Object.values(map).filter((x) => x.inVal > 0 || x.outVal > 0);
  }, [transfers, restaurants]);

  const totalValue = transfers.filter((t) => t.status !== "cancelled").reduce((s, t) => s + lineValue(t), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Transfers</h2>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                preset === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Transfers</p>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {transfers.filter((t) => t.status !== "cancelled").length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Value Moved</p>
          <p className="text-xl font-bold tabular-nums text-foreground">{formatCurrency(totalValue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">In Transit</p>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {transfers.filter((t) => t.status === "in_transit").length}
          </p>
        </div>
      </div>

      {/* Per-venue net cost movement */}
      {perVenue.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[1fr_110px_110px_110px] gap-2 px-4 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
            <span>Venue</span>
            <span className="text-right">Cost In</span>
            <span className="text-right">Cost Out</span>
            <span className="text-right">Net</span>
          </div>
          <div className="divide-y divide-border">
            {perVenue.map((v) => {
              const net = v.inVal - v.outVal;
              return (
                <div key={v.name} className="grid grid-cols-[1fr_110px_110px_110px] gap-2 px-4 py-2.5 items-center">
                  <span className="text-sm font-medium text-foreground">{v.name}</span>
                  <span className="text-right text-sm tabular-nums text-green-600">
                    <ArrowDownLeft className="inline h-3 w-3 mr-0.5" />{formatCurrency(v.inVal)}
                  </span>
                  <span className="text-right text-sm tabular-nums text-amber-600">
                    <ArrowUpRight className="inline h-3 w-3 mr-0.5" />{formatCurrency(v.outVal)}
                  </span>
                  <span className={cn("text-right text-sm tabular-nums font-semibold", net >= 0 ? "text-green-600" : "text-amber-600")}>
                    {net >= 0 ? "+" : ""}{formatCurrency(net)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transfer list */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : transfers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No transfers in this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transfers.map((t) => {
            const meta = STATUS_META[t.status];
            return (
              <div key={t.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="font-medium text-foreground">{t.from_restaurant?.name}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground">{t.to_restaurant?.name}</span>
                  <span className={cn("ml-1 text-xs px-2 py-0.5 rounded-full", meta?.cls)}>{meta?.label}</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground ml-auto">{formatCurrency(lineValue(t))}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {(t.lines ?? []).map((l) => `${l.food_cost_item?.name} ${l.qty_sent}${l.food_cost_item?.unit ?? ""}`).join(" · ")}
                  </p>
                  <span className="text-xs text-muted-foreground">{format(parseISO(t.sent_at), "d MMM yyyy")}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
