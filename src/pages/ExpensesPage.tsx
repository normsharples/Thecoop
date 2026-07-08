import { useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  isWithinInterval,
  parseISO,
} from "date-fns";
import {
  Wallet,
  Repeat,
  PlusCircle,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// ─── Types ───────────────────────────────────────────────────────────────────

type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

interface RecurringExpense {
  id: string;
  restaurant_id: string;
  name: string;
  category: string | null;
  amount: number;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  active: boolean;
  notes: string | null;
  created_at: string;
}

interface Expense {
  id: string;
  restaurant_id: string;
  category: string | null;
  description: string;
  amount: number;
  expense_date: string;
  notes: string | null;
  created_at: string;
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

// Normalises any frequency to a monthly-equivalent figure for the summary card.
function monthlyEquivalent(amount: number, frequency: Frequency) {
  switch (frequency) {
    case "weekly": return amount * (52 / 12);
    case "monthly": return amount;
    case "quarterly": return amount / 3;
    case "yearly": return amount / 12;
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const recurringSchema = z.object({
  name: z.string().min(1, "Required"),
  category: z.string().optional(),
  amount: z.coerce.number().positive("Must be > 0"),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  start_date: z.string().min(1, "Required"),
  end_date: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean(),
});
type RecurringFormValues = z.infer<typeof recurringSchema>;

const expenseSchema = z.object({
  category: z.string().optional(),
  description: z.string().min(1, "Required"),
  amount: z.coerce.number().positive("Must be > 0"),
  expense_date: z.string().min(1, "Required"),
  notes: z.string().optional(),
});
type ExpenseFormValues = z.infer<typeof expenseSchema>;

// ─── Week helpers ────────────────────────────────────────────────────────────

const WEEK_OPTS = { weekStartsOn: 1 as const };

function weekRange(anchor: Date) {
  return { start: startOfWeek(anchor, WEEK_OPTS), end: endOfWeek(anchor, WEEK_OPTS) };
}
function weekLabel(anchor: Date) {
  const { start, end } = weekRange(anchor);
  return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
}

const COMMON_CATEGORIES = ["Rent", "Utilities", "Insurance", "Marketing", "Software", "Bank Fees", "Repairs & Maintenance", "Admin", "Other"];

// ─── Recurring Expense Dialog ────────────────────────────────────────────────

function RecurringExpenseDialog({
  open, onClose, restaurantId, initial,
}: {
  open: boolean; onClose: () => void; restaurantId: string; initial?: RecurringExpense;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!initial;

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<RecurringFormValues>({
      resolver: zodResolver(recurringSchema) as Resolver<RecurringFormValues>,
      defaultValues: {
        name: initial?.name ?? "",
        category: initial?.category ?? "",
        amount: initial?.amount ?? 0,
        frequency: initial?.frequency ?? "monthly",
        start_date: initial?.start_date ?? format(new Date(), "yyyy-MM-dd"),
        end_date: initial?.end_date ?? "",
        notes: initial?.notes ?? "",
        active: initial?.active ?? true,
      },
    });

  const activeVal = watch("active");
  const frequencyVal = watch("frequency");

  const { mutate: save } = useMutation({
    mutationFn: async (values: RecurringFormValues) => {
      const payload = {
        restaurant_id: restaurantId,
        name: values.name.trim(),
        category: values.category?.trim() || null,
        amount: values.amount,
        frequency: values.frequency,
        start_date: values.start_date,
        end_date: values.end_date || null,
        notes: values.notes?.trim() || null,
        active: values.active,
      };
      if (isEdit && initial) {
        const { error } = await supabase.from("recurring_expenses").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("recurring_expenses").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Recurring expense updated" : "Recurring expense added");
      queryClient.invalidateQueries({ queryKey: ["recurring_expenses"] });
      reset();
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Recurring Expense" : "Add Recurring Expense"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                placeholder="e.g. Shop Rent, Electricity, Public Liability Insurance"
                {...register("name")}
                className={cn(errors.name && "border-destructive")}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input id="category" list="expense-categories" placeholder="e.g. Rent" {...register("category")} />
              <datalist id="expense-categories">
                {COMMON_CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount <span className="text-destructive">*</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="amount" type="number" step="0.01" min="0" className={cn("pl-7", errors.amount && "border-destructive")}
                  {...register("amount")}
                />
              </div>
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={frequencyVal} onValueChange={(v) => setValue("frequency", v as Frequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["weekly", "monthly", "quarterly", "yearly"] as Frequency[]).map((f) => (
                    <SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="start_date">Start Date <span className="text-destructive">*</span></Label>
              <Input id="start_date" type="date" {...register("start_date")}
                className={cn(errors.start_date && "border-destructive")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="end_date">End Date</Label>
              <Input id="end_date" type="date" {...register("end_date")} />
              <p className="text-[11px] text-muted-foreground">Leave blank if ongoing</p>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={2} placeholder="Account number, provider, due date, etc." {...register("notes")} />
            </div>

            <div className="col-span-2 flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">Only active expenses are included in the P&amp;L</p>
              </div>
              <Switch checked={activeVal} onCheckedChange={(v) => setValue("active", v)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : isEdit ? "Save Changes" : "Add Recurring Expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Recurring Expense Row ───────────────────────────────────────────────────

function RecurringExpenseRow({ expense, onEdit }: { expense: RecurringExpense; onEdit: () => void }) {
  const queryClient = useQueryClient();

  const { mutate: toggleActive } = useMutation({
    mutationFn: async (active: boolean) => {
      const { error } = await supabase.from("recurring_expenses").update({ active }).eq("id", expense.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(expense.active ? "Marked inactive" : "Marked active");
      queryClient.invalidateQueries({ queryKey: ["recurring_expenses"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const { mutate: deleteExpense } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("recurring_expenses").delete().eq("id", expense.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recurring expense deleted");
      queryClient.invalidateQueries({ queryKey: ["recurring_expenses"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className={cn("flex items-start gap-3 px-4 py-3", !expense.active && "opacity-60")}>
      <div className="mt-0.5 shrink-0">
        {expense.active
          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
          : <XCircle className="h-4 w-4 text-muted-foreground" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{expense.name}</span>
          {expense.category && <Badge variant="outline" className="text-xs py-0">{expense.category}</Badge>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{formatCurrency(expense.amount)} · {FREQUENCY_LABELS[expense.frequency]}</span>
          <span className="text-xs text-muted-foreground">
            from {format(parseISO(expense.start_date), "d MMM yyyy")}
            {expense.end_date && ` to ${format(parseISO(expense.end_date), "d MMM yyyy")}`}
          </span>
        </div>
        {expense.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{expense.notes}</p>}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => toggleActive(!expense.active)}
          className="rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-xs"
        >
          {expense.active ? "Deactivate" : "Activate"}
        </button>
        <button onClick={onEdit} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
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
              <AlertDialogTitle>Delete recurring expense?</AlertDialogTitle>
              <AlertDialogDescription>
                Permanently deletes <span className="font-medium text-foreground">{expense.name}</span> ({formatCurrency(expense.amount)} {FREQUENCY_LABELS[expense.frequency].toLowerCase()}). It will stop being included in the P&amp;L.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteExpense()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringExpense | undefined>(undefined);

  const { profile } = useAuth();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const queryClient = useQueryClient();

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const isAllRestaurants = !selectedRestaurantId;
  const allRestaurantIds = restaurants.map((r) => r.id);
  const { start: weekStart, end: weekEnd } = weekRange(weekAnchor);

  // ── Recurring expenses ──────────────────────────────────────────────────────
  const { data: recurring = [], isLoading: recurringLoading } = useQuery<RecurringExpense[]>({
    queryKey: ["recurring_expenses", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("recurring_expenses").select("*").order("name");
      if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
      else if (allRestaurantIds.length > 0) q = q.in("restaurant_id", allRestaurantIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RecurringExpense[];
    },
    enabled: selectedRestaurantId ? true : allRestaurantIds.length > 0,
  });

  const estimatedMonthly = useMemo(
    () => recurring.filter((r) => r.active).reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0),
    [recurring]
  );

  // ── One-off expenses ─────────────────────────────────────────────────────────
  const { data: expenses = [], isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ["expenses", selectedRestaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("expenses").select("*").order("expense_date", { ascending: false });
      if (selectedRestaurantId) q = q.eq("restaurant_id", selectedRestaurantId);
      else if (allRestaurantIds.length > 0) q = q.in("restaurant_id", allRestaurantIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Expense[];
    },
    enabled: selectedRestaurantId ? true : allRestaurantIds.length > 0,
  });

  const weekExpenses = useMemo(
    () => expenses.filter((e) => isWithinInterval(parseISO(e.expense_date), { start: weekStart, end: weekEnd })),
    [expenses, weekStart, weekEnd]
  );
  const weekTotal = weekExpenses.reduce((s, e) => s + e.amount, 0);

  // ── One-off expense form ─────────────────────────────────────────────────────
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema) as Resolver<ExpenseFormValues>,
    defaultValues: {
      category: "", description: "", amount: 0,
      expense_date: format(new Date(), "yyyy-MM-dd"), notes: "",
    },
  });

  const { mutate: addExpense, isPending } = useMutation({
    mutationFn: async (values: ExpenseFormValues) => {
      if (!selectedRestaurantId || !profile) throw new Error("Not authenticated");
      const { error } = await supabase.from("expenses").insert({
        restaurant_id: selectedRestaurantId,
        category: values.category?.trim() || null,
        description: values.description.trim(),
        amount: values.amount,
        expense_date: values.expense_date,
        notes: values.notes?.trim() || null,
        created_by: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense added");
      reset({ category: "", description: "", amount: 0, expense_date: format(weekAnchor, "yyyy-MM-dd"), notes: "" });
      setShowExpenseForm(false);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err) => toast.error("Failed to save: " + (err as Error).message),
  });

  const { mutate: deleteExpense } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense deleted");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err) => toast.error("Failed to delete: " + (err as Error).message),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Expenses</h2>
          <span className="text-sm text-muted-foreground">— {restaurant?.name ?? "All Restaurants"}</span>
        </div>
      </div>

      {isAllRestaurants && (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Select a specific restaurant to add expenses.
        </div>
      )}

      {/* ── Recurring Expenses ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Recurring Expenses</h3>
            <span className="text-xs text-muted-foreground hidden sm:inline">— rent, utilities, insurance, subscriptions</span>
          </div>
          {!isAllRestaurants && (
            <Button size="sm" onClick={() => { setEditingRecurring(undefined); setRecurringDialogOpen(true); }}>
              <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
              Add Recurring
            </Button>
          )}
        </div>

        {estimatedMonthly > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border-b border-border">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <p className="text-xs text-foreground">
              Estimated monthly overhead: <span className="font-semibold">{formatCurrency(estimatedMonthly)}</span>
              <span className="text-muted-foreground"> (active recurring expenses, normalised to a month)</span>
            </p>
          </div>
        )}

        {recurringLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : recurring.length === 0 ? (
          <div className="p-8 text-center">
            <Repeat className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No recurring expenses set up yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recurring.map((r) => (
              <RecurringExpenseRow
                key={r.id}
                expense={r}
                onEdit={() => { setEditingRecurring(r); setRecurringDialogOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── One-off Expenses ────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            One-off Expenses
          </h3>
          {!isAllRestaurants && (
            <Button size="sm" onClick={() => setShowExpenseForm((v) => !v)}>
              <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
              Add Expense
            </Button>
          )}
        </div>

        {showExpenseForm && !isAllRestaurants && (
          <div className="rounded-xl border border-border bg-card p-5">
            <form onSubmit={handleSubmit((v) => addExpense(v))} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
                  <Input
                    id="description" placeholder="e.g. Emergency plumber call-out"
                    {...register("description")}
                    className={cn(errors.description && "border-destructive")}
                  />
                  {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" list="expense-categories-oneoff" placeholder="e.g. Repairs & Maintenance" {...register("category")} />
                  <datalist id="expense-categories-oneoff">
                    {COMMON_CATEGORIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense_date">Date</Label>
                  <Input id="expense_date" type="date" {...register("expense_date")}
                    className={cn(errors.expense_date && "border-destructive")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input id="amount" type="number" step="0.01" min="0" placeholder="0.00" className={cn("pl-7", errors.amount && "border-destructive")}
                      {...register("amount")} />
                  </div>
                  {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Input id="notes" placeholder="e.g. Invoice #204" {...register("notes")} />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : "Save Expense"}</Button>
                <Button type="button" variant="outline" onClick={() => { setShowExpenseForm(false); reset(); }}>Cancel</Button>
              </div>
            </form>
          </div>
        )}

        {/* Week navigator */}
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekAnchor((d) => subWeeks(d, 1))} className="rounded-lg border border-border bg-card p-1.5 hover:bg-accent transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm font-medium text-foreground min-w-[200px] text-center">{weekLabel(weekAnchor)}</span>
          <button onClick={() => setWeekAnchor((d) => addWeeks(d, 1))} className="rounded-lg border border-border bg-card p-1.5 hover:bg-accent transition-colors">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {expensesLoading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : weekExpenses.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Wallet className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No one-off expenses for this week.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="divide-y divide-border">
              {weekExpenses.map((e) => {
                const eRestaurant = restaurants.find((r) => r.id === e.restaurant_id);
                return (
                  <div key={e.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-foreground">{e.description}</p>
                        {e.category && <Badge variant="outline" className="text-xs py-0">{e.category}</Badge>}
                        {isAllRestaurants && eRestaurant && (
                          <span className="text-xs font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">{eRestaurant.name}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(e.expense_date), "d MMM yyyy")}{e.notes && ` · ${e.notes}`}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">{formatCurrency(e.amount)}</p>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete expense?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Permanently deletes the <span className="font-medium text-foreground">{formatCurrency(e.amount)}</span> expense for{" "}
                            <span className="font-medium text-foreground">{e.description}</span>.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteExpense(e.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-t border-border">
              <p className="text-xs font-medium text-muted-foreground">
                {weekExpenses.length} expense{weekExpenses.length !== 1 ? "s" : ""} this week
              </p>
              <p className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(weekTotal)}</p>
            </div>
          </div>
        )}
      </div>

      {!isAllRestaurants && (
        <RecurringExpenseDialog
          open={recurringDialogOpen}
          onClose={() => { setRecurringDialogOpen(false); setEditingRecurring(undefined); }}
          restaurantId={selectedRestaurantId!}
          initial={editingRecurring}
        />
      )}
    </div>
  );
}
