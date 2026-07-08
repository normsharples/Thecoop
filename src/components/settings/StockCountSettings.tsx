/*
  Required Supabase migrations — run in the SQL editor before using this page:

  ALTER TABLE food_cost_items ADD COLUMN IF NOT EXISTS location text;

  CREATE TABLE IF NOT EXISTS stock_count_locations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text    NOT NULL,
    description text,
    display_order integer DEFAULT 0,
    active      boolean DEFAULT true,
    created_at  timestamptz DEFAULT now()
  );
*/

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  MapPin,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  LayoutGrid,
  Package,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StockCountLocation, FoodCostItem } from "@/types";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const locationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  active: z.boolean(),
});
type LocationFormValues = z.infer<typeof locationSchema>;

// ─── Location Dialog ──────────────────────────────────────────────────────────

function LocationDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: StockCountLocation;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!initial;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      active: initial?.active ?? true,
    },
  });

  const activeVal = watch("active");

  const { mutate: save } = useMutation({
    mutationFn: async (values: LocationFormValues) => {
      const payload = {
        name: values.name.trim(),
        description: values.description?.trim() || null,
        active: values.active,
      };
      if (isEdit && initial) {
        const { error } = await supabase
          .from("stock_count_locations")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("stock_count_locations")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Area updated" : "Area added");
      queryClient.invalidateQueries({ queryKey: ["stock_count_locations"] });
      reset();
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Count Area" : "Add Count Area"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="loc-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="loc-name"
              placeholder="e.g. Walk-in Fridge, Dry Store, Freezer"
              {...register("name")}
              className={cn(errors.name && "border-destructive")}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loc-desc">Description (optional)</Label>
            <Textarea
              id="loc-desc"
              rows={2}
              placeholder="Where this area is located, what's stored here..."
              {...register("description")}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Active</p>
              <p className="text-xs text-muted-foreground">
                Inactive areas are hidden from the count view
              </p>
            </div>
            <Switch
              checked={activeVal}
              onCheckedChange={(v) => setValue("active", v)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : isEdit ? "Save Changes" : "Add Area"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Count Areas Tab ──────────────────────────────────────────────────────────

function CountAreasTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StockCountLocation | undefined>();
  const queryClient = useQueryClient();

  const { data: locations = [], isLoading } = useQuery<StockCountLocation[]>({
    queryKey: ["stock_count_locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_locations")
        .select("*")
        .order("display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as StockCountLocation[];
    },
  });

  const { mutate: remove } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("stock_count_locations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Area deleted");
      queryClient.invalidateQueries({ queryKey: ["stock_count_locations"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: toggleActive } = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("stock_count_locations")
        .update({ active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["stock_count_locations"] }),
    onError: (err) => toast.error((err as Error).message),
  });

  const active = locations.filter((l) => l.active);
  const inactive = locations.filter((l) => !l.active);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-card-foreground">
                Count Areas
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Define where items are stored so counts can be done area by area.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Area
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      )}

      {!isLoading && locations.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">
            No count areas yet
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Add areas like Walk-in Fridge, Dry Store, or Freezer to organise stock
            counts by physical location.
          </p>
          <Button
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add First Area
          </Button>
        </div>
      )}

      {active.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">
              Active{" "}
              <span className="text-muted-foreground font-normal">
                ({active.length})
              </span>
            </h3>
          </div>
          <div className="divide-y divide-border">
            {active.map((loc) => (
              <LocationRow
                key={loc.id}
                location={loc}
                onEdit={() => {
                  setEditing(loc);
                  setDialogOpen(true);
                }}
                onDelete={() => remove(loc.id)}
                onToggle={() => toggleActive({ id: loc.id, active: false })}
              />
            ))}
          </div>
        </div>
      )}

      {inactive.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium text-muted-foreground">
              Inactive{" "}
              <span className="font-normal">({inactive.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-border">
            {inactive.map((loc) => (
              <LocationRow
                key={loc.id}
                location={loc}
                onEdit={() => {
                  setEditing(loc);
                  setDialogOpen(true);
                }}
                onDelete={() => remove(loc.id)}
                onToggle={() => toggleActive({ id: loc.id, active: true })}
              />
            ))}
          </div>
        </div>
      )}

      <LocationDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(undefined);
        }}
        initial={editing}
      />
    </div>
  );
}

function LocationRow({
  location: loc,
  onEdit,
  onDelete,
  onToggle,
}: {
  location: StockCountLocation;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3",
        !loc.active && "opacity-60"
      )}
    >
      <div className="mt-0.5 shrink-0">
        {loc.active ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{loc.name}</p>
        {loc.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{loc.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggle}
          className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-xs"
        >
          {loc.active ? "Deactivate" : "Activate"}
        </button>
        <button
          onClick={onEdit}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete count area?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes{" "}
                <span className="font-medium text-foreground">{loc.name}</span>{" "}
                as a count area. Items assigned to it will become unassigned.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── Item Locations Tab ───────────────────────────────────────────────────────

function ItemLocationsTab() {
  const queryClient = useQueryClient();

  const { data: locations = [] } = useQuery<StockCountLocation[]>({
    queryKey: ["stock_count_locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_locations")
        .select("*")
        .eq("active", true)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as StockCountLocation[];
    },
  });

  const { data: items = [], isLoading } = useQuery<FoodCostItem[]>({
    queryKey: ["food-cost-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_cost_items")
        .select("*")
        .order("category")
        .order("name");
      if (error) throw error;
      return (data ?? []) as FoodCostItem[];
    },
  });

  const { mutate: updateLocation } = useMutation({
    mutationFn: async ({ id, location }: { id: string; location: string | null }) => {
      const { error } = await supabase
        .from("food_cost_items")
        .update({ location })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["food-cost-items"] }),
    onError: (err) => toast.error((err as Error).message),
  });

  const grouped = items.reduce<Record<string, FoodCostItem[]>>((acc, item) => {
    const cat = item.category || "Uncategorised";
    (acc[cat] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold text-card-foreground">
              Item Locations
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Assign each food cost item to a count area. During a stock count,
              items can be grouped by their area.
            </p>
          </div>
        </div>
      </div>

      {locations.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Add count areas in the <strong>Count Areas</strong> tab first, then
          come back to assign items.
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading items...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No food cost items found. Add items in{" "}
            <strong>Settings → Food Cost Items</strong> first.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(
            ([category, catItems]) => (
              <div
                key={category}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border bg-muted/20">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {category}
                  </h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/10">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                        Item
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-32">
                        Unit
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-52">
                        Count Area
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {catItems.map((item) => (
                      <tr key={item.id} className="hover:bg-accent/20">
                        <td className="px-4 py-2.5 text-foreground font-medium">
                          {item.name}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs">
                          {item.unit}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Select
                              value={item.location ?? "__none__"}
                              onValueChange={(val) =>
                                updateLocation({
                                  id: item.id,
                                  location: val === "__none__" ? null : val,
                                })
                              }
                            >
                              <SelectTrigger className="h-7 text-xs w-44">
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  <span className="text-muted-foreground">
                                    Unassigned
                                  </span>
                                </SelectItem>
                                {locations.map((loc) => (
                                  <SelectItem key={loc.id} value={loc.name}>
                                    {loc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {item.location && (
                              <Badge variant="outline" className="text-xs py-0">
                                {item.location}
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StockCountSettings() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <LayoutGrid className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Stock Count Settings
          </h2>
          <p className="text-xs text-muted-foreground">
            Set up count areas and assign items to them for organised stock counts.
          </p>
        </div>
      </div>

      <Tabs defaultValue="areas">
        <TabsList>
          <TabsTrigger value="areas">Count Areas</TabsTrigger>
          <TabsTrigger value="locations">Item Locations</TabsTrigger>
        </TabsList>
        <TabsContent value="areas" className="mt-4">
          <CountAreasTab />
        </TabsContent>
        <TabsContent value="locations" className="mt-4">
          <ItemLocationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
