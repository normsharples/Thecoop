import { Fragment, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { DAY_LABELS } from "@/lib/roster";
import { positionScope, type AreaLayout } from "@/lib/positions";
import {
  buildForecast,
  buildWeekForecast,
  type ForecastPoint,
} from "@/lib/rosterForecast";
import type { DayProjection } from "@/hooks/useSalesProjection";
import type { Shift, StaffingConfig, StaffingMatrixRow } from "@/types";

// Sales bars sit behind two hour lines that have to stay readable over them.
// Blue/orange is the safest CVD pair, and the lines carry distinct marker
// shapes as well as colour, so identity never rests on hue alone.
const SALES_FILL = "#60a5fa";
const IDEAL_STROKE = "#f97316";

/** Triangle marker for the ideal-hours line (matches the reference graph). */
function TriangleDot(props: { cx?: number; cy?: number }) {
  const { cx, cy } = props;
  if (cx == null || cy == null) return null;
  return (
    <polygon
      points={`${cx},${cy - 4.5} ${cx + 4.5},${cy + 3.5} ${cx - 4.5},${cy + 3.5}`}
      fill={IDEAL_STROKE}
    />
  );
}

interface ForecastTooltipProps {
  active?: boolean;
  payload?: { payload: ForecastPoint }[];
  label?: string;
}

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const gap = p.scheduled - p.ideal;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">
        {p.date ? format(parseISO(p.date), "EEE d MMM") : label}
      </p>
      <p className="mt-1 text-muted-foreground">
        Projected sales{" "}
        <span className="font-medium text-foreground">{formatCurrency(p.sales)}</span>
      </p>
      <p className="text-muted-foreground">
        Ideal <span className="font-medium text-foreground">{p.ideal.toFixed(1)} h</span> ·
        rostered <span className="font-medium text-foreground">{p.scheduled.toFixed(1)} h</span>
      </p>
      {Math.abs(gap) >= 0.05 && (
        <p className={gap > 0 ? "text-destructive" : "text-warning"}>
          {gap > 0 ? `${gap.toFixed(1)} h over` : `${Math.abs(gap).toFixed(1)} h under`}
        </p>
      )}
    </div>
  );
}

function LegendKey({
  shape,
  colour,
  label,
}: {
  shape: "triangle" | "circle" | "square";
  colour: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <svg width="12" height="12" aria-hidden="true">
        {shape === "triangle" && <polygon points="6,1 11,10 1,10" fill={colour} />}
        {shape === "circle" && <circle cx="6" cy="6" r="4.5" fill={colour} />}
        {shape === "square" && <rect x="1.5" y="2" width="9" height="8" rx="1" fill={colour} />}
      </svg>
      {label}
    </span>
  );
}

/**
 * Forecast graph: projected sales (bars) against the labour hours the staffing
 * matrix asks for (ideal) and the hours actually rostered.
 *
 * `scope: "day"` plots the selected day hour by hour; `scope: "week"` plots the
 * seven days. Both roll up from the same per-hour engine, so a week bar is
 * always exactly what its day graph totals.
 */
export default function ForecastGraph({
  scope,
  date,
  days,
  shifts,
  matrix,
  config,
  detailByDate,
  projectedByDate,
  areaLayout,
  loading,
  onHide,
}: {
  scope: "day" | "week";
  /** The selected day (day scope). */
  date: string;
  /** The week's dates, Mon…Sun (week scope). */
  days: string[];
  /** Day scope: that day's shifts. Week scope: the whole week's. All areas — the graph filters. */
  shifts: Shift[];
  matrix: StaffingMatrixRow[];
  config: StaffingConfig | null;
  detailByDate: Map<string, DayProjection>;
  projectedByDate: Map<string, number[]>;
  areaLayout: AreaLayout;
  loading?: boolean;
  onHide: () => void;
}) {
  const [areaId, setAreaId] = useState("");

  const allPositions = useMemo(
    () => areaLayout.flatMap(({ area, subs }) => [area, ...subs]),
    [areaLayout]
  );
  const areaName = allPositions.find((p) => p.id === areaId)?.name ?? "All areas";

  const { points, totals, empty } = useMemo(() => {
    const scopeIds = areaId ? positionScope(areaId, allPositions) : null;
    const scoped = scopeIds
      ? shifts.filter((s) => s.position_id && scopeIds.has(s.position_id))
      : shifts;
    return scope === "week"
      ? buildWeekForecast({
          days,
          shifts: scoped,
          matrix,
          projectedByDate,
          config,
          positionIds: scopeIds,
          dayLabels: DAY_LABELS,
        })
      : buildForecast({
          shifts: scoped,
          matrix,
          hourlySales: detailByDate.get(date)?.hours ?? new Array(24).fill(0),
          config,
          positionIds: scopeIds,
        });
  }, [
    scope,
    shifts,
    matrix,
    detailByDate,
    projectedByDate,
    days,
    date,
    config,
    areaId,
    allPositions,
  ]);

  const gap = totals.scheduled - totals.ideal;

  const dayDetail = detailByDate.get(date);
  const projectedDays = scope === "week"
    ? days.filter((d) => detailByDate.get(d)?.hasProjection).length
    : 0;
  const hasProjection = scope === "week" ? projectedDays > 0 : !!dayDetail?.hasProjection;

  // Where the numbers came from. A graph nobody can source is a graph nobody
  // trusts, so say which reference day shaped the hours and flag the fallbacks.
  const shapeNote = (() => {
    if (scope === "week") {
      if (projectedDays === days.length) return null;
      return `${days.length - projectedDays} of ${days.length} days have no projection entered.`;
    }
    if (!dayDetail?.hasProjection) return null;
    if (dayDetail.evenSpread)
      return "No hourly history yet — sales spread evenly across opening hours.";
    if (dayDetail.estimated) return "No history for this weekday yet — shaped on the average day.";
    return dayDetail.shapeDate
      ? `Hourly shape from ${format(parseISO(dayDetail.shapeDate), "EEE d MMM")}.`
      : null;
  })();

  const subtitle =
    scope === "week"
      ? `${format(parseISO(days[0]), "d MMM")} – ${format(parseISO(days[6]), "d MMM")}`
      : format(parseISO(date), "EEEE d MMMM");

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Forecast graph ({areaName})
          </h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All areas</option>
            {areaLayout.map(({ area, subs }) => (
              <Fragment key={area.id}>
                <option value={area.id}>{area.name}</option>
                {subs.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    &nbsp;&nbsp;{sub.name}
                  </option>
                ))}
              </Fragment>
            ))}
          </select>
          <button
            onClick={onHide}
            title="Hide the forecast graph"
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Loading projected sales…
        </p>
      ) : !hasProjection && empty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No sales projection entered {scope === "week" ? "for this week" : "for this day"} — add
          one in Reports → Projections and the forecast will fill in.
        </p>
      ) : empty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing to plot for {areaName.toLowerCase()}.
        </p>
      ) : (
        <>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="hsl(var(--border))"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="sales"
                  tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`)}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <YAxis
                  yAxisId="hours"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  content={(props) => (
                    <ForecastTooltip {...(props as unknown as ForecastTooltipProps)} />
                  )}
                  cursor={{ fill: "hsl(var(--accent))" }}
                />
                <Bar
                  yAxisId="sales"
                  dataKey="sales"
                  fill={SALES_FILL}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={scope === "week" ? 44 : 26}
                />
                <Line
                  yAxisId="hours"
                  type="linear"
                  dataKey="ideal"
                  stroke={IDEAL_STROKE}
                  strokeWidth={2}
                  dot={<TriangleDot />}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="hours"
                  type="linear"
                  dataKey="scheduled"
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "hsl(var(--foreground))" }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
            <LegendKey shape="triangle" colour={IDEAL_STROKE} label="Ideal hours" />
            <LegendKey shape="circle" colour="hsl(var(--foreground))" label="Rostered hours" />
            <LegendKey shape="square" colour={SALES_FILL} label="Projected sales" />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            <span className="text-muted-foreground">
              Projected{" "}
              <span className="font-medium text-foreground">{formatCurrency(totals.sales)}</span>{" "}
              · ideal{" "}
              <span className="font-medium text-foreground">{totals.ideal.toFixed(1)} h</span> ·
              rostered{" "}
              <span className="font-medium text-foreground">{totals.scheduled.toFixed(1)} h</span>
              {Math.abs(gap) >= 0.05 && (
                <span className={gap > 0 ? " text-destructive" : " text-warning"}>
                  {" "}
                  ({gap > 0 ? "+" : ""}
                  {gap.toFixed(1)} h)
                </span>
              )}
            </span>
            {shapeNote && <span className="text-muted-foreground/80">{shapeNote}</span>}
          </div>
        </>
      )}
    </div>
  );
}
