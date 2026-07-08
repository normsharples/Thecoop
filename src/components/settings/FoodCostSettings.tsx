import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Truck,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
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
import { Switch } from "@/components/ui/switch";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: string;
  name: string;
  category: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface SupplierItem {
  id: string;
  supplier_id: string;
  description: string;
  unit: string;
  typical_price: number;
  display_order: number;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const supplierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().optional(),
  contact_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean(),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;

const itemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  unit: z.string().min(1, "Unit is required"),
  typical_price: z.coerce.number().min(0, "Must be ≥ 0"),
});

type ItemFormValues = z.infer<typeof itemSchema>;

// ─── Supplier Dialog ──────────────────────────────────────────────────────────

function SupplierDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Supplier;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!initial;

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<SupplierFormValues>({
      resolver: zodResolver(supplierSchema),
      defaultValues: {
        name: initial?.name ?? "",
        category: initial?.category ?? "",
        contact_name: initial?.contact_name ?? "",
        phone: initial?.phone ?? "",
        email: initial?.email ?? "",
        notes: initial?.notes ?? "",
        active: initial?.active ?? true,
      },
    });

  const activeVal = watch("active");

  const { mutate: save } = useMutation({
    mutationFn: async (values: SupplierFormValues) => {
      const payload = {
        name: values.name.trim(),
        category: values.category?.trim() || null,
        contact_name: values.contact_name?.trim() || null,
        phone: values.phone?.trim() || null,
        email: values.email?.trim() || null,
        notes: values.notes?.trim() || null,
        active: values.active,
      };
      if (isEdit && initial) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Supplier updated" : "Supplier added");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      reset();
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="name">Supplier Name <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                placeholder="e.g. Bidfood, PFD Food Services"
                {...register("name")}
                className={cn(errors.name && "border-destructive")}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                placeholder="e.g. Meat, Produce, Packaging"
                {...register("category")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact_name">Contact Name</Label>
              <Input
                id="contact_name"
                placeholder="Account rep name"
                {...register("contact_name")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" placeholder="03 xxxx xxxx" {...register("phone")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="orders@supplier.com" {...register("email")} />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={2}
                placeholder="Account number, order days, minimum order, etc."
                {...register("notes")}
              />
            </div>

            <div className="col-span-2 flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">Inactive suppliers are hidden from dropdowns</p>
              </div>
              <Switch
                checked={activeVal}
                onCheckedChange={(v) => setValue("active", v)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : isEdit ? "Save Changes" : "Add Supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Supplier Items Panel ─────────────────────────────────────────────────────

function SupplierItemsPanel({ supplier }: { supplier: Supplier }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<ItemFormValues>({ description: "", unit: "kg", typical_price: 0 });

  const { data: items = [], isLoading } = useQuery<SupplierItem[]>({
    queryKey: ["supplier_items", supplier.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_items")
        .select("*")
        .eq("supplier_id", supplier.id)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as SupplierItem[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema) as Resolver<ItemFormValues>,
    defaultValues: { description: "", unit: "kg", typical_price: 0 },
  });

  const { mutate: addItem } = useMutation({
    mutationFn: async (values: ItemFormValues) => {
      const name = values.description.trim();
      const unit = values.unit.trim();
      const price = Number(values.typical_price);

      const { error: siError } = await supabase.from("supplier_items").insert({
        supplier_id: supplier.id,
        description: name,
        unit,
        typical_price: price,
        display_order: items.length,
      });
      if (siError) throw siError;

      const { error: fciError } = await supabase.from("food_cost_items").insert({
        name,
        unit,
        cost_per_unit: price,
        category: supplier.category?.trim() || "Uncategorised",
        supplier: supplier.name,
      });
      if (fciError) throw fciError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier_items", supplier.id] });
      queryClient.invalidateQueries({ queryKey: ["food-cost-items"] });
      reset({ description: "", unit: "kg", typical_price: 0 });
      toast.success("Item added and created as a food cost item");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: updateItem, isPending: isSaving } = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ItemFormValues }) => {
      const { error } = await supabase.from("supplier_items").update({
        description: values.description.trim(),
        unit: values.unit.trim(),
        typical_price: Number(values.typical_price),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier_items", supplier.id] });
      setEditingId(null);
      toast.success("Item updated");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: deleteItem } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("supplier_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier_items", supplier.id] });
      toast.success("Item removed");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function startEdit(item: SupplierItem) {
    setEditingId(item.id);
    setEditValues({ description: item.description, unit: item.unit, typical_price: item.typical_price });
  }

  function saveEdit() {
    if (!editingId) return;
    updateItem({ id: editingId, values: editValues });
  }

  return (
    <div className="border-t border-border bg-muted/20 px-4 py-4 space-y-4">
      <div className="flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Order Catalogue
        </p>
        <p className="text-xs text-muted-foreground">
          — items auto-populate when this supplier is selected in a Purchase Order
        </p>
      </div>

      {/* Items list */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No items yet. Add items below and they'll auto-fill when creating a PO.
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Unit</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Typical Price</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) =>
                editingId === item.id ? (
                  // ── Edit row ────────────────────────────────────────────
                  <tr key={item.id} className="bg-accent/30">
                    <td className="px-2 py-1.5">
                      <Input
                        value={editValues.description}
                        onChange={(e) => setEditValues((v) => ({ ...v, description: e.target.value }))}
                        className="h-7 text-sm"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={editValues.unit}
                        onChange={(e) => setEditValues((v) => ({ ...v, unit: e.target.value }))}
                        className="h-7 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editValues.typical_price}
                          onChange={(e) => setEditValues((v) => ({ ...v, typical_price: Number(e.target.value) }))}
                          className="h-7 text-sm pl-6 text-right"
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={saveEdit}
                          disabled={isSaving}
                          className="rounded p-1 text-green-600 hover:bg-green-500/10 transition-colors"
                          title="Save"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent transition-colors"
                          title="Cancel"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  // ── Read row ────────────────────────────────────────────
                  <tr key={item.id} className="group">
                    <td className="px-3 py-2 text-foreground">{item.description}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      ${item.typical_price.toFixed(2)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(item)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add item form */}
      <form
        onSubmit={handleSubmit((v) => addItem(v))}
        className="grid grid-cols-[1fr_80px_100px_auto] gap-2 items-start"
      >
        <div>
          <Input
            placeholder="e.g. Chicken breast"
            {...register("description")}
            className={cn("h-8 text-sm", errors.description && "border-destructive")}
          />
          {errors.description && (
            <p className="text-xs text-destructive mt-0.5">{errors.description.message}</p>
          )}
        </div>
        <Input
          placeholder="kg"
          {...register("unit")}
          className={cn("h-8 text-sm", errors.unit && "border-destructive")}
        />
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className={cn("pl-6 h-8 text-sm", errors.typical_price && "border-destructive")}
            {...register("typical_price")}
          />
        </div>
        <Button type="submit" size="sm" disabled={isSubmitting} className="h-8">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </form>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FoodCostSettings() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | undefined>();
  const [expandedItemsId, setExpandedItemsId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });

  const { mutate: deleteSupplier } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Supplier deleted");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: toggleActive } = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("suppliers").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    onError: (err) => toast.error((err as Error).message),
  });

  const openAdd  = () => { setEditing(undefined); setDialogOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setDialogOpen(true); };

  const active   = suppliers.filter((s) => s.active);
  const inactive = suppliers.filter((s) => !s.active);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-card-foreground">Suppliers</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage suppliers and their order catalogues for purchase orders.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Supplier
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Loading suppliers...</p>
        </div>
      )}

      {!isLoading && suppliers.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Truck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No suppliers yet</p>
          <p className="text-xs text-muted-foreground mb-4">
            Add your food and packaging suppliers to use them in invoice and purchase order tracking.
          </p>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add First Supplier
          </Button>
        </div>
      )}

      {active.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium text-foreground">
              Active <span className="text-muted-foreground font-normal">({active.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-border">
            {active.map((s) => (
              <SupplierRow
                key={s.id}
                supplier={s}
                itemsExpanded={expandedItemsId === s.id}
                onToggleItems={() => setExpandedItemsId(expandedItemsId === s.id ? null : s.id)}
                onEdit={() => openEdit(s)}
                onDelete={() => deleteSupplier(s.id)}
                onToggle={() => toggleActive({ id: s.id, active: false })}
              />
            ))}
          </div>
        </div>
      )}

      {inactive.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium text-muted-foreground">
              Inactive <span className="font-normal">({inactive.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-border">
            {inactive.map((s) => (
              <SupplierRow
                key={s.id}
                supplier={s}
                itemsExpanded={expandedItemsId === s.id}
                onToggleItems={() => setExpandedItemsId(expandedItemsId === s.id ? null : s.id)}
                onEdit={() => openEdit(s)}
                onDelete={() => deleteSupplier(s.id)}
                onToggle={() => toggleActive({ id: s.id, active: true })}
              />
            ))}
          </div>
        </div>
      )}

      <SupplierDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(undefined); }}
        initial={editing}
      />
    </div>
  );
}

// ─── Supplier Row ─────────────────────────────────────────────────────────────

function SupplierRow({
  supplier: s,
  itemsExpanded,
  onToggleItems,
  onEdit,
  onDelete,
  onToggle,
}: {
  supplier: Supplier;
  itemsExpanded: boolean;
  onToggleItems: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  // Fetch item count for badge
  const { data: items = [] } = useQuery<SupplierItem[]>({
    queryKey: ["supplier_items", s.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_items")
        .select("id, supplier_id, description, unit, typical_price, display_order")
        .eq("supplier_id", s.id)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as SupplierItem[];
    },
  });

  return (
    <div>
      <div className={cn("flex items-start gap-3 px-4 py-3", !s.active && "opacity-60")}>
        <div className="mt-0.5 shrink-0">
          {s.active
            ? <CheckCircle2 className="h-4 w-4 text-green-500" />
            : <XCircle className="h-4 w-4 text-muted-foreground" />
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{s.name}</span>
            {s.category && (
              <Badge variant="outline" className="text-xs py-0">{s.category}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {s.contact_name && <span className="text-xs text-muted-foreground">{s.contact_name}</span>}
            {s.phone && <span className="text-xs text-muted-foreground">{s.phone}</span>}
            {s.email && <span className="text-xs text-muted-foreground">{s.email}</span>}
          </div>
          {s.notes && (
            <p className="text-xs text-muted-foreground mt-0.5 italic">{s.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Items toggle */}
          <button
            onClick={onToggleItems}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors",
              itemsExpanded
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Package className="h-3 w-3" />
            <span>Items{items.length > 0 ? ` (${items.length})` : ""}</span>
            {itemsExpanded
              ? <ChevronUp className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />
            }
          </button>

          <button
            onClick={onToggle}
            className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-xs"
          >
            {s.active ? "Deactivate" : "Activate"}
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
                <AlertDialogTitle>Delete supplier?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes{" "}
                  <span className="font-medium text-foreground">{s.name}</span> and all their
                  catalogue items. Existing invoices will keep the supplier name as text.
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

      {itemsExpanded && <SupplierItemsPanel supplier={s} />}
    </div>
  );
}
