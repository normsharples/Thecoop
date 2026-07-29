import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tags, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  BRAND_ICON_KEYS,
  brandIcon,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_ICON,
} from "@/lib/brand";
import type { Brand } from "@/types";

function BrandDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Brand;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? DEFAULT_BRAND_COLOR);
  const [icon, setIcon] = useState(initial?.icon ?? DEFAULT_BRAND_ICON);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Brand name is required");
      const payload = { name: trimmed, color, icon };
      if (initial) {
        const { error } = await supabase.from("brands").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("brands").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] });
      toast.success(initial ? "Brand updated" : "Brand added");
      onClose();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to save brand"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Brand" : "Add Brand"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Name</Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pollo Rotisserie"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Accent colour</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 rounded border border-border bg-background p-1"
                aria-label="Brand colour"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#C9A84C"
                className="w-32 font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="grid grid-cols-8 gap-1.5">
              {BRAND_ICON_KEYS.map((key) => {
                const Icon = brandIcon(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIcon(key)}
                    className={cn(
                      "flex items-center justify-center rounded-md border p-2 transition-colors",
                      icon === key
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    )}
                    aria-label={key}
                  >
                    <Icon className="h-4 w-4" style={{ color }} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {initial ? "Save Changes" : "Add Brand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BrandsSettings() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editBrand, setEditBrand] = useState<Brand | null>(null);
  const queryClient = useQueryClient();

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("*").order("name");
      if (error) throw error;
      return data as Brand[];
    },
  });

  // Venue counts per brand — used to warn before deleting a brand in use.
  const { data: venueCounts = {} } = useQuery({
    queryKey: ["brand-venue-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("brand_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data ?? []) {
        const id = (r as { brand_id: string | null }).brand_id;
        if (id) counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    },
  });

  const deleteBrand = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("brands").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands"] });
      queryClient.invalidateQueries({ queryKey: ["brand-venue-counts"] });
      toast.success("Brand deleted");
    },
    onError: () => toast.error("Failed to delete brand"),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Tags className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Brands</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Brand
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Brands group your venues. Assign each venue to a brand under Settings → Venues. The active
        brand sets the app's name, icon and accent colour.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 rounded bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Tags className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            No brands yet. Add one to start grouping venues.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          {brands.map((b) => {
            const Icon = brandIcon(b.icon);
            const count = venueCounts[b.id] ?? 0;
            return (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 group">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${b.color}22` }}
                >
                  <Icon className="h-5 w-5" style={{ color: b.color }} />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {count} venue{count !== 1 ? "s" : ""} · <span className="font-mono">{b.color}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditBrand(b)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (count > 0) {
                        toast.error(
                          `Reassign this brand's ${count} venue${count !== 1 ? "s" : ""} before deleting it.`
                        );
                        return;
                      }
                      if (confirm(`Delete brand "${b.name}"?`)) deleteBrand.mutate(b.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BrandDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editBrand && (
        <BrandDialog open={!!editBrand} onClose={() => setEditBrand(null)} initial={editBrand} />
      )}
    </div>
  );
}
