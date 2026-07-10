import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  DollarSign,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

// ─── schema ──────────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().min(1, "Category name required"),
  amount: z.coerce.number().min(0),
});

const hourSchema = z.object({
  hour: z.coerce.number().min(0).max(23),
  amount: z.coerce.number().min(0),
});

const schema = z.object({
  restaurant_id: z.string().min(1, "Restaurant required"),
  date: z.string().min(1, "Date required"),
  total_sales: z.coerce.number().min(0, "Gross sales required"),
  net_sales: z.coerce.number().min(0).optional(),
  transaction_count: z.coerce.number().int().min(0),
  average_transaction: z.coerce.number().min(0).optional(),
  sales_by_category: z.array(categorySchema),
  sales_by_hour: z.array(hourSchema),
  manual_notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ─── component ───────────────────────────────────────────────────────────────

export default function SalesManualEntryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { isSuperadmin, assignedRestaurants } = usePermissions();
  const { data: allRestaurants } = useRestaurants();
  const [showHours, setShowHours] = useState(false);
  const [overrideWarning, setOverrideWarning] = useState<string | null>(null);

  const accessibleRestaurants = isSuperadmin
    ? allRestaurants
    : allRestaurants?.filter((r) => assignedRestaurants.includes(r.id));

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      restaurant_id: accessibleRestaurants?.[0]?.id ?? "",
      date: format(new Date(), "yyyy-MM-dd"),
      total_sales: undefined,
      net_sales: undefined,
      transaction_count: 0,
      average_transaction: undefined,
      sales_by_category: [],
      sales_by_hour: [],
      manual_notes: "",
    },
  });

  const { fields: catFields, append: appendCat, remove: removeCat } = useFieldArray({
    control,
    name: "sales_by_category",
  });

  const { fields: hourFields, append: appendHour, remove: removeHour } = useFieldArray({
    control,
    name: "sales_by_hour",
  });

  const watchedDate = watch("date");
  const watchedRestaurant = watch("restaurant_id");
  const watchedGross = watch("total_sales");
  const watchedCount = watch("transaction_count");

  // Auto-calc average transaction
  if (watchedGross > 0 && watchedCount > 0) {
    const avg = Math.round((watchedGross / watchedCount) * 100) / 100;
    setValue("average_transaction", avg);
  }

  // Check for existing data
  const { data: existingData } = useQuery({
    queryKey: ["sales-existing", watchedRestaurant, watchedDate],
    queryFn: async () => {
      if (!watchedRestaurant || !watchedDate) return null;
      const { data } = await supabase
        .from("sales_daily")
        .select("id, source, total_sales")
        .eq("restaurant_id", watchedRestaurant)
        .eq("date", watchedDate)
        .maybeSingle();
      return data;
    },
    enabled: !!watchedRestaurant && !!watchedDate,
  });

  const isOverride = !!existingData;
  const existingSource = existingData?.source;

  const submitMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!profile) throw new Error("Not authenticated");

      const source = isOverride ? "override" : "manual";

      const payload = {
        restaurant_id: formData.restaurant_id,
        date: formData.date,
        total_sales: formData.total_sales,
        net_sales: formData.net_sales ?? null,
        transaction_count: formData.transaction_count,
        average_transaction:
          formData.average_transaction ??
          (formData.transaction_count > 0
            ? Math.round((formData.total_sales / formData.transaction_count) * 100) / 100
            : 0),
        sales_by_category:
          formData.sales_by_category.length > 0 ? formData.sales_by_category : null,
        sales_by_hour: formData.sales_by_hour.length > 0 ? formData.sales_by_hour : null,
        manual_notes: formData.manual_notes || null,
        entered_by: profile.id,
        source,
      };

      const { error } = await supabase
        .from("sales_daily")
        .upsert(payload, { onConflict: "restaurant_id,date" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isOverride ? "Sales data overridden" : "Sales data saved");
      queryClient.invalidateQueries({ queryKey: ["sales-report"] });
      queryClient.invalidateQueries({ queryKey: ["snapshot-sales"] });
      queryClient.invalidateQueries({ queryKey: ["sparkline-sales"] });
      queryClient.invalidateQueries({ queryKey: ["sales-today"] });
      navigate("/reports/sales");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(formData: FormData) {
    if (isOverride && !overrideWarning) {
      setOverrideWarning(formData.date);
      return;
    }
    setOverrideWarning(null);
    submitMutation.mutate(formData);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/reports/sales")}
          className="rounded-lg p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <DollarSign className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Manual Sales Entry</h1>
          <p className="text-sm text-muted-foreground">
            Enter or override sales data for any restaurant and date
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-6">
        {/* ── Override warning ─────────────────────────────────────────── */}
        {isOverride && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-500">Data already exists for this date</p>
              <p className="text-xs text-amber-500/80 mt-1">
                Source: <strong>{existingSource}</strong> — Gross:{" "}
                <strong>${Number(existingData.total_sales).toFixed(2)}</strong>. Saving will override
                this record and mark it as &quot;override&quot;.
              </p>
              {overrideWarning && (
                <p className="text-xs font-semibold text-amber-500 mt-2">
                  Click Save again to confirm the override.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Restaurant & Date ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-base font-semibold">Location & Date</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Restaurant</label>
              <select
                {...register("restaurant_id")}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select restaurant…</option>
                {accessibleRestaurants?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {errors.restaurant_id && (
                <p className="text-xs text-destructive">{errors.restaurant_id.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Date</label>
              <input
                type="date"
                {...register("date")}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.date && (
                <p className="text-xs text-destructive">{errors.date.message}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Sales Figures ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-base font-semibold">Sales Figures</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Gross Sales ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("total_sales")}
                placeholder="0.00"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.total_sales && (
                <p className="text-xs text-destructive">{errors.total_sales.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Net Sales ($){" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("net_sales")}
                placeholder="0.00"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Transaction Count</label>
              <input
                type="number"
                min="0"
                {...register("transaction_count")}
                placeholder="0"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.transaction_count && (
                <p className="text-xs text-destructive">{errors.transaction_count.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Avg Transaction ($){" "}
                <span className="text-muted-foreground font-normal">(auto-calculated)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("average_transaction")}
                placeholder="0.00"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring bg-muted/30"
                readOnly
              />
            </div>
          </div>
        </div>

        {/* ── Sales by Category ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Sales by Category</h2>
            <button
              type="button"
              onClick={() => appendCat({ name: "", amount: 0 })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add Category
            </button>
          </div>
          {catFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories added yet.</p>
          ) : (
            <div className="space-y-2">
              {catFields.map((field, i) => (
                <div key={field.id} className="flex items-center gap-3">
                  <input
                    {...register(`sales_by_category.${i}.name`)}
                    placeholder="Category name"
                    className="flex-1 h-9 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    {...register(`sales_by_category.${i}.amount`)}
                    placeholder="0.00"
                    className="w-32 h-9 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => removeCat(i)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sales by Hour (collapsible) ────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowHours((s) => !s)}
            className="flex w-full items-center justify-between px-6 py-4 hover:bg-muted/10 transition-colors"
          >
            <h2 className="text-base font-semibold">Sales by Hour</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{hourFields.length} entries</span>
              {showHours ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
          {showHours && (
            <div className="border-t border-border px-6 py-4 space-y-4">
              <button
                type="button"
                onClick={() => appendHour({ hour: hourFields.length + 10, amount: 0 })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Add Hour
              </button>
              {hourFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hourly entries yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {hourFields.map((field, i) => (
                    <div key={field.id} className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        {...register(`sales_by_hour.${i}.hour`)}
                        placeholder="Hr (0-23)"
                        className="w-20 h-9 rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        {...register(`sales_by_hour.${i}.amount`)}
                        placeholder="$0.00"
                        className="flex-1 h-9 rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={() => removeHour(i)}
                        className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Notes ────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-2">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            {...register("manual_notes")}
            rows={3}
            placeholder="Any notes about this entry…"
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/reports/sales")}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitMutation.isPending}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
              isOverride
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {submitMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isOverride
              ? overrideWarning
                ? "Confirm Override"
                : "Override Existing Data"
              : "Save Sales Data"}
          </button>
        </div>
      </form>
    </div>
  );
}
