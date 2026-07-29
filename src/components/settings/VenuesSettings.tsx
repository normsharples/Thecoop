import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Plus, Pencil, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { brandIcon } from "@/lib/brand";
import type { Brand, Restaurant } from "@/types";

const STATUSES = ["active", "grace_period", "inactive"] as const;
const NO_BRAND = "__none__";

function VenueDialog({
  open,
  onClose,
  initial,
  brands,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Restaurant;
  brands: Brand[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [brandId, setBrandId] = useState(initial?.brand_id ?? NO_BRAND);
  const [status, setStatus] = useState<Restaurant["status"]>(initial?.status ?? "active");
  const [lightspeedId, setLightspeedId] = useState(initial?.lightspeed_id ?? "");
  const [deputyId, setDeputyId] = useState(initial?.deputy_id ?? "");
  const [placeId, setPlaceId] = useState(initial?.google_place_id ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Venue name is required");
      const payload = {
        name: trimmed,
        address: address.trim() || null,
        brand_id: brandId === NO_BRAND ? null : brandId,
        status,
        lightspeed_id: lightspeedId.trim() || null,
        deputy_id: deputyId.trim() || null,
        google_place_id: placeId.trim() || null,
      };
      if (initial) {
        const { error } = await supabase.from("restaurants").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("restaurants").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["restaurants"] });
      queryClient.invalidateQueries({ queryKey: ["venues-all"] });
      queryClient.invalidateQueries({ queryKey: ["brand-venue-counts"] });
      toast.success(initial ? "Venue updated" : "Venue added");
      onClose();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to save venue"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Venue" : "Add Venue"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="v-name">Name</Label>
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Geelong West" />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="v-address">Address (optional)</Label>
              <Input id="v-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
            </div>

            <div className="space-y-1.5">
              <Label>Brand</Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select brand" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BRAND}>— No brand —</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Restaurant["status"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-ls">Lightspeed ID</Label>
              <Input id="v-ls" value={lightspeedId} onChange={(e) => setLightspeedId(e.target.value)} placeholder="Optional" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="v-dep">Deputy ID</Label>
              <Input id="v-dep" value={deputyId} onChange={(e) => setDeputyId(e.target.value)} placeholder="Optional" />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="v-gp">Google Place ID</Label>
              <Input id="v-gp" value={placeId} onChange={(e) => setPlaceId(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {initial ? "Save Changes" : "Add Venue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VenuesSettings() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editVenue, setEditVenue] = useState<Restaurant | null>(null);

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("*").order("name");
      if (error) throw error;
      return data as Brand[];
    },
  });

  // All venues regardless of the active brand filter, so this screen always
  // shows the full estate.
  const { data: venues = [], isLoading } = useQuery({
    queryKey: ["venues-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("*").order("name");
      if (error) throw error;
      return data as Restaurant[];
    },
  });

  const brandById = new Map(brands.map((b) => [b.id, b]));

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Store className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Venues</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Venue
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : venues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Store className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No venues yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          {venues.map((v) => {
            const brand = v.brand_id ? brandById.get(v.brand_id) : undefined;
            const Icon = brandIcon(brand?.icon);
            return (
              <div key={v.id} className="flex items-center gap-3 px-4 py-3 group">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: brand ? `${brand.color}22` : undefined }}
                >
                  <Icon className="h-5 w-5" style={{ color: brand?.color }} />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {v.name}
                    {v.status !== "active" && (
                      <span className="ml-2 text-xs text-muted-foreground">({v.status.replace("_", " ")})</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {brand?.name ?? "No brand"}
                    {v.address ? ` · ${v.address}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                  onClick={() => setEditVenue(v)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <VenueDialog open={createOpen} onClose={() => setCreateOpen(false)} brands={brands} />
      {editVenue && (
        <VenueDialog
          open={!!editVenue}
          onClose={() => setEditVenue(null)}
          initial={editVenue}
          brands={brands}
        />
      )}
    </div>
  );
}
