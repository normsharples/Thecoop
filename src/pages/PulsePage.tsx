import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, addDays, subDays } from "date-fns";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
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
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="eyebrow truncate">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1.5 text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl",
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

// ── Mobile hour card (replaces the table row on small screens) ───────────────
function MobileHourCard({ row: r, spmhTarget }: { row: PulseHour; spmhTarget: number | null }) {
  const [open, setOpen] = useState(false);
  const behind = r.projected > 0 && !r.isFuture && r.netSales < r.projected * 0.9;
  const varianceSign = r.variance != null ? (r.variance > 0 ? "+" : r.variance < 0 ? "−" : "") : "";

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        r.isCurrent && "ring-1 ring-warning border-warning/40"
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left",
          r.isFuture && "opacity-50"
        )}
      >
        {/* Time */}
        <span className="w-16 shrink-0 text-sm font-semibold text-foreground">
          {r.label}
          {r.labourSource === "rostered" && r.labourHours > 0 && (
            <span className="ml-1 text-[9px] font-semibold text-muted-foreground">R</span>
          )}
        </span>
        {/* Net sales */}
        <span className={cn(
          "flex-1 text-right text-sm font-bold tabular-nums",
          behind ? "text-destructive" : r.netSales > 0 ? "text-foreground" : "text-muted-foreground"
        )}>
          {r.isFuture && r.netSales === 0 ? "—" : money(r.netSales)}
        </span>
        {/* Variance badge */}
        {r.variance != null && r.variance !== 0 && (
          <span className={cn(
            "min-w-[52px] rounded-md px-1.5 py-0.5 text-right text-[11px] font-semibold tabular-nums",
            r.variance > 0 ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive"
          )}>
            {varianceSign}{money(Math.abs(r.variance))}
          </span>
        )}
        {/* SPMH */}
        <span className={cn(
          "w-10 text-right text-xs font-semibold tabular-nums",
          r.spmh != null && spmhTarget
            ? r.spmh >= spmhTarget ? "text-success" : r.spmh >= spmhTarget * 0.9 ? "text-warning" : "text-destructive"
            : "text-muted-foreground"
        )}>
          {spmhFmt(r.spmh)}
        </span>
        {/* Chevron */}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className={cn(
          "border-t border-border px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs",
          r.isCurrent && "bg-warning-soft/50"
        )}>
          <div className="flex justify-between"><span className="text-muted-foreground">Projected</span><span className="tabular-nums font-medium">{r.projected > 0 ? money(r.projected) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Gross</span><span className="tabular-nums font-medium">{r.grossSales > 0 ? money(r.grossSales) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span className="tabular-nums font-medium">{r.delivery > 0 ? money(r.delivery) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Labour cost</span><span className="tabular-nums font-medium">{r.labourCost > 0 ? money(r.labourCost) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Labour hrs</span><span className="tabular-nums font-medium">{r.labourHours > 0 ? hrs(r.labourHours) : "—"}</span></div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Variance</span>
            <span className={cn(
              "tabular-nums font-medium",
              r.variance != null && r.variance > 0 && "text-success",
              r.variance != null && r.variance < 0 && "text-destructive"
            )}>
              {r.variance == null ? "—" : `${varianceSign}${money(Math.abs(r.variance))}${r.variancePct != null ? ` (${varianceSign}${Math.abs(r.variancePct).toFixed(0)}%)` : ""}`}
            </span>
          </div>
        </div>
      )}
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
      <div className="space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        {/* Title row */}
        <div className="flex items-center justify-between sm:justify-start sm:gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-success" />
            <h1 className="text-lg font-semibold text-foreground sm:text-xl">Pulse</h1>
            {isToday && (
              <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Live
              </span>
            )}
          </div>
          {/* Refresh — visible inline on mobile, moves to end on desktop */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60 sm:hidden"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className={cn("h-3.5 w-3.5", pulse.isFetching && "animate-spin")} />
            )}
          </button>
        </div>

        {/* Date nav + toggle row */}
        <div className="flex items-center gap-1.5 flex-wrap">
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
              className="rounded-lg border border-border-strong bg-card px-2 py-1.5 text-sm text-foreground"
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
                className="ml-0.5 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                Today
              </button>
            )}
          </div>

          <div className="flex items-center rounded-lg border border-border p-0.5">
            {([
              { key: false, label: "Trading" },
              { key: true, label: "24h" },
            ] as const).map((opt) => (
              <button
                key={String(opt.key)}
                onClick={() => setFullDay(opt.key)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  fullDay === opt.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <span className="hidden text-sm text-muted-foreground sm:inline">
          {format(parseISO(date), "EEEE d MMMM")} · {scopeLabel}
        </span>
        <p className="text-xs text-muted-foreground sm:hidden">
          {format(parseISO(date), "EEE d MMM")} · {scopeLabel}
        </p>

        {/* Desktop-only refresh button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="ml-auto hidden items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60 sm:flex"
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
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-foreground">Hour by hour</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Bars: net sales + delivery. Dashed: projected. Line: SPMH.
        </p>
        <div className="mt-3 h-[240px] sm:h-[320px]">
          {pulse.isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pulse.hours} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  angle={-45}
                  textAnchor="end"
                  height={40}
                />
                <YAxis
                  yAxisId="money"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${Math.round(v)}`}
                  width={44}
                />
                <YAxis
                  yAxisId="spmh"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${Math.round(v)}`}
                  width={36}
                />
                <Tooltip content={<PulseTooltip />} cursor={{ fill: "hsl(var(--surface-sunken))" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
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

      {/* ── Mobile card list (< md) ─────────────────────────────────────── */}
      <div className="space-y-2 md:hidden">
        {pulse.isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!pulse.isLoading && pulse.hours.map((r) => (
          <MobileHourCard key={r.hour} row={r} spmhTarget={spmhTarget} />
        ))}
        {!pulse.isLoading && pulse.hours.length > 0 && (
          <div className="rounded-xl border border-border bg-surface-subtle p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Day total</span>
              <span className="text-sm font-bold tabular-nums text-foreground">{money(pulse.totals.netSales)}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Projected</span><span className="tabular-nums font-medium">{money(pulse.totals.projected)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Gross</span><span className="tabular-nums font-medium">{money(pulse.totals.grossSales)}</span></div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Variance</span>
                <span className={cn("tabular-nums font-medium", pulse.totals.variance != null && pulse.totals.variance > 0 && "text-success", pulse.totals.variance != null && pulse.totals.variance < 0 && "text-destructive")}>
                  {pulse.totals.variance == null ? "—" : `${pulse.totals.variance >= 0 ? "+" : "−"}${money(Math.abs(pulse.totals.variance))}`}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span className="tabular-nums font-medium">{money(pulse.totals.delivery)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Labour</span><span className="tabular-nums font-medium">{money(pulse.totals.labourCost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Hours</span><span className="tabular-nums font-medium">{hrs(pulse.totals.labourHours)}</span></div>
              <div className="flex justify-between col-span-2"><span className="text-muted-foreground">SPMH</span><span className="tabular-nums font-semibold">{spmhFmt(pulse.totals.spmh)}</span></div>
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop table (≥ md) ──────────────────────────────────────── */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-border bg-card">
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
