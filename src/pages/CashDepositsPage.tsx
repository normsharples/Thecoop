import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Banknote, PlusCircle, Clock, CheckCircle2, AlertCircle, Trash2, Calculator } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useCashUps, DENOMINATIONS, tillTotalFromCounts } from "@/hooks/useCashUps";
import { cn, formatCurrency } from "@/lib/utils";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import type { CashOutItem } from "@/types";

export default function CashDepositsPage() {
  const { isStaff } = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);

  if (!selectedRestaurantId) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">Select a restaurant to continue.</p>
      </div>
    );
  }

  // Staff log a daily till reconciliation instead of bank deposits — they
  // can't create or view cash_deposits records (RLS-enforced, migration 022).
  if (isStaff) {
    return <CashUpView restaurantId={selectedRestaurantId} restaurantName={restaurant?.name} />;
  }

  return <AdminCashDepositsView restaurantId={selectedRestaurantId} restaurantName={restaurant?.name} />;
}

// ── Daily Cash Up (staff) ───────────────────────────────────────────────────

function CashUpView({ restaurantId, restaurantName }: { restaurantId: string; restaurantName?: string }) {
  const [activeTab, setActiveTab] = useState<"record" | "history">("record");
  const { cashUps, isLoading, upsert, isUpserting } = useCashUps(restaurantId);

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [denominationCounts, setDenominationCounts] = useState<Record<string, string>>({});
  const [amountDeposited, setAmountDeposited] = useState("");
  const [posExpected, setPosExpected] = useState("");
  const [cashOuts, setCashOuts] = useState<CashOutItem[]>([]);
  const [notes, setNotes] = useState("");

  const FLOAT_AMOUNT = 200;
  const parsedCounts = Object.fromEntries(
    Object.entries(denominationCounts).map(([k, v]) => [k, parseInt(v, 10) || 0])
  );
  const tillCountNum = tillTotalFromCounts(parsedCounts);
  const amountToBank = Math.max(0, tillCountNum - FLOAT_AMOUNT);
  const cashOutsTotal = cashOuts.reduce((sum, c) => sum + (c.amount || 0), 0);

  function updateDenominationCount(key: string, value: string) {
    setDenominationCounts((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setDate(format(new Date(), "yyyy-MM-dd"));
    setDenominationCounts({});
    setAmountDeposited("");
    setPosExpected("");
    setCashOuts([]);
    setNotes("");
  }

  function addCashOut() {
    setCashOuts((prev) => [...prev, { description: "", amount: 0 }]);
  }

  function updateCashOut(index: number, field: "description" | "amount", value: string) {
    setCashOuts((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, [field]: field === "amount" ? parseFloat(value) || 0 : value } : c
      )
    );
  }

  function removeCashOut(index: number) {
    setCashOuts((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    try {
      await upsert({
        restaurant_id: restaurantId,
        cash_up_date: date,
        denomination_counts: parsedCounts,
        amount_deposited: parseFloat(amountDeposited) || 0,
        pos_expected_deposit: parseFloat(posExpected) || 0,
        cash_outs: cashOuts.filter((c) => c.description.trim() || c.amount),
        notes: notes.trim() || null,
      });
      toast.success("Cash up saved");
      resetForm();
      setActiveTab("history");
    } catch (err) {
      toast.error("Failed to save cash up: " + (err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Daily Cash Up</h2>
        {restaurantName && <span className="text-sm text-muted-foreground">— {restaurantName}</span>}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        <button
          onClick={() => setActiveTab("record")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "record"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <PlusCircle className="h-3.5 w-3.5" />
          Record Cash Up
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "history"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          History
        </button>
      </div>

      {activeTab === "record" && (
        <div className="rounded-xl border border-border bg-card p-6 max-w-lg space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="cash_up_date">Date</Label>
            <Input
              id="cash_up_date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Till counter */}
          <div className="rounded-lg border border-border bg-background p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Till Counter
            </p>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</p>
                {DENOMINATIONS.filter((d) => d.type === "note").map((d) => (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-10 text-sm text-foreground">{d.label}</span>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      className="h-8 text-sm"
                      value={denominationCounts[d.key] ?? ""}
                      onChange={(e) => updateDenominationCount(d.key, e.target.value)}
                    />
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(((parseInt(denominationCounts[d.key], 10) || 0) * d.cents) / 100)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Coins</p>
                {DENOMINATIONS.filter((d) => d.type === "coin").map((d) => (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-10 text-sm text-foreground">{d.label}</span>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      className="h-8 text-sm"
                      value={denominationCounts[d.key] ?? ""}
                      onChange={(e) => updateDenominationCount(d.key, e.target.value)}
                    />
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(((parseInt(denominationCounts[d.key], 10) || 0) * d.cents) / 100)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Till total</span>
              <span className="font-semibold tabular-nums text-foreground">{formatCurrency(tillCountNum)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Less $200 float</span>
              <span className="font-semibold tabular-nums text-foreground">{formatCurrency(amountToBank)} to bank</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pos_expected">POS Expected Deposit</Label>
            <p className="text-xs text-muted-foreground">What the POS system expects should be banked today.</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="pos_expected"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="pl-7"
                value={posExpected}
                onChange={(e) => setPosExpected(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount_deposited">Amount Deposited</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="amount_deposited"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="pl-7"
                value={amountDeposited}
                onChange={(e) => setAmountDeposited(e.target.value)}
              />
            </div>
          </div>

          {/* Cash outs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Cash Outs</Label>
              <button
                type="button"
                onClick={addCashOut}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Add Cash Out
              </button>
            </div>
            {cashOuts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No cash outs recorded for this day.</p>
            ) : (
              <div className="space-y-2">
                {cashOuts.map((cashOut, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="Description"
                      value={cashOut.description}
                      onChange={(e) => updateCashOut(i, "description", e.target.value)}
                      className="flex-1"
                    />
                    <div className="relative w-28 shrink-0">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="pl-7"
                        value={cashOut.amount || ""}
                        onChange={(e) => updateCashOut(i, "amount", e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCashOut(i)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                  <span>Total cash outs</span>
                  <span className="font-medium tabular-nums">{formatCurrency(cashOutsTotal)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cash_up_notes">Notes</Label>
            <Textarea
              id="cash_up_notes"
              placeholder="Any additional details..."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button onClick={handleSave} disabled={isUpserting} className="w-full">
            {isUpserting ? "Saving..." : "Save Cash Up"}
          </Button>
        </div>
      )}

      {activeTab === "history" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          ) : cashUps.length === 0 ? (
            <div className="p-12 text-center">
              <Calculator className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No cash ups recorded yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Till Count</TableHead>
                  <TableHead className="text-right">To Bank</TableHead>
                  <TableHead className="text-right">POS Expected</TableHead>
                  <TableHead className="text-right">Deposited</TableHead>
                  <TableHead className="text-right">Cash Outs</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashUps.map((cu) => {
                  const expected = Math.max(0, cu.till_count - cu.float_amount);
                  const outsTotal = cu.cash_outs.reduce((s, c) => s + c.amount, 0);
                  return (
                    <TableRow key={cu.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {format(new Date(cu.cash_up_date + "T00:00:00"), "d MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(cu.till_count)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(expected)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {cu.pos_expected_deposit > 0 ? formatCurrency(cu.pos_expected_deposit) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatCurrency(cu.amount_deposited)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {outsTotal > 0 ? formatCurrency(outsTotal) : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px]">
                        <span className="truncate block">{cu.notes ?? "—"}</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bank deposits (managers and above) ──────────────────────────────────────

type Tab = "record" | "history";

const depositSchema = z.object({
  deposit_date: z.string().min(1, "Date is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  bank_account_id: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type DepositFormValues = z.infer<typeof depositSchema>;

interface BankAccount {
  id: string;
  bank_name: string;
  account_name: string;
}

interface CashDeposit {
  id: string;
  restaurant_id: string;
  deposit_date: string;
  amount: number;
  bank_account_id: string | null;
  reference: string | null;
  notes: string | null;
  deposited_by: string | null;
  verified: boolean;
  created_at: string;
}

interface ProfileRow {
  id: string;
  full_name: string;
}

function AdminCashDepositsView({ restaurantId, restaurantName }: { restaurantId: string; restaurantName?: string }) {
  const [activeTab, setActiveTab] = useState<Tab>("record");
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["bank-accounts", restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name")
        .eq("restaurant_id", restaurantId)
        .order("bank_name");
      if (error) throw error;
      return (data ?? []) as BankAccount[];
    },
    enabled: !!restaurantId,
  });

  const { data: deposits = [], isLoading: depositsLoading } = useQuery<CashDeposit[]>({
    queryKey: ["cash-deposits", restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_deposits")
        .select("id, restaurant_id, deposit_date, amount, bank_account_id, reference, notes, deposited_by, verified, created_at")
        .eq("restaurant_id", restaurantId)
        .order("deposit_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CashDeposit[];
    },
    enabled: !!restaurantId,
  });

  const { data: profiles = [] } = useQuery<ProfileRow[]>({
    queryKey: ["profiles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const profileMap = new Map(profiles.map((p) => [p.id, p.full_name]));
  const bankAccountMap = new Map(bankAccounts.map((b) => [b.id, `${b.bank_name} — ${b.account_name}`]));

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<DepositFormValues>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      deposit_date: format(new Date(), "yyyy-MM-dd"),
      amount: undefined,
      bank_account_id: "",
      reference: "",
      notes: "",
    },
  });

  const { mutate: recordDeposit, isPending } = useMutation({
    mutationFn: async (values: DepositFormValues) => {
      if (!profile) throw new Error("Not authenticated");
      const { error } = await supabase.from("cash_deposits").insert({
        restaurant_id: restaurantId,
        deposit_date: values.deposit_date,
        amount: values.amount,
        bank_account_id: values.bank_account_id || null,
        reference: values.reference || null,
        notes: values.notes || null,
        deposited_by: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deposit recorded successfully");
      reset({
        deposit_date: format(new Date(), "yyyy-MM-dd"),
        amount: undefined,
        bank_account_id: "",
        reference: "",
        notes: "",
      });
      queryClient.invalidateQueries({ queryKey: ["cash-deposits", restaurantId] });
      setActiveTab("history");
    },
    onError: (err) => {
      toast.error("Failed to record deposit: " + (err as Error).message);
    },
  });

  const { mutate: deleteDeposit } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cash_deposits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deposit deleted");
      queryClient.invalidateQueries({ queryKey: ["cash-deposits", restaurantId] });
    },
    onError: (err) => {
      toast.error("Failed to delete deposit: " + (err as Error).message);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Banknote className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Cash &amp; Deposits</h2>
        {restaurantName && (
          <span className="text-sm text-muted-foreground">— {restaurantName}</span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        <button
          onClick={() => setActiveTab("record")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "record"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <PlusCircle className="h-3.5 w-3.5" />
          Record Deposit
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "history"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          History
          {deposits.length > 0 && (
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {deposits.length}
            </span>
          )}
        </button>
      </div>

      {/* Record Deposit Tab */}
      {activeTab === "record" && (
        <div className="rounded-xl border border-border bg-card p-6 max-w-lg">
          <form onSubmit={handleSubmit((v) => recordDeposit(v))} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {/* Date */}
              <div className="space-y-1.5">
                <Label htmlFor="deposit_date">Deposit Date</Label>
                <Input
                  id="deposit_date"
                  type="date"
                  {...register("deposit_date")}
                  className={cn(errors.deposit_date && "border-destructive")}
                />
                {errors.deposit_date && (
                  <p className="text-xs text-destructive">{errors.deposit_date.message}</p>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount (AUD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    $
                  </span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className={cn("pl-7", errors.amount && "border-destructive")}
                    {...register("amount")}
                  />
                </div>
                {errors.amount && (
                  <p className="text-xs text-destructive">{errors.amount.message}</p>
                )}
              </div>
            </div>

            {/* Bank Account */}
            <div className="space-y-1.5">
              <Label>Bank Account</Label>
              {bankAccounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No bank accounts configured. Add them in Settings → Bank Accounts.
                </p>
              ) : (
                <Select
                  onValueChange={(val) =>
                    setValue("bank_account_id", val === "none" ? "" : val)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {bankAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.bank_name} — {acc.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Reference */}
            <div className="space-y-1.5">
              <Label htmlFor="reference">Reference / Bag Number</Label>
              <Input
                id="reference"
                placeholder="e.g. Deposit bag #42"
                {...register("reference")}
              />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Any additional details..."
                rows={3}
                {...register("notes")}
              />
            </div>

            {/* Deposited by */}
            <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Recording as{" "}
              <span className="font-medium text-foreground">{profile?.full_name}</span>
            </div>

            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Recording..." : "Record Deposit"}
            </Button>
          </form>
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {depositsLoading ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground">Loading deposits...</p>
            </div>
          ) : deposits.length === 0 ? (
            <div className="p-12 text-center">
              <Banknote className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No deposits recorded yet.</p>
              <button
                onClick={() => setActiveTab("record")}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Record the first deposit
              </button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Bank Account</TableHead>
                  <TableHead>Deposited By</TableHead>
                  <TableHead>Time Logged</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-center">Verified</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deposits.map((deposit) => (
                  <TableRow key={deposit.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {format(new Date(deposit.deposit_date + "T00:00:00"), "d MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(deposit.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {deposit.reference ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {deposit.bank_account_id
                        ? (bankAccountMap.get(deposit.bank_account_id) ?? "—")
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {deposit.deposited_by
                        ? (profileMap.get(deposit.deposited_by) ?? "Unknown")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                      {format(new Date(deposit.created_at), "d MMM yyyy, h:mm a")}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px]">
                      <span className="truncate block">{deposit.notes ?? "—"}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {deposit.verified ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                      )}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete deposit?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the{" "}
                              <span className="font-medium text-foreground">
                                {formatCurrency(deposit.amount)}
                              </span>{" "}
                              deposit recorded on{" "}
                              <span className="font-medium text-foreground">
                                {format(new Date(deposit.deposit_date + "T00:00:00"), "d MMM yyyy")}
                              </span>
                              . This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteDeposit(deposit.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
