import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  GripVertical,
  ExternalLink,
  Link2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { QuickLink } from "@/types";

const quickLinkSchema = z.object({
  title: z.string().min(1, "Title is required"),
  url: z.url("Must be a valid URL"),
  icon: z.string().min(1, "Icon is required"),
  role_visibility: z.string().min(1),
});

type QuickLinkFormData = z.infer<typeof quickLinkSchema>;

const ICON_OPTIONS = [
  "ExternalLink",
  "Clock",
  "BarChart3",
  "Receipt",
  "Truck",
  "ShoppingBag",
  "Globe",
  "Mail",
  "Phone",
  "FileText",
  "Star",
  "Zap",
  "DollarSign",
  "Users",
  "Calendar",
  "Map",
];

export default function QuickLinksSettings() {
  const [showForm, setShowForm] = useState(false);
  const [editingLink, setEditingLink] = useState<QuickLink | null>(null);
  const queryClient = useQueryClient();

  const { data: quickLinks, isLoading } = useQuery({
    queryKey: ["quick-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .eq("key", "quick_links")
        .single();
      if (error && error.code !== "PGRST116") throw error;
      return (data?.value as QuickLink[]) ?? [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (links: QuickLink[]) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          {
            key: "quick_links",
            value: links as unknown as Record<string, unknown>,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-links"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleAdd = (data: QuickLinkFormData) => {
    const newLink: QuickLink = {
      id: crypto.randomUUID(),
      title: data.title,
      url: data.url,
      icon: data.icon,
      role_visibility: data.role_visibility,
      order: (quickLinks?.length ?? 0) + 1,
    };
    saveMutation.mutate([...(quickLinks ?? []), newLink]);
    toast.success("Quick link added");
    setShowForm(false);
  };

  const handleEdit = (data: QuickLinkFormData) => {
    if (!editingLink) return;
    const updated = (quickLinks ?? []).map((link) =>
      link.id === editingLink.id
        ? { ...link, ...data }
        : link
    );
    saveMutation.mutate(updated);
    toast.success("Quick link updated");
    setEditingLink(null);
  };

  const handleDelete = (id: string) => {
    const updated = (quickLinks ?? []).filter((link) => link.id !== id);
    saveMutation.mutate(updated);
    toast.success("Quick link removed");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Quick Links</h2>
          <p className="text-sm text-muted-foreground">
            Manage dashboard quick links for easy access to external tools
          </p>
        </div>
        <button
          onClick={() => {
            setEditingLink(null);
            setShowForm(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Link
        </button>
      </div>

      {(showForm || editingLink) && (
        <QuickLinkForm
          link={editingLink}
          onClose={() => {
            setShowForm(false);
            setEditingLink(null);
          }}
          onSubmit={editingLink ? handleEdit : handleAdd}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {quickLinks && quickLinks.length > 0 ? (
            quickLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <ExternalLink className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {link.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                  </div>
                </div>
                <span className="hidden sm:inline-flex items-center rounded-md bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
                  {link.role_visibility === "all" ? "All roles" : link.role_visibility}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingLink(link);
                      setShowForm(false);
                    }}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(link.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12 text-muted-foreground">
              <Link2 className="h-10 w-10 mb-2" />
              <p className="text-sm">No quick links configured</p>
              <p className="text-xs mt-1">Add links to external tools your team uses daily</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuickLinkForm({
  link,
  onClose,
  onSubmit,
}: {
  link: QuickLink | null;
  onClose: () => void;
  onSubmit: (data: QuickLinkFormData) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<QuickLinkFormData>({
    resolver: zodResolver(quickLinkSchema),
    defaultValues: link
      ? { title: link.title, url: link.url, icon: link.icon, role_visibility: link.role_visibility }
      : { icon: "ExternalLink", role_visibility: "all" },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">
          {link ? "Edit Quick Link" : "Add Quick Link"}
        </h3>
        <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Title</label>
            <input
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Deputy"
              {...register("title")}
            />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">URL</label>
            <input
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="https://once.deputy.com"
              {...register("url")}
            />
            {errors.url && (
              <p className="text-xs text-destructive">{errors.url.message}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Icon</label>
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              {...register("icon")}
            >
              {ICON_OPTIONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Visible to</label>
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              {...register("role_visibility")}
            >
              <option value="all">All roles</option>
              <option value="superadmin">Superadmin only</option>
              <option value="area_manager">Area Manager +</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {link ? "Update" : "Add"} Link
          </button>
        </div>
      </form>
    </div>
  );
}
