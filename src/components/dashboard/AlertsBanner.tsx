import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, X, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import type { AlertHistory } from "@/types";

type AlertWithRestaurant = AlertHistory & { restaurant?: { name: string } };

export function AlertsBanner() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: restaurants } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants?.map((r) => r.id) ?? [];

  // Query unacknowledged alerts from alert_history
  const { data: alertHistory = [] } = useQuery({
    queryKey: ["alert-history-unack", selectedRestaurantId],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("alert_history")
        .select("*, restaurant:restaurants(name)")
        .eq("acknowledged", false)
        .in("restaurant_id", restaurantIds)
        .order("triggered_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AlertWithRestaurant[];
    },
    enabled: !!restaurantIds.length,
    refetchInterval: 1000 * 60 * 5, // refresh every 5 mins
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("alert_history")
        .update({
          acknowledged: true,
          acknowledged_by: user?.id ?? null,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-history-unack"] });
      queryClient.invalidateQueries({ queryKey: ["alert-history"] });
    },
  });

  const reportPaths: Record<string, string> = {
    sales_dip: "/reports/sales",
    labour_spike: "/reports/labour",
    bad_review: "/reports/reviews",
    overtime_warning: "/reports/labour",
    low_transactions: "/reports/sales",
    missing_deposit: "/admin/cash",
  };

  const visible = alertHistory.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {visible.map((alert) => (
        <div
          key={alert.id}
          className={cn(
            "flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3",
            alert.severity === "urgent" && "border-l-4 border-l-red-500",
            alert.severity === "warning" && "border-l-4 border-l-amber-500",
            alert.severity === "critical" && "border-l-4 border-l-red-700"
          )}
        >
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle
              className={cn(
                "h-4 w-4 shrink-0 mt-0.5",
                alert.severity === "urgent" && "text-red-500",
                alert.severity === "warning" && "text-amber-500",
                alert.severity === "critical" && "text-red-700"
              )}
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-semibold",
                  alert.severity === "urgent" && "text-red-400",
                  alert.severity === "warning" && "text-amber-400",
                  alert.severity === "critical" && "text-red-300"
                )}
              >
                {alert.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {alert.message}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {reportPaths[alert.alert_type] && (
              <button
                onClick={() => navigate(reportPaths[alert.alert_type])}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="View report"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => acknowledgeMutation.mutate(alert.id)}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Acknowledge"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}

      {visible.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setDismissed(new Set(visible.map((a) => a.id)));
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss all
          </button>
        </div>
      )}
    </div>
  );
}
