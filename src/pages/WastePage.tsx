import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Trash2, PlusCircle, Trash, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useInventoryLevels } from "@/hooks/useInventory";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { WasteReason } from "@/types";

const WASTE_REASONS: WasteReason[] = [
  "Overproduction",
  "Expired",
  "Dropped",
  "Customer Return",
  "Quality Issue",
];

type TrackedItem = { id: string; name: string; unit: string | null; category: string | null; track_inventory: boolean };

interface WasteRow {
  id: string;
  date: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  estimated_cost: number;
  reason: string | null;
  food_cost_item_id: string | null;
}

interface FormValues {
  date: string;
  food_cost_item_id: string;
  quantity: string;
  reason: WasteReason;
}

export default function WastePage() {
  const { profile } = useAuth();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const { data: levels = [] } = useInventoryLevels(selectedRestaurantId);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const isAll = !selectedRestaurantId;

  // ── Tracked items (grouped) ────────────────────────────────────────────────
  const { data: foodItems = [] } = useQuery<TrackedItem[]>({
    queryKey: ["food_cost_items_tracked"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_cost_items")
        .select("id, name, unit, category, track_inventory")
        .order("category")
        .order("name");
      if (error) throw error;
      return (data ?? []) as TrackedItem[];
    },
  });

  const itemGroups = useMemo(() => {
    const groups: Record<string, TrackedItem[]> = {};
    for (const it of foodItems) {
      if (!it.track_inventory) continue;
      (groups[it.category ?? "Other"] ??= []).push(it);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [foodItems]);

  // ── Recent waste for this venue ────────────────────────────────────────────
  const { data: recent = [], isLoading } = useQuery<WasteRow[]>({
    queryKey: ["waste_logs", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("waste_logs")
        .select("id, date, item_name, quantity, unit, estimated_cost, reason, food_cost_item_id")
        .order("date", { ascending: false })
        .limit(100);
      if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WasteRow[];
    },
    enabled: !!selectedRestaurantId,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      date: format(new Date(), "yyyy-MM-dd"),
      food_cost_item_id: "",
      quantity: "",
      reason: "Overproduction",
    },
  });

  const selectedItemId = watch("food_cost_item_id");
  const qty = Number(watch("quantity")) || 0;
  const selectedItem = foodItems.find((f) => f.id === selectedItemId);
  const level = levels.find((l) => l.food_cost_item_id === selectedItemId);
  const previewCost = level ? level.avg_cost * qty : null;

  const { mutate: addWaste, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!selectedRestaurantId || !profile) throw new Error("Not authenticated");
      const item = foodItems.find((f) => f.id === values.food_cost_item_id);
      if (!item) throw new Error("Select an item");
      if (!(Number(values.quantity) > 0)) throw new Error("Quantity must be greater than 0");

      const { error } = await supabase.from("waste_logs").insert({
        restaurant_id: selectedRestaurantId,
        date: values.date,
        item_name: item.name,
        quantity: Number(values.quantity),
        unit: item.unit,
        estimated_cost: 0, // auto-filled from moving-avg cost by DB trigger
        reason: values.reason,
        food_cost_item_id: item.id,
        logged_by: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Waste logged & stock depleted");
      reset({
        date: format(new Date(), "yyyy-MM-dd"),
        food_cost_item_id: "",
        quantity: "",
        reason: "Overproduction",
      });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["waste_logs"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-levels"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: deleteWaste } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("waste_logs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Waste deleted & stock restored");
      queryClient.invalidateQueries({ queryKey: ["waste_logs"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-levels"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const totalCost = recent.reduce((s, w) => s + (w.estimated_cost ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trash className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Waste</h2>
          <span className="text-sm text-muted-foreground">— {restaurant?.name ?? "All Restaurants"}</span>
        </div>
        {!isAll && (
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
            Log Waste
          </Button>
        )}
      </div>

      {isAll && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Select a specific restaurant to log waste.
        </div>
      )}

      {/* Form */}
      {showForm && !isAll && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Log Waste</h3>
          <form onSubmit={handleSubmit((v) => addWaste(v))} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Item <span className="text-destructive">*</span></Label>
                <Select
                  value={selectedItemId}
                  onValueChange={(val) => setValue("food_cost_item_id", val, { shouldValidate: true })}
                >
                  <SelectTrigger className={cn(errors.food_cost_item_id && "border-destructive")}>
                    <SelectValue placeholder="Select an item" />
                  </SelectTrigger>
                  <SelectContent>
                    {itemGroups.map(([cat, items]) => (
                      <SelectGroup key={cat}>
                        <SelectLabel>{cat}</SelectLabel>
                        {items.map((it) => (
                          <SelectItem key={it.id} value={it.id}>
                            {it.name} {it.unit ? `(${it.unit})` : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" {...register("date")} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quantity">
                  Quantity {selectedItem?.unit ? `(${selectedItem.unit})` : ""}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="0"
                  {...register("quantity")}
                />
                {previewCost != null && qty > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ≈ {formatCurrency(previewCost)} at avg cost {formatCurrency(level!.avg_cost)}/{selectedItem?.unit}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select
                  value={watch("reason")}
                  onValueChange={(val) => setValue("reason", val as WasteReason)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WASTE_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Log Waste"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); reset(); }}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Summary */}
      {!isAll && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Entries</p>
            <p className="text-xl font-bold tabular-nums text-foreground">{recent.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Waste Cost</p>
            <p className="text-xl font-bold tabular-nums text-foreground">{formatCurrency(totalCost)}</p>
          </div>
        </div>
      )}

      {/* Recent list */}
      {!isAll && (
        isLoading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No waste logged yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {recent.map((w) => (
              <div key={w.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {w.item_name}
                    {!w.food_cost_item_id && (
                      <span className="ml-1.5 text-xs text-warning">(untracked)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(w.date), "d MMM yyyy")} · {w.quantity} {w.unit} · {w.reason}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                  {formatCurrency(w.estimated_cost)}
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete waste entry?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Deletes the {w.quantity} {w.unit} <span className="font-medium text-foreground">{w.item_name}</span>{" "}
                        waste entry and restores that quantity to inventory.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteWaste(w.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
