import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { HardDrive, Plus, Trash2, Pencil, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRestaurants } from "@/hooks/useRestaurants";
import type { Asset } from "@/types";

// ── Schema ────────────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1, "Name required"),
  category: z.string().min(1, "Category required"),
  make: z.string().optional(),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  warranty_expiry: z.string().optional(),
  status: z.enum(["operational", "needs_repair", "out_of_service", "retired"]),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  Asset["status"],
  { label: string; className: string }
> = {
  operational: {
    label: "Operational",
    className: "bg-green-500/15 text-green-400 border-green-500/30",
  },
  needs_repair: {
    label: "Needs Repair",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  out_of_service: {
    label: "Out of Service",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  retired: {
    label: "Retired",
    className: "bg-muted text-muted-foreground border-border",
  },
};

// ── Asset Dialog ──────────────────────────────────────────────────────────────

function AssetDialog({
  open,
  onClose,
  restaurantId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  initial?: Asset;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial
      ? {
          name: initial.name,
          category: initial.category ?? "",
          make: initial.make ?? "",
          model: initial.model ?? "",
          serial_number: initial.serial_number ?? "",
          purchase_date: initial.purchase_date ?? "",
          warranty_expiry: initial.warranty_expiry ?? "",
          status: initial.status,
          notes: initial.notes ?? "",
        }
      : {
          name: "",
          category: "",
          make: "",
          model: "",
          serial_number: "",
          status: "operational",
        },
  });

  const status = watch("status");

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        restaurant_id: restaurantId,
        name: values.name,
        category: values.category || null,
        make: values.make || null,
        model: values.model || null,
        serial_number: values.serial_number || null,
        purchase_date: values.purchase_date || null,
        warranty_expiry: values.warranty_expiry || null,
        status: values.status,
        notes: values.notes || null,
      };
      if (initial) {
        const { error } = await supabase
          .from("assets")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("assets").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets", restaurantId] });
      toast.success(initial ? "Asset updated" : "Asset added");
      onClose();
    },
    onError: () => toast.error("Failed to save asset"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Asset" : "Add Asset"}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => saveMutation.mutate(v))}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...register("name")} placeholder="Asset name" />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                {...register("category")}
                placeholder="e.g. Cooking Equipment"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) =>
                  setValue(
                    "status",
                    v as Asset["status"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operational">Operational</SelectItem>
                  <SelectItem value="needs_repair">Needs Repair</SelectItem>
                  <SelectItem value="out_of_service">Out of Service</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="make">Make</Label>
              <Input id="make" {...register("make")} placeholder="Manufacturer" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <Input id="model" {...register("model")} placeholder="Model number" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="serial_number">Serial Number</Label>
              <Input
                id="serial_number"
                {...register("serial_number")}
                placeholder="Serial #"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="purchase_date">Purchase Date</Label>
              <Input
                id="purchase_date"
                type="date"
                {...register("purchase_date")}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="warranty_expiry">Warranty Expiry</Label>
              <Input
                id="warranty_expiry"
                type="date"
                {...register("warranty_expiry")}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" {...register("notes")} placeholder="Optional notes" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              {initial ? "Save Changes" : "Add Asset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AssetRegister() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string>("");
  const queryClient = useQueryClient();

  const { restaurants } = useRestaurants();

  const effectiveRestaurantId =
    selectedRestaurantId || restaurants[0]?.id || "";

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets", effectiveRestaurantId],
    queryFn: async () => {
      if (!effectiveRestaurantId) return [];
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .eq("restaurant_id", effectiveRestaurantId)
        .order("category")
        .order("name");
      if (error) throw error;
      return data as Asset[];
    },
    enabled: !!effectiveRestaurantId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("assets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets", effectiveRestaurantId] });
      toast.success("Asset deleted");
    },
    onError: () => toast.error("Failed to delete asset"),
  });

  return (
    <div className={cn("rounded-xl border border-border bg-card p-6")}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">
            Asset Register
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {restaurants.length > 1 && (
            <Select
              value={effectiveRestaurantId}
              onValueChange={setSelectedRestaurantId}
            >
              <SelectTrigger className="w-40 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {restaurants.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={!effectiveRestaurantId}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Asset
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <HardDrive className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            No assets registered for this store yet.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">
                  Name
                </th>
                <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">
                  Category
                </th>
                <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium hidden md:table-cell">
                  Make / Model
                </th>
                <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium hidden lg:table-cell">
                  Warranty
                </th>
                <th className="text-left px-3 py-2 text-xs text-muted-foreground font-medium">
                  Status
                </th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assets.map((asset) => {
                const cfg = STATUS_CONFIG[asset.status];
                const warrantyExpired =
                  asset.warranty_expiry
                    ? new Date(asset.warranty_expiry) < new Date()
                    : false;
                return (
                  <tr key={asset.id} className="hover:bg-accent/20 group">
                    <td className="px-3 py-2.5 font-medium text-foreground">
                      {asset.name}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {asset.category ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                      {[asset.make, asset.model].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      {asset.warranty_expiry ? (
                        <span
                          className={
                            warrantyExpired
                              ? "text-red-400 text-xs"
                              : "text-muted-foreground text-xs"
                          }
                        >
                          {asset.warranty_expiry}
                          {warrantyExpired && " (expired)"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant="outline"
                        className={cn("text-xs border", cfg.className)}
                      >
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditAsset(asset)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            if (confirm("Delete this asset?"))
                              deleteMutation.mutate(asset.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {effectiveRestaurantId && (
        <>
          <AssetDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            restaurantId={effectiveRestaurantId}
          />
          {editAsset && (
            <AssetDialog
              open={!!editAsset}
              onClose={() => setEditAsset(null)}
              restaurantId={effectiveRestaurantId}
              initial={editAsset}
            />
          )}
        </>
      )}
    </div>
  );
}
