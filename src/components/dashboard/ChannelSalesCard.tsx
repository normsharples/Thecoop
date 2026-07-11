import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";

type SalesField = "online_sales" | "delivery_sales";

interface ChannelSalesCardProps {
  label: string;
  field: SalesField;
  icon: LucideIcon;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  comparisonLabel: string;
}

export function ChannelSalesCard({
  label, field, icon: Icon, from, to, prevFrom, prevTo, comparisonLabel,
}: ChannelSalesCardProps) {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const restaurantIds: string[] = selectedRestaurantId
    ? [selectedRestaurantId]
    : (restaurants?.map((r) => r.id) ?? []);

  const { data, isLoading } = useQuery({
    queryKey: ["channel-sales", field, from, to, selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return null;
      const [{ data: sales }, { data: prevSales }] = await Promise.all([
        supabase.from("sales_daily").select(field).gte("date", from).lte("date", to).in("restaurant_id", restaurantIds),
        supabase.from("sales_daily").select(field).gte("date", prevFrom).lte("date", prevTo).in("restaurant_id", restaurantIds),
      ]);
      return {
        sales: (sales ?? []) as Record<SalesField, number | null>[],
        prevSales: (prevSales ?? []) as Record<SalesField, number | null>[],
      };
    },
    enabled: !!restaurantIds.length,
    staleTime: 1000 * 60 * 5,
  });

  if (!data || isLoading) {
    return <div className="rounded-xl border border-border bg-card p-4 h-28 animate-pulse" />;
  }

  const total = data.sales.reduce((s, r) => s + (r[field] ?? 0), 0);
  const prevTotal = data.prevSales.reduce((s, r) => s + (r[field] ?? 0), 0);
  const trend = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold">{formatCurrency(total)}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {trend !== null ? (
          <>
            {trend > 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : trend < 0 ? (
              <TrendingDown className="h-4 w-4 text-red-500" />
            ) : (
              <Minus className="h-4 w-4 text-muted-foreground" />
            )}
            <span className={cn("text-sm font-medium", trend >= 0 ? "text-green-500" : "text-red-500")}>
              {trend > 0 ? "+" : ""}{trend.toFixed(1)}%
            </span>
          </>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">—</span>
        )}
        <span className="text-xs text-muted-foreground">{comparisonLabel}</span>
      </div>
    </div>
  );
}
