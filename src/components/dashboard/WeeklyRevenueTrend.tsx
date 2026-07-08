import { useQuery } from "@tanstack/react-query";
import {
  format,
  subWeeks,
  startOfWeek,
  endOfWeek,
  parseISO,
  eachWeekOfInterval,
} from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";

function fmtK(value: number) {
  if (value === 0) return "$0";
  return `$${(value / 1000).toFixed(0)}k`;
}

function fmtFull(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface TooltipPayload {
  value: number;
  payload: { label: string; weekRange: string; total: number };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const { weekRange, total } = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground">{weekRange}</p>
      <p className="mt-0.5 text-muted-foreground">
        Net Sales:{" "}
        <span className="font-semibold text-foreground">{fmtFull(total)}</span>
      </p>
    </div>
  );
}

export function WeeklyRevenueTrend({ date }: { date?: string }) {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const anchor = date ? parseISO(date) : new Date();
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const weekStart12 = startOfWeek(subWeeks(anchor, 11), { weekStartsOn: 1 });

  const startStr = format(weekStart12, "yyyy-MM-dd");
  const endStr = format(weekEnd, "yyyy-MM-dd");

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : (restaurants?.map((r) => r.id) ?? []);

  const { data: salesData, isLoading } = useQuery({
    queryKey: ["weekly-revenue", startStr, endStr, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("sales_daily")
        .select("date, net_sales, total_sales")
        .in("restaurant_id", restaurantIds)
        .gte("date", startStr)
        .lte("date", endStr)
        .order("date");
      if (error) throw error;
      return data as { date: string; net_sales: number | null; total_sales: number }[];
    },
    enabled: !!restaurantIds.length,
    staleTime: 1000 * 60 * 5,
  });

  const weeks = eachWeekOfInterval(
    { start: weekStart12, end: weekEnd },
    { weekStartsOn: 1 }
  );

  const chartData = weeks.map((wStart) => {
    const wEnd = endOfWeek(wStart, { weekStartsOn: 1 });
    const wStartStr = format(wStart, "yyyy-MM-dd");
    const wEndStr = format(wEnd, "yyyy-MM-dd");
    const total = (salesData ?? [])
      .filter((r) => r.date >= wStartStr && r.date <= wEndStr)
      .reduce((sum, r) => sum + (r.net_sales ?? r.total_sales ?? 0), 0);
    return {
      label: format(wStart, "d MMM"),
      weekRange: `${format(wStart, "d MMM")} – ${format(wEnd, "d MMM yyyy")}`,
      total,
    };
  });

  const maxVal = Math.max(...chartData.map((d) => d.total), 1);
  const anchorWeekStr = format(weekEnd, "yyyy-MM-dd");

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Last 12 Weeks Revenue Trend
        </p>
        {!isLoading && (
          <p className="mt-1 text-2xl font-bold">
            {fmtFull(chartData.reduce((s, d) => s + d.total, 0))}
          </p>
        )}
        {isLoading && (
          <div className="mt-1 h-8 w-32 animate-pulse rounded bg-muted" />
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          12-week total · ending {format(parseISO(anchorWeekStr), "d MMM yyyy")}
        </p>
      </div>

      {isLoading ? (
        <div className="h-48 animate-pulse rounded bg-muted" />
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              barCategoryGap="30%"
            >
              <CartesianGrid
                vertical={false}
                stroke="hsl(var(--border))"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={fmtK}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={36}
                domain={[0, Math.ceil((maxVal * 1.1) / 1000) * 1000]}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--accent))" }} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.total === 0 ? "hsl(var(--muted))" : "#f97316"}
                    fillOpacity={entry.total === 0 ? 0.4 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
