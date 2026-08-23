import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, addDays, subDays } from "date-fns";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  DollarSign,
  Truck,
  Users,
  Clock,
  Gauge,
  Loader2,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { usePulseHours, type PulseHour } from "@/hooks/usePulseHours";
import { useRestaurantScope } from "@/hooks/useRestaurantScope";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useTargets, TARGET_METRICS } from "@/hooks/useTargets";
import { triggerRefresh, refreshErrorMessage } from "@/lib/refresh";

/**
 * Pulse — today, hour by hour, live.
 *
 * Sits directly under the Dashboard: the Dashboard answers "how did we do",
 * Pulse answers "how are we doing right now, and is the labour on the floor
 * earning its keep this hour". Every column and where it comes from is
 * documented in `hooks/usePulseHours.ts`.
 */

const todayISO = () => format(new Date(), "yyyy-MM-dd");

// ── Money / number formatting ─────────────────────────────────────────────────
const money = (n: number) => formatCurrency(n);
const moneyExact = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
const hrs = (n: number) => `${n.toFixed(1)}h`;
const spmhFmt = (n: number | null) => (n == null ? "—" : `$${n.toFixed(0)}`);

// ── KPI card ──────────────────────────────────────────────────────────────────
function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "green" | "amber" | "red";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="eyebrow">{label}</span>
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums",
          tone === "green" && "text-success",
          tone === "amber" && "text-warning",
          tone === "red" && "text-destructive",
          tone === "default" && "text-foreground"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Variance cell ─────────────────────────────────────────────────────────────
// Net sales against the projection for the same stretch of time. The hour in
// progress is measured against the elapsed slice of its projection (see the
// hook), so a good hour doesn't read red just because it isn't over yet.
function VarianceCell({
  value,
  pct,
  className,
}: {
  value: number | null;
  pct: number | null;
  className?: string;
}) {
  const blank = value == null || (value === 0 && pct == null);
  if (blank) {
    return <td className={cn("tnum px-4 py-2 text-right text-muted-foreground", className)}>—</td>;
  }
  const v = value as number;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return (
    <td
      className={cn(
        "tnum px-4 py-2 text-right font-medium",
        v > 0 && "text-success",
        v < 0 && "text-destructive",
        v === 0 && "text-muted-foreground",
        className
      )}
    >
      {sign}
      {money(Math.abs(v))}
      {pct != null && (
        <span className="ml-1 text-[11px] font-normal opacity-75">
          {sign}
          {Math.abs(pct).toFixed(0)}%
        </span>
      )}
    </td>
  );
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function PulseTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: PulseHour }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-popover">
      <p className="font-semibold text-popover-foreground">{label}</p>
      <dl className="mt-1 space-y-0.5 text-muted-foreground">
        <div className="flex gap-3">
          <dt className="w-24">Projected</dt>
          <dd className="tnum font-medium text-foreground">{moneyExact(row.projected)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-24">Gross sales</dt>
          <dd className="tnum font-medium text-foreground">{moneyExact(row.grossSales)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-24">Net sales</dt>
          <dd className="tnum font-medium text-foreground">{moneyExact(row.netSales)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-24">Variance</dt>
          <dd
            className={cn(
              "tnum font-medium",
              row.variance == null
                ? "text-foreground"
                : row.variance >= 0
                ? "text-success"
                : "text-destructive"
            )}
          >
            {row.variance == null ? "—" : `${row.variance >= 0 ? "+" : "−"}${moneyExact(Math.abs(row.variance))}`}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-24">Delivery</dt>
          <dd className="tnum font-medium text-foreground">{moneyExact(row.delivery)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-24">Labour</dt>
          <dd className="tnum font-medium text-foreground">
            {moneyExact(row.labourCost)} · {hrs(row.labourHours)}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-24">SPMH</dt>
          <dd className="tnum font-medium text-foreground">{spmhFmt(row.spmh)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Labour {row.labourSource === "actual" ? "actual (clocked)" : "rostered"}
        {row.isCurrent && " · hour in progress"}
      </p>
    </div>
  );
}

export default function PulsePage() {
  const queryClient = useQueryClient();
  const scope = useRestaurantScope();
  const { data: restaurants = [] } = useRestaurants();
  const [date, setDate] = useState(todayISO);
  const [refreshing, setRefreshing] = useState(false);
  // Trading hours (open→close, widened by any hour with data) or a literal 24h.
  const [fullDay, setFullDay] = useState(false);

  const pulse = usePulseHours(date, scope.ids, { fullDay });
  const isToday = date === todayISO();

  // SPMH target — only meaningful for a single venue (it's a per-store setting).
  const { targets } = useTargets(scope.isSingle ? scope.singleId : null);
  const spmhTarget = useMemo(() => {
    const t = targets.find((x) => x.metric === TARGET_METRICS.SPMH);
    return t?.value ?? null;
  }, [targets]);

  // Live: pull fresh data every minute while looking at today.
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => {
      queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("pulse-"),
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [isToday, queryClient]);

  async function handleRefresh() {
    setRefreshing(true);
    // Both feeds at once — the sales-by-hour scrape and the Uber orders scrape
    // drive different sites, so there's nothing to be gained by queuing them.
    const [sales, delivery] = await Promise.all([
      triggerRefresh("salesfeed"),
      triggerRefresh("delivery"),
    ]);
    if (sales.ok && delivery.ok) toast.success("Sales and delivery refreshed");
    else if (sales.ok) toast.warning(`Sales refreshed. Delivery: ${refreshErrorMessage(delivery)}`);
    else if (delivery.ok) toast.warning(`Delivery refreshed. Sales: ${refreshErrorMessage(sales)}`);
    else toast.error(refreshErrorMessage(sales));
    await queryClient.invalidateQueries({
      predicate: (q) => String(q.queryKey[0]).startsWith("pulse-"),
    });
    setRefreshing(false);
  }

  const scopeLabel = scope.isAll
    ? "All venues"
    : restaurants
        .filter((r) => scope.ids.includes(r.id))
        .map((r) => r.name)
        .join(" + ");

  const t = pulse.soFar;
  const dayProjection = pulse.projectedDay;
  const vsProjected =
    t.projected > 0 ? ((t.netSales - t.projected) / t.projected) * 100 : null;

  return (
    <div className="space-y-4">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-success" />
          <h1 className="text-xl font-semibold text-foreground">Pulse</h1>
          {isToday && (
            <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Live
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setDate(format(subDays(parseISO(date), 1), "yyyy-MM-dd"))}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-border-strong bg-card px-2.5 py-1.5 text-sm text-foreground"
          />
          <button
            onClick={() => setDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"))}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isToday && (
            <button
              onClick={() => setDate(todayISO())}
              className="ml-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              Today
            </button>
          )}
        </div>

        <span className="text-sm text-muted-foreground">
          {format(parseISO(date), "EEEE d MMMM")} · {scopeLabel}
        </span>

        <div className="ml-auto flex items-center rounded-lg border border-border p-0.5">
          {([
            { key: false, label: "Trading hours" },
            { key: true, label: "24h" },
          ] as const).map((opt) => (
            <button
              key={String(opt.key)}
              onClick={() => setFullDay(opt.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                fullDay === opt.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className={cn("h-3.5 w-3.5", pulse.isFetching && "animate-spin")} />
          )}
          Refresh now
        </button>
      </div>

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          icon={DollarSign}
          label="Net sales"
          value={money(t.netSales)}
          sub={
            vsProjected == null
              ? `Day projection ${dayProjection > 0 ? money(dayProjection) : "—"}`
              : `${vsProjected >= 0 ? "+" : ""}${vsProjected.toFixed(0)}% vs projected so far`
          }
          tone={vsProjected == null ? "default" : vsProjected >= 0 ? "green" : "red"}
        />
        <Kpi
          icon={Truck}
          label="Delivery"
          value={money(t.delivery)}
          sub={
            pulse.deliveryTableMissing
              ? "No delivery feed yet"
              : t.netSales > 0
              ? `${((t.delivery / t.netSales) * 100).toFixed(0)}% of sales`
              : undefined
          }
        />
        <Kpi
          icon={Users}
          label="Labour cost"
          value={money(t.labourCost)}
          sub={t.labourPct == null ? undefined : `${t.labourPct.toFixed(1)}% of sales`}
          tone={t.labourPct == null ? "default" : t.labourPct <= 30 ? "green" : t.labourPct <= 35 ? "amber" : "red"}
        />
        <Kpi icon={Clock} label="Labour hours" value={hrs(t.labourHours)} sub={`${pulse.labourBasis} basis`} />
        <Kpi
          icon={Gauge}
          label="SPMH"
          value={spmhFmt(t.spmh)}
          sub={spmhTarget ? `Target $${spmhTarget.toFixed(0)}` : "No target set"}
          tone={
            t.spmh == null || !spmhTarget
              ? "default"
              : t.spmh >= spmhTarget
              ? "green"
              : t.spmh >= spmhTarget * 0.9
              ? "amber"
              : "red"
          }
        />
      </div>

      {/* ── Chart ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Hour by hour</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Bars: net sales, with delivery beside it. Dashed: projected. Line: SPMH (right axis).
        </p>
        <div className="mt-3 h-[320px]">
          {pulse.isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pulse.hours} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="money"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${Math.round(v)}`}
                  width={56}
                />
                <YAxis
                  yAxisId="spmh"
                  orientation="right"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${Math.round(v)}`}
                  width={48}
                />
                <Tooltip content={<PulseTooltip />} cursor={{ fill: "hsl(var(--surface-sunken))" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {/* Side by side, not stacked: delivery is a SLICE of net sales,
                    so stacking it on top would read as a bigger hour than it was. */}
                <Bar
                  yAxisId="money"
                  dataKey="netSales"
                  name="Net sales"
                  fill="hsl(var(--primary))"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  yAxisId="money"
                  dataKey="delivery"
                  name="Delivery"
                  fill="hsl(var(--info))"
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="money"
                  type="monotone"
                  dataKey="projected"
                  name="Projected"
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 3"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="spmh"
                  type="monotone"
                  dataKey="spmh"
                  name="SPMH"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                {pulse.isToday && pulse.nowHour != null && (
                  <ReferenceLine
                    yAxisId="money"
                    x={pulse.hours.find((h) => h.hour === pulse.nowHour)?.label}
                    stroke="hsl(var(--warning))"
                    strokeDasharray="2 2"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-left">
                <th className="eyebrow px-4 py-2.5 text-muted-foreground">Time</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">Projected sales</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">Gross sales</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">Net sales</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">Variance</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">Delivery sales</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">Labour cost</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">Labour hours</th>
                <th className="eyebrow px-4 py-2.5 text-right text-muted-foreground">SPMH</th>
              </tr>
            </thead>
            <tbody>
              {pulse.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!pulse.isLoading &&
                pulse.hours.map((r) => {
                  const behind = r.projected > 0 && !r.isFuture && r.netSales < r.projected * 0.9;
                  return (
                    <tr
                      key={r.hour}
                      className={cn(
                        "border-b border-border last:border-0",
                        r.isCurrent && "bg-warning-soft",
                        r.isFuture && "text-muted-foreground"
                      )}
                    >
                      <td className="px-4 py-2 font-medium">
                        <span className="flex items-center gap-1.5">
                          {r.label}
                          {r.labourSource === "rostered" && r.labourHours > 0 && (
                            <span
                              className="rounded-md bg-surface-sunken px-1 text-[10px] font-semibold uppercase text-muted-foreground"
                              title="Labour from the roster (hour not finished / no punches)"
                            >
                              R
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="tnum px-4 py-2 text-right text-muted-foreground">
                        {r.projected > 0 ? money(r.projected) : "—"}
                      </td>
                      <td className="tnum px-4 py-2 text-right">
                        {r.grossSales > 0 ? money(r.grossSales) : "—"}
                      </td>
                      <td
                        className={cn(
                          "tnum px-4 py-2 text-right font-semibold",
                          behind && "text-destructive",
                          !behind && !r.isFuture && r.netSales > 0 && "text-foreground"
                        )}
                      >
                        {r.isFuture && r.netSales === 0 ? "—" : money(r.netSales)}
                      </td>
                      <VarianceCell value={r.variance} pct={r.variancePct} />
                      <td className="tnum px-4 py-2 text-right">
                        {r.delivery > 0 ? money(r.delivery) : "—"}
                      </td>
                      <td className="tnum px-4 py-2 text-right">
                        {r.labourCost > 0 ? money(r.labourCost) : "—"}
                      </td>
                      <td className="tnum px-4 py-2 text-right">
                        {r.labourHours > 0 ? hrs(r.labourHours) : "—"}
                      </td>
                      <td
                        className={cn(
                          "tnum px-4 py-2 text-right font-semibold",
                          r.spmh != null && spmhTarget
                            ? r.spmh >= spmhTarget
                              ? "text-success"
                              : r.spmh >= spmhTarget * 0.9
                              ? "text-warning"
                              : "text-destructive"
                            : ""
                        )}
                      >
                        {spmhFmt(r.spmh)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {!pulse.isLoading && pulse.hours.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-surface-subtle font-semibold">
                  <td className="px-4 py-2.5">Day total</td>
                  <td className="tnum px-4 py-2.5 text-right">{money(pulse.totals.projected)}</td>
                  <td className="tnum px-4 py-2.5 text-right">{money(pulse.totals.grossSales)}</td>
                  <td className="tnum px-4 py-2.5 text-right">{money(pulse.totals.netSales)}</td>
                  <VarianceCell
                    value={pulse.totals.variance}
                    pct={pulse.totals.variancePct}
                    className="py-2.5 font-semibold"
                  />
                  <td className="tnum px-4 py-2.5 text-right">{money(pulse.totals.delivery)}</td>
                  <td className="tnum px-4 py-2.5 text-right">{money(pulse.totals.labourCost)}</td>
                  <td className="tnum px-4 py-2.5 text-right">{hrs(pulse.totals.labourHours)}</td>
                  <td className="tnum px-4 py-2.5 text-right">{spmhFmt(pulse.totals.spmh)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Footnotes: say where each number came from ───────────────────── */}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Labour is <strong>actual clocked time</strong> for hours that have finished and the{" "}
          <strong>roster</strong> (marked R) for the rest of the day, costed at the MA000003 rate for
          each person and that hour's penalty.
        </p>
        <p>
          Variance is net sales against the projection for the same stretch of time — the hour in
          progress counts only the minutes elapsed. The <strong>Day total</strong> variance compares
          the whole day's sales to the whole day's projection, so it runs negative until the day is
          done; the Net sales card above tracks "so far".
        </p>
        {!pulse.hasProjection && (
          <p>
            No projection entered for this day — add one under Admin → Projections to see the
            projected column.
          </p>
        )}
        {pulse.hasProjection && pulse.projectionEstimated && (
          <p>
            Projected hours are shaped from an average curve (no matching weekday in the last 12
            weeks of sales history).
          </p>
        )}
        {pulse.deliveryTableMissing && (
          <p>
            Delivery sales are empty: apply migration <code>068_delivery_orders.sql</code> and point
            the hourly delivery scraper at <code>delivery_orders</code>.
          </p>
        )}
      </div>
    </div>
  );
}
