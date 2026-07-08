import { useQuery } from "@tanstack/react-query";
import { Calendar, Users, UtensilsCrossed } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { format } from "date-fns";

const statusConfig: Record<string, { label: string; className: string }> = {
  enquiry:   { label: "Enquiry",    className: "bg-muted/60 text-muted-foreground" },
  confirmed: { label: "Confirmed",  className: "bg-green-500/10 text-green-500" },
  preparing: { label: "Preparing",  className: "bg-blue-500/10 text-blue-500" },
  delivered: { label: "Delivered",  className: "bg-purple-500/10 text-purple-500" },
  completed: { label: "Completed",  className: "bg-muted/60 text-muted-foreground" },
  cancelled: { label: "Cancelled",  className: "bg-red-500/10 text-red-500" },
};

export function UpcomingCatering() {
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const today = format(new Date(), "yyyy-MM-dd");

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants?.map((r) => r.id) ?? [];

  const { data: orders, isLoading } = useQuery({
    queryKey: ["upcoming-catering", selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .in("restaurant_id", restaurantIds)
        .gte("event_date", today)
        .not("status", "eq", "cancelled")
        .order("event_date")
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantIds.length,
  });

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="text-base font-semibold">Upcoming Catering</h3>
      <div className="mt-4 space-y-4">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-border bg-muted/30 p-4 h-24" />
          ))
        ) : orders && orders.length > 0 ? (
          orders.map((order) => {
            const status = statusConfig[order.status] ?? statusConfig.enquiry;
            const itemsSummary = Array.isArray(order.items)
              ? order.items.map((i: { name: string }) => i.name).join(", ")
              : "—";
            return (
              <div key={order.id} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{order.customer_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-1">{itemsSummary}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-md px-2 py-1 text-xs font-semibold", status.className)}>
                    {status.label}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(new Date(order.event_date), "d MMM yyyy")}
                  </span>
                  {order.guest_count && (
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {order.guest_count} guests
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <UtensilsCrossed className="h-3.5 w-3.5" />
                    {formatCurrency(order.total_amount)}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">No upcoming catering orders</p>
        )}
      </div>
    </div>
  );
}
