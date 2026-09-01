import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Calendar, Search, ShoppingBasket, TrendingUp, Layers, Trophy,
  ArrowUpDown,
} from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";
import { useRestaurantScope } from "@/hooks/useRestaurantScope";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MixRow {
  restaurant_id: string;
  business_date: string;
  level: "category" | "product";
  item_name: string;
  category_name: string | null;
  quantity: number | null;
  sales_amount: number | null;
  cost_amount: number | null;
  gross_profit_pct: number | null;
}

/** One item aggregated across the selected venues and dates. */
interface Agg {
  name: string;
  category: string | null;
  qty: number;
  sales: number;
  cost: number;
  hasCost: boolean;
}

type SortKey = "sales" | "qty" | "gp" | "name";
type Level = "product" | "category";

const PRESETS = [
  { label: "Yesterday", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * PostgREST caps a response at 1000 rows. A month of product mix across two
 * venues is comfortably more than that, so page until a short page comes back.
 */
async function fetchMix(ids: string[], from: string, to: string): Promise<MixRow[]> {
  const PAGE = 1000;
  const out: MixRow[] = [];
  for (let page = 0; page < 40; page++) {
    const { data, error } = await supabase
      .from("sales_mix_daily")
      .select("restaurant_id, business_date, level, item_name, category_name, quantity, sales_amount, cost_amount, gross_profit_pct")
      .in("restaurant_id", ids)
      .gte("business_date", from)
      .lte("business_date", to)
      .order("sales_amount", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as MixRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function aggregate(rows: MixRow[], level: Level): Agg[] {
  const map = new Map<string, Agg>();
  for (const r of rows) {
    if (r.level !== level) continue;
    const key = r.item_name.trim();
    if (!key) continue;
    const a = map.get(key) ?? {
      name: key, category: r.category_name, qty: 0, sales: 0, cost: 0, hasCost: false,
    };
    a.qty += r.quantity ?? 0;
    a.sales += r.sales_amount ?? 0;
    if (r.cost_amount != null) { a.cost += r.cost_amount; a.hasCost = true; }
    if (!a.category && r.category_name) a.category = r.category_name;
    map.set(key, a);
  }
  return [...map.values()];
}

function gpPct(a: Agg): number | null {
  if (!a.hasCost || a.sales <= 0) return null;
  return ((a.sales - a.cost) / a.sales) * 100;
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function SalesMixReport() {
  const [preset, setPreset] = useState<number>(7);
  const [from, setFrom] = useState(() => format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(subDays(new Date(), 1), "yyyy-MM-dd"));
  const [level, setLevel] = useState<Level>("product");
  const [sort, setSort] = useState<SortKey>("sales");
  const [search, setSearch] = useState("");

  const scope = useRestaurantScope();

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["sales-mix", from, to, scope.key],
    queryFn: () => fetchMix(scope.ids, from, to),
    enabled: scope.ids.length > 0,
    staleTime: 1000 * 60 * 10, // the mix only changes once a night
  });

  function applyPreset(days: number) {
    setPreset(days);
    setTo(format(subDays(new Date(), 1), "yyyy-MM-dd"));
    setFrom(format(subDays(new Date(), days), "yyyy-MM-dd"));
  }

  const items = useMemo(() => aggregate(rows ?? [], level), [rows, level]);
  const categories = useMemo(() => aggregate(rows ?? [], "category"), [rows]);

  const totals = useMemo(() => {
    const sales = items.reduce((s, i) => s + i.sales, 0);
    const qty = items.reduce((s, i) => s + i.qty, 0);
    const top = [...items].sort((a, b) => b.sales - a.sales)[0] ?? null;
    return { sales, qty, count: items.length, top };
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q))
      : items;
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "qty") return b.qty - a.qty;
      if (sort === "gp") return (gpPct(b) ?? -1) - (gpPct(a) ?? -1);
      return b.sales - a.sales;
    });
    return sorted;
  }, [items, search, sort]);

  const chartData = useMemo(
    () => [...categories].sort((a, b) => b.sales - a.sales).slice(0, 10)
      .map((c) => ({ name: c.name, sales: Math.round(c.sales) })),
    [categories]
  );

  const hasData = (rows ?? []).length > 0;
  const dayCount = useMemo(() => {
    const seen = new Set((rows ?? []).map((r) => r.business_date));
    return seen.size;
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-card p-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.days)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                preset === p.days
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => { setFrom(e.target.value); setPreset(-1); }}
            className="bg-transparent text-sm font-medium text-foreground outline-none"
          />
          <span className="text-muted-foreground text-sm">→</span>
          <input
            type="date"
            value={to}
            min={from}
            max={format(new Date(), "yyyy-MM-dd")}
            onChange={(e) => { setTo(e.target.value); setPreset(-1); }}
            className="bg-transparent text-sm font-medium text-foreground outline-none"
          />
        </div>

        <div className="flex rounded-lg border border-border bg-card p-1">
          {(["product", "category"] as Level[]).map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                level === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {l === "product" ? "Products" : "Categories"}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={level === "product" ? "Find a product…" : "Find a category…"}
            className="w-40 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive-soft p-6">
          <h3 className="text-base font-semibold text-destructive mb-1">Couldn’t load the sales mix</h3>
          <p className="text-sm text-muted-foreground">
            {(error as Error).message}
            {/sales_mix_daily/.test((error as Error).message) &&
              " — migration 072_sales_mix_daily.sql hasn’t been applied to this database yet."}
          </p>
        </div>
      )}

      {!isLoading && !error && !hasData && (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center text-center">
          <ShoppingBasket className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-base font-semibold mb-2">No sales mix for this range</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            The Sales Mix sync reads the full product report from Lightspeed Insights at
            4:35 AM each morning for the day before. Nothing has been recorded between{" "}
            {format(parseISO(from), "d MMM")} and {format(parseISO(to), "d MMM")} yet — you can
            backfill with <code className="font-mono text-xs">node sync.mjs --backfill {from}</code>.
          </p>
        </div>
      )}

      {!isLoading && !error && hasData && (
        <>
          {/* ── KPI cards ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<TrendingUp className="h-4 w-4" />}
              label={level === "product" ? "Product sales" : "Category sales"}
              value={formatCurrency(totals.sales)}
              sub={`${dayCount} day${dayCount === 1 ? "" : "s"}`}
              accent="text-primary" bg="bg-primary/10"
            />
            <KpiCard
              icon={<ShoppingBasket className="h-4 w-4" />}
              label="Items sold"
              value={totals.qty.toLocaleString("en-AU")}
              accent="text-success" bg="bg-success/10"
            />
            <KpiCard
              icon={<Layers className="h-4 w-4" />}
              label={level === "product" ? "Distinct products" : "Categories"}
              value={String(totals.count)}
              accent="text-warning" bg="bg-warning/10"
            />
            <KpiCard
              icon={<Trophy className="h-4 w-4" />}
              label="Top seller"
              value={totals.top?.name ?? "—"}
              sub={totals.top ? formatCurrency(totals.top.sales) : undefined}
              accent="text-primary" bg="bg-primary/10"
              tight
            />
          </div>

          {/* ── Category mix ────────────────────────────────────────────── */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Top categories by sales
              </p>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                {format(parseISO(from), "d MMM")} – {format(parseISO(to), "d MMM yyyy")}
                {scope.ids.length > 1 && ` · ${scope.ids.length} venues`}
              </p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false} axisLine={false}
                    />
                    <YAxis
                      type="category" dataKey="name" width={150}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false} axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--accent))" }}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8, fontSize: 12,
                      }}
                      formatter={(v) => [formatCurrency(Number(v) || 0), "Sales"] as [string, string]}
                    />
                    <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Item table ──────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium w-10">#</th>
                    <SortHeader label={level === "product" ? "Product" : "Category"} k="name" sort={sort} onSort={setSort} />
                    {level === "product" && <th className="px-4 py-3 font-medium">Category</th>}
                    <SortHeader label="Qty" k="qty" sort={sort} onSort={setSort} right />
                    <SortHeader label="Sales" k="sales" sort={sort} onSort={setSort} right />
                    <th className="px-4 py-3 font-medium text-right">% of sales</th>
                    <th className="px-4 py-3 font-medium text-right">Avg price</th>
                    <SortHeader label="GP %" k="gp" sort={sort} onSort={setSort} right />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((i, idx) => {
                    const gp = gpPct(i);
                    return (
                      <tr key={i.name} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{idx + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">{i.name}</td>
                        {level === "product" && (
                          <td className="px-4 py-2.5 text-muted-foreground">{i.category ?? "—"}</td>
                        )}
                        <td className="px-4 py-2.5 text-right tabular-nums">{i.qty.toLocaleString("en-AU")}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(i.sales)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {totals.sales > 0 ? `${((i.sales / totals.sales) * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {i.qty > 0 ? formatCurrency(i.sales / i.qty) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {gp == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={gp >= 60 ? "text-success" : gp >= 40 ? "text-foreground" : "text-warning"}>
                              {gp.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {visible.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing matches “{search}”.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function SortHeader({
  label, k, sort, onSort, right,
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  return (
    <th className={cn("px-4 py-3 font-medium", right && "text-right")}>
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground",
          sort === k ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

function KpiCard({
  icon, label, value, sub, accent, bg, tight,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  bg: string;
  tight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn("rounded-lg p-1.5", bg, accent)}>{icon}</span>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className={cn("mt-2 font-semibold text-foreground", tight ? "text-base leading-snug" : "text-xl")}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
