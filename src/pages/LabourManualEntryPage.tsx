import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Users,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  ArrowLeft,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

// ─── schema ──────────────────────────────────────────────────────────────────

const roleSchema = z.object({
  role: z.string().min(1, "Role name required"),
  hours: z.coerce.number().min(0),
});

const schema = z.object({
  restaurant_id: z.string().min(1, "Restaurant required"),
  date: z.string().min(1, "Date required"),
  total_hours: z.coerce.number().min(0, "Actual hours required"),
  scheduled_hours: z.coerce.number().min(0).optional(),
  overtime_hours: z.coerce.number().min(0).optional(),
  total_cost: z.coerce.number().min(0, "Labour cost required"),
  hours_by_role: z.array(roleSchema),
  manual_notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ─── component ───────────────────────────────────────────────────────────────

export default function LabourManualEntryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { isSuperadmin, assignedRestaurants } = usePermissions();
  const { data: allRestaurants } = useRestaurants();
  const [overrideWarning, setOverrideWarning] = useState<string | null>(null);

  const accessibleRestaurants = isSuperadmin
    ? allRestaurants
    : allRestaurants?.filter((r) => assignedRestaurants.includes(r.id));

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      restaurant_id: accessibleRestaurants?.[0]?.id ?? "",
      date: format(new Date(), "yyyy-MM-dd"),
      total_hours: undefined,
      scheduled_hours: undefined,
      overtime_hours: undefined,
      total_cost: undefined,
      hours_by_role: [],
      manual_notes: "",
    },
  });

  const { fields: roleFields, append: appendRole, remove: removeRole } = useFieldArray({
    control,
    name: "hours_by_role",
  });

  const watchedDate = watch("date");
  const watchedRestaurant = watch("restaurant_id");
  const watchedCost = watch("total_cost");

  // Check for existing labour data
  const { data: existingData } = useQuery({
    queryKey: ["labour-existing", watchedRestaurant, watchedDate],
    queryFn: async () => {
      if (!watchedRestaurant || !watchedDate) return null;
      const { data } = await supabase
        .from("labour_daily")
        .select("id, source, total_cost, total_hours, labour_percent")
        .eq("restaurant_id", watchedRestaurant)
        .eq("date", watchedDate)
        .maybeSingle();
      return data;
    },
    enabled: !!watchedRestaurant && !!watchedDate,
  });

  // Fetch sales data to auto-calculate labour %
  const { data: salesData } = useQuery({
    queryKey: ["sales-for-labour-pct", watchedRestaurant, watchedDate],
    queryFn: async () => {
      if (!watchedRestaurant || !watchedDate) return null;
      const { data } = await supabase
        .from("sales_daily")
        .select("total_sales")
        .eq("restaurant_id", watchedRestaurant)
        .eq("date", watchedDate)
        .maybeSingle();
      return data;
    },
    enabled: !!watchedRestaurant && !!watchedDate,
  });

  const isOverride = !!existingData;
  const existingSource = existingData?.source;

  const totalSalesForDay = salesData ? Number(salesData.total_sales) : 0;
  const labourPct =
    totalSalesForDay > 0 && watchedCost > 0
      ? (watchedCost / totalSalesForDay) * 100
      : null;

  const submitMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!profile) throw new Error("Not authenticated");

      const source = isOverride ? "override" : "manual";
      const computedLabourPct =
        totalSalesForDay > 0 && formData.total_cost > 0
          ? Math.round((formData.total_cost / totalSalesForDay) * 10000) / 100
          : 0;

      const payload = {
        restaurant_id: formData.restaurant_id,
        date: formData.date,
        total_hours: formData.total_hours,
        scheduled_hours: formData.scheduled_hours ?? null,
        overtime_hours: formData.overtime_hours ?? null,
        total_cost: formData.total_cost,
        labour_percent: computedLabourPct,
        hours_by_role: formData.hours_by_role.length > 0 ? formData.hours_by_role : null,
        manual_notes: formData.manual_notes || null,
        entered_by: profile.id,
        source,
      };

      const { error } = await supabase
        .from("labour_daily")
        .upsert(payload, { onConflict: "restaurant_id,date" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isOverride ? "Labour data overridden" : "Labour data saved");
      queryClient.invalidateQueries({ queryKey: ["labour-report"] });
      queryClient.invalidateQueries({ queryKey: ["snapshot-labour"] });
      queryClient.invalidateQueries({ queryKey: ["sparkline-labour"] });
      queryClient.invalidateQueries({ queryKey: ["labour-today"] });
      navigate("/reports/labour");
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
          onClick={() => navigate("/reports/labour")}
          className="rounded-lg p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Users className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Manual Labour Entry</h1>
          <p className="text-sm text-muted-foreground">
            Enter or override labour data for any restaurant and date
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-6">
        {/* ── Override warning ─────────────────────────────────────────── */}
        {isOverride && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-500">
                Labour data already exists for this date
              </p>
              <p className="text-xs text-amber-500/80 mt-1">
                Source: <strong>{existingSource}</strong> — Hours:{" "}
                <strong>{Number(existingData.total_hours).toFixed(1)}h</strong> — Cost:{" "}
                <strong>{formatCurrency(Number(existingData.total_cost))}</strong> — Labour %:{" "}
                <strong>{formatPercent(Number(existingData.labour_percent))}</strong>.
                Saving will mark this as &quot;override&quot;.
              </p>
              {overrideWarning && (
                <p className="text-xs font-semibold text-amber-500 mt-2">
                  Click Save again to confirm the override.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Labour % auto-calc info ───────────────────────────────────── */}
        {totalSalesForDay > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
            <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-500">
              Sales data found: <strong>{formatCurrency(totalSalesForDay)}</strong>.
              Labour % will be auto-calculated.
              {labourPct !== null && (
                <>
                  {" "}
                  Current estimate:{" "}
                  <strong
                    className={cn(
                      labourPct >= 35
                        ? "text-red-500"
                        : labourPct >= 30
                        ? "text-amber-500"
                        : "text-green-500"
                    )}
                  >
                    {formatPercent(labourPct)}
                  </strong>
                </>
              )}
            </p>
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

        {/* ── Hours & Cost ──────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-base font-semibold">Hours & Cost</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Actual Hours</label>
              <input
                type="number"
                step="0.1"
                min="0"
                {...register("total_hours")}
                placeholder="0.0"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.total_hours && (
                <p className="text-xs text-destructive">{errors.total_hours.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Scheduled Hours{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                {...register("scheduled_hours")}
                placeholder="0.0"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Labour Cost ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("total_cost")}
                placeholder="0.00"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {errors.total_cost && (
                <p className="text-xs text-destructive">{errors.total_cost.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Overtime Hours{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                {...register("overtime_hours")}
                placeholder="0.0"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Labour % auto-display */}
          {labourPct !== null && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-3">
              <span className="text-xs text-muted-foreground">Calculated Labour %:</span>
              <span
                className={cn(
                  "text-sm font-semibold",
                  labourPct >= 35
                    ? "text-red-500"
                    : labourPct >= 30
                    ? "text-amber-500"
                    : "text-green-500"
                )}
              >
                {formatPercent(labourPct)}
              </span>
              <span className="text-xs text-muted-foreground">
                (target: &lt;30%)
              </span>
            </div>
          )}
        </div>

        {/* ── Hours by Role ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Hours by Role</h2>
            <button
              type="button"
              onClick={() => appendRole({ role: "", hours: 0 })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add Role
            </button>
          </div>
          {roleFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Optionally break down hours by role (e.g. Cashier, Kitchen, Manager).
            </p>
          ) : (
            <div className="space-y-2">
              {roleFields.map((field, i) => (
                <div key={field.id} className="flex items-center gap-3">
                  <input
                    {...register(`hours_by_role.${i}.role`)}
                    placeholder="Role (e.g. Kitchen)"
                    className="flex-1 h-9 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    {...register(`hours_by_role.${i}.hours`)}
                    placeholder="Hours"
                    className="w-28 h-9 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => removeRole(i)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Notes ─────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-2">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            {...register("manual_notes")}
            rows={3}
            placeholder="Any notes about this entry…"
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/reports/labour")}
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
              : "Save Labour Data"}
          </button>
        </div>
      </form>
    </div>
  );
}
