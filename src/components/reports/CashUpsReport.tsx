import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Calculator, Store } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { formatCurrency, cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CashUp } from "@/types";

interface ProfileRow {
  id: string;
  full_name: string;
}

export default function CashUpsReport() {
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const restaurantIds = selectedRestaurantId
    ? [selectedRestaurantId]
    : restaurants.map((r) => r.id);

  const { data: cashUps = [], isLoading } = useQuery({
    queryKey: ["cash-ups-report", restaurantIds],
    queryFn: async () => {
      if (!restaurantIds.length) return [];
      const { data, error } = await supabase
        .from("cash_ups")
        .select("*")
        .in("restaurant_id", restaurantIds)
        .order("cash_up_date", { ascending: false });
      if (error) throw error;
      return data as CashUp[];
    },
    enabled: restaurantIds.length > 0,
  });

  const { data: profiles = [] } = useQuery<ProfileRow[]>({
    queryKey: ["profiles-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const restaurantMap = useMemo(() => new Map(restaurants.map((r) => [r.id, r.name])), [restaurants]);
  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name])), [profiles]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Daily Cash Ups</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Till reconciliations logged by restaurant staff — till count (from a note/coin breakdown),
        the $200 float, what the POS expected, what was actually deposited, and any cash paid out
        of the till.
      </p>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : cashUps.length === 0 ? (
          <div className="p-12 text-center">
            <Calculator className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No cash ups recorded yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                {!selectedRestaurantId && <TableHead>Venue</TableHead>}
                <TableHead className="text-right">Till Count</TableHead>
                <TableHead className="text-right">To Bank</TableHead>
                <TableHead className="text-right">POS Expected</TableHead>
                <TableHead className="text-right">Deposited</TableHead>
                <TableHead className="text-right">Variance (Till)</TableHead>
                <TableHead className="text-right">Variance (POS)</TableHead>
                <TableHead>Cash Outs</TableHead>
                <TableHead>Recorded By</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cashUps.map((cu) => {
                const expected = Math.max(0, cu.till_count - cu.float_amount);
                const tillVariance = cu.amount_deposited - expected;
                const posVariance = cu.amount_deposited - cu.pos_expected_deposit;
                return (
                  <TableRow key={cu.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {format(new Date(cu.cash_up_date + "T00:00:00"), "d MMM yyyy")}
                    </TableCell>
                    {!selectedRestaurantId && (
                      <TableCell className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Store className="h-3 w-3" />
                          {restaurantMap.get(cu.restaurant_id) ?? "Unknown"}
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">{formatCurrency(cu.till_count)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(expected)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {cu.pos_expected_deposit > 0 ? formatCurrency(cu.pos_expected_deposit) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(cu.amount_deposited)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums font-medium",
                        tillVariance < 0 ? "text-destructive" : tillVariance > 0 ? "text-green-500" : "text-muted-foreground"
                      )}
                    >
                      {tillVariance === 0 ? "—" : `${tillVariance > 0 ? "+" : ""}${formatCurrency(tillVariance)}`}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums font-medium",
                        cu.pos_expected_deposit === 0
                          ? "text-muted-foreground"
                          : posVariance < 0
                          ? "text-destructive"
                          : posVariance > 0
                          ? "text-green-500"
                          : "text-muted-foreground"
                      )}
                    >
                      {cu.pos_expected_deposit === 0
                        ? "—"
                        : posVariance === 0
                        ? "—"
                        : `${posVariance > 0 ? "+" : ""}${formatCurrency(posVariance)}`}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {cu.cash_outs.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {cu.cash_outs.map((c, i) => (
                            <p key={i} className="text-xs text-muted-foreground truncate">
                              {c.description || "Untitled"} — {formatCurrency(c.amount)}
                            </p>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {cu.recorded_by ? (profileMap.get(cu.recorded_by) ?? "Unknown") : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[180px]">
                      <span className="truncate block">{cu.notes ?? "—"}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
