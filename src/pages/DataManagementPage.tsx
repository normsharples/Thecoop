import { useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, parseISO } from "date-fns";
import { toast } from "sonner";
import { Database, Users, Loader2, Trash2, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import { cn, formatCurrency } from "@/lib/utils";
import type { WeeklyLabour } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

const WEEK_OPTS = { weekStartsOn: 1 as const };

function toMonday(dateStr: string): string {
  return format(startOfWeek(parseISO(dateStr), WEEK_OPTS), "yyyy-MM-dd");
}

// ─── Weekly Labour ─────────────────────────────────────────────────────────────

const labourSchema = z.object({
  restaurant_id: z.string().min(1, "Select a restaurant"),
  week_start: z.string().min(1, "Select a week"),
  actual_labour: z.coerce.number().min(0, "Must be ≥ 0"),
  payroll_tax: z.coerce.number().min(0, "Must be ≥ 0"),
  overtime: z.coerce.number().min(0, "Must be ≥ 0"),
  penalty_rates: z.coerce.number().min(0, "Must be ≥ 0"),
  notes: z.string().optional(),
});
type LabourFormValues = z.infer<typeof labourSchema>;

function WeeklyLabourTab() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { isSuperadmin, assignedRestaurants } = usePermissions();
  const { data: allRestaurants = [] } = useRestaurants();

  const restaurants = useMemo(
    () => (isSuperadmin ? allRestaurants : allRestaurants.filter((r) => assignedRestaurants.includes(r.id))),
    [isSuperadmin, allRestaurants, assignedRestaurants]
  );

  const {
    register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting },
  } = useForm<LabourFormValues>({
    resolver: zodResolver(labourSchema) as Resolver<LabourFormValues>,
    defaultValues: {
      restaurant_id: "",
      week_start: format(startOfWeek(new Date(), WEEK_OPTS), "yyyy-MM-dd"),
      actual_labour: 0, payroll_tax: 0, overtime: 0, penalty_rates: 0, notes: "",
    },
  });

  const restaurantId = watch("restaurant_id");
  const weekStart = watch("week_start");
  const total =
    (Number(watch("actual_labour")) || 0) +
    (Number(watch("payroll_tax")) || 0) +
    (Number(watch("overtime")) || 0) +
    (Number(watch("penalty_rates")) || 0);

  const { data: entries = [], isLoading } = useQuery<WeeklyLabour[]>({
    queryKey: ["weekly_labour", restaurantId || "all"],
    queryFn: async () => {
      let q = supabase.from("weekly_labour").select("*").order("week_start", { ascending: false }).limit(26);
      if (restaurantId) q = q.eq("restaurant_id", restaurantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WeeklyLabour[];
    },
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: async (values: LabourFormValues) => {
      if (!profile) throw new Error("Not authenticated");
      const payload = {
        restaurant_id: values.restaurant_id,
        week_start: toMonday(values.week_start),
        actual_labour: values.actual_labour,
        payroll_tax: values.payroll_tax,
        overtime: values.overtime,
        penalty_rates: values.penalty_rates,
        notes: values.notes?.trim() || null,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      };
      // Upsert on (restaurant_id, week_start) so re-entering a week overwrites it.
      const { error } = await supabase
        .from("weekly_labour")
        .upsert(payload, { onConflict: "restaurant_id,week_start" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Weekly labour saved");
      queryClient.invalidateQueries({ queryKey: ["weekly_labour"] });
      queryClient.invalidateQueries({ queryKey: ["pnl-weekly-labour"] });
      reset({
        restaurant_id: restaurantId,
        week_start: weekStart,
        actual_labour: 0, payroll_tax: 0, overtime: 0, penalty_rates: 0, notes: "",
      });
    },
    onError: (err) => toast.error("Failed to save: " + (err as Error).message),
  });

  const { mutate: remove } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("weekly_labour").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entry deleted");
      queryClient.invalidateQueries({ queryKey: ["weekly_labour"] });
      queryClient.invalidateQueries({ queryKey: ["pnl-weekly-labour"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function loadEntry(e: WeeklyLabour) {
    reset({
      restaurant_id: e.restaurant_id,
      week_start: e.week_start,
      actual_labour: e.actual_labour,
      payroll_tax: e.payroll_tax,
      overtime: e.overtime,
      penalty_rates: e.penalty_rates,
      notes: e.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    allRestaurants.forEach((r) => m.set(r.id, r.name));
    return m;
  }, [allRestaurants]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/20 p-3 flex gap-2 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <p>
          Enter processed payroll each week. These <strong>cost</strong> figures are the source of truth for the Labour
          section of the P&amp;L. Deputy remains the source of truth for hours. Re-entering a week overwrites it.
        </p>
      </div>

      <form onSubmit={handleSubmit((v) => save(v))} className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Restaurant <span className="text-destructive">*</span></Label>
            <Select value={restaurantId} onValueChange={(v) => setValue("restaurant_id", v, { shouldValidate: true })}>
              <SelectTrigger className={cn(errors.restaurant_id && "border-destructive")}>
                <SelectValue placeholder="Select restaurant" />
              </SelectTrigger>
              <SelectContent>
                {restaurants.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.restaurant_id && <p className="text-xs text-destructive">{errors.restaurant_id.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="week_start">Pay Week (Mon) <span className="text-destructive">*</span></Label>
            <Input id="week_start" type="date" {...register("week_start")}
              className={cn(errors.week_start && "border-destructive")} />
            <p className="text-[11px] text-muted-foreground">Any day works — it snaps to that week's Monday.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            ["actual_labour", "Actual Labour"],
            ["payroll_tax", "Payroll Tax"],
            ["overtime", "Overtime"],
            ["penalty_rates", "Penalty Rates"],
          ] as const).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={key}>{label}</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input id={key} type="number" step="0.01" min="0" className={cn("pl-7", errors[key] && "border-destructive")}
                  {...register(key)} />
              </div>
              {errors[key] && <p className="text-xs text-destructive">{errors[key]?.message}</p>}
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Total labour cost: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(total)}</span>
          </p>
          <Button type="submit" disabled={isSubmitting || isPending}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving</> : "Save Week"}
          </Button>
        </div>
      </form>

      {/* Recent entries */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Recent Weeks</h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No weekly labour entered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Week</th>
                  {!restaurantId && <th className="text-left px-4 py-2 font-medium">Restaurant</th>}
                  <th className="text-right px-4 py-2 font-medium">Actual</th>
                  <th className="text-right px-4 py-2 font-medium">Tax</th>
                  <th className="text-right px-4 py-2 font-medium">OT</th>
                  <th className="text-right px-4 py-2 font-medium">Penalty</th>
                  <th className="text-right px-4 py-2 font-medium">Total</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((e) => {
                  const t = e.actual_labour + e.payroll_tax + e.overtime + e.penalty_rates;
                  return (
                    <tr key={e.id} className="hover:bg-accent/30 cursor-pointer" onClick={() => loadEntry(e)}>
                      <td className="px-4 py-2.5 text-xs font-medium text-foreground">{format(parseISO(e.week_start), "d MMM yyyy")}</td>
                      {!restaurantId && <td className="px-4 py-2.5 text-xs text-muted-foreground">{nameById.get(e.restaurant_id) ?? "—"}</td>}
                      <td className="px-4 py-2.5 text-xs text-right tabular-nums">{formatCurrency(e.actual_labour)}</td>
                      <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(e.payroll_tax)}</td>
                      <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(e.overtime)}</td>
                      <td className="px-4 py-2.5 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(e.penalty_rates)}</td>
                      <td className="px-4 py-2.5 text-xs text-right tabular-nums font-semibold text-foreground">{formatCurrency(t)}</td>
                      <td className="px-4 py-2.5 text-right" onClick={(ev) => ev.stopPropagation()}>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this week?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Remove {nameById.get(e.restaurant_id) ?? "this"} labour for week of {format(parseISO(e.week_start), "d MMM yyyy")}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(e.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DataManagementPage() {
  const [tab, setTab] = useState("labour");

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Data Management</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Manually-entered figures that feed the reports. More data types can be added here over time.
      </p>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="labour"><Users className="h-3.5 w-3.5 mr-1.5" /> Weekly Labour</TabsTrigger>
        </TabsList>
        <TabsContent value="labour" className="pt-4">
          <WeeklyLabourTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
