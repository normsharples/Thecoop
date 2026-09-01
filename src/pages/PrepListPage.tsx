import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  ClipboardList,
  Clock,
  Boxes,
  CheckCircle2,
  Circle,
  Printer,
  History,
  Undo2,
  Search,
  CopyPlus,
  Eraser,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import {
  usePrepBoard,
  useSetPrepPlanItem,
  useCompletePrepPlanItem,
  useCopyPrepPlan,
  useClearPrepPlan,
  useSavePrepCheck,
  useProductionRuns,
  useVoidProductionRun,
  formatQty,
  recipeMediaUrl,
} from "@/hooks/useRecipes";
import { printPrepLabel } from "@/lib/prepLabel";
import { usePrinters, useReprintRun } from "@/hooks/usePrinters";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MakeBatchDialog, type MakeBatchTarget } from "@/components/recipes/MakeBatchDialog";
import type { PrepBoardRow } from "@/types";

function makeTarget(r: PrepBoardRow): MakeBatchTarget {
  return {
    recipeId: r.recipe_id,
    name: r.name,
    yieldQty: r.yield_qty,
    yieldUnit: r.yield_unit,
    isStocked: r.is_stocked,
    suggestedBatches:
      r.remaining != null && r.yield_qty > 0 ? r.remaining / r.yield_qty : null,
  };
}

export default function PrepListPage() {
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const { canViewSalesData } = usePermissions();

  // canViewSalesData is the manager tier — the same line the RPCs enforce.
  const canPlan = canViewSalesData;

  const { data: board = [], isLoading } = usePrepBoard(selectedRestaurantId);
  const { data: runs = [] } = useProductionRuns(selectedRestaurantId, undefined, 25);
  const voidRun = useVoidProductionRun();
  const reprint = useReprintRun();
  const { data: printers = [] } = usePrinters(selectedRestaurantId);
  const hasPrinter = printers.some((p) => p.active);
  const copyPlan = useCopyPrepPlan();
  const clearPlan = useClearPrepPlan();

  const [mode, setMode] = useState<"work" | "plan">("work");
  const [making, setMaking] = useState<MakeBatchTarget | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);
  const planned = useMemo(() => board.filter((r) => r.planned), [board]);
  const unplanned = useMemo(() => board.filter((r) => !r.planned), [board]);

  if (!selectedRestaurantId) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
        <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">Pick a venue</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The prep list is per venue — choose one in the switcher above.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Prep list</h2>
          <span className="text-sm text-muted-foreground">
            — {restaurant?.name} · {format(new Date(), "EEEE d MMM")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canPlan && (
            <div className="flex rounded-lg border border-border-strong p-0.5">
              {([
                { key: "work", label: "Work list" },
                { key: "plan", label: "Set today's prep" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setMode(t.key)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                    mode === t.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowHistory((v) => !v)}>
            <History className="mr-1.5 h-4 w-4" />
            {showHistory ? "Hide" : "Batches"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mode === "plan" && canPlan ? (
        <PlanMode
          board={board}
          restaurantId={selectedRestaurantId}
          onCopyYesterday={async () => {
            const n = await copyPlan.mutateAsync({ restaurantId: selectedRestaurantId });
            toast.success(
              n > 0
                ? `Copied ${n} line${n === 1 ? "" : "s"} from yesterday`
                : "Nothing on yesterday's list to copy"
            );
          }}
          onClear={async () => {
            const n = await clearPlan.mutateAsync({ restaurantId: selectedRestaurantId });
            toast.success(n > 0 ? `Cleared ${n} line${n === 1 ? "" : "s"}` : "Nothing to clear");
          }}
          busy={copyPlan.isPending || clearPlan.isPending}
        />
      ) : (
        <WorkList
          planned={planned}
          unplanned={unplanned}
          restaurantId={selectedRestaurantId}
          canPlan={canPlan}
          onPlan={() => setMode("plan")}
          onMake={(r) => setMaking(makeTarget(r))}
        />
      )}

      {showHistory && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold text-foreground">Recent batches</h3>
          </div>
          {runs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Nothing logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle">
                  <tr className="text-muted-foreground">
                    <th className="px-4 py-1.5 text-left font-medium">Made</th>
                    <th className="px-2 py-1.5 text-left font-medium">Recipe</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-2 py-1.5 text-left font-medium">By</th>
                    <th className="px-2 py-1.5 text-left font-medium">Use by</th>
                    <th className="px-4 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const short =
                      run.expected_qty != null && run.produced_qty != null
                        ? run.produced_qty - run.expected_qty
                        : 0;
                    return (
                      <tr
                        key={run.id}
                        className={cn("border-t border-border", run.voided_at && "opacity-50")}
                      >
                        <td className="whitespace-nowrap px-4 py-1.5 tabular-nums">
                          {format(parseISO(run.made_at), "d MMM HH:mm")}
                        </td>
                        <td className="px-2 py-1.5">
                          <Link
                            to={`/recipes/${run.recipe_id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {run.recipe?.name ?? "—"}
                          </Link>
                          {!run.posted && !run.voided_at && (
                            <Badge
                              variant="outline"
                              className="ml-2"
                              title="Not a stocked batch — nothing moves in the ledger"
                            >
                              not stocked
                            </Badge>
                          )}
                          {run.voided_at && (
                            <Badge variant="outline" className="ml-2">
                              voided
                            </Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {formatQty(run.produced_qty, run.produced_unit)}
                          {Math.abs(short) > 1e-9 && (
                            <span
                              className={cn(
                                "ml-1 text-xs",
                                short < 0 ? "text-destructive" : "text-success"
                              )}
                            >
                              {short > 0 ? "+" : ""}
                              {formatQty(short, run.produced_unit)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {run.made_by_name ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                          {run.use_by ? format(parseISO(run.use_by), "d MMM HH:mm") : "—"}
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              title={hasPrinter ? "Reprint label" : "Print label in this browser"}
                              onClick={() => {
                                if (!hasPrinter) {
                                  printPrepLabel({
                                    recipeName: run.recipe?.name ?? "Prep",
                                    venueName: restaurant?.name,
                                    madeAt: run.made_at,
                                    useBy: run.use_by,
                                    quantity: formatQty(run.produced_qty, run.produced_unit),
                                    madeBy: run.made_by_name,
                                  });
                                  return;
                                }
                                reprint.mutate(run.id, {
                                  onSuccess: () => toast.success("Label sent to the printer"),
                                  onError: (e) =>
                                    toast.error(e instanceof Error ? e.message : "Couldn't reprint"),
                                });
                              }}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            {!run.voided_at && (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Void this batch"
                                onClick={() =>
                                  voidRun.mutate(
                                    { runId: run.id, reason: "voided from the prep list" },
                                    {
                                      onSuccess: () => toast.success("Batch voided"),
                                      onError: (e) =>
                                        toast.error(
                                          e instanceof Error ? e.message : "Couldn't void that"
                                        ),
                                    }
                                  )
                                }
                              >
                                <Undo2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {making && (
        <MakeBatchDialog
          target={making}
          restaurantId={selectedRestaurantId}
          venueName={restaurant?.name}
          open
          onClose={() => setMaking(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work list — what the team sees
// ─────────────────────────────────────────────────────────────────────────────

function WorkList({
  planned,
  unplanned,
  restaurantId,
  canPlan,
  onPlan,
  onMake,
}: {
  planned: PrepBoardRow[];
  unplanned: PrepBoardRow[];
  restaurantId: string;
  canPlan: boolean;
  onPlan: () => void;
  onMake: (r: PrepBoardRow) => void;
}) {
  const complete = useCompletePrepPlanItem();
  const [showOther, setShowOther] = useState(false);

  const open = planned.filter((r) => !r.completed_at);
  const done = planned.filter((r) => r.completed_at);

  return (
    <div className="space-y-4">
      {planned.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Nothing set for today yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {canPlan
              ? "Set what needs prepping and the team will see it here."
              : "Your manager sets the list each morning. Check with them if it's empty."}
          </p>
          {canPlan && (
            <Button size="sm" className="mt-4" onClick={onPlan}>
              Set today's prep
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
              <h3 className="font-semibold text-foreground">To prep today</h3>
              <p className="text-xs text-muted-foreground tabular-nums">
                {done.length} of {planned.length} done
              </p>
            </div>
            {open.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Everything on today's list is done.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {open.map((r) => (
                  <WorkRow
                    key={r.recipe_id}
                    row={r}
                    onMake={onMake}
                    onToggle={(done) =>
                      complete.mutate({ restaurantId, recipeId: r.recipe_id, done })
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          {done.length > 0 && (
            <div className="rounded-xl border border-border bg-card opacity-75">
              <div className="border-b border-border px-4 py-3">
                <h3 className="font-semibold text-foreground">Done</h3>
              </div>
              <ul className="divide-y divide-border">
                {done.map((r) => (
                  <WorkRow
                    key={r.recipe_id}
                    row={r}
                    onMake={onMake}
                    onToggle={(d) =>
                      complete.mutate({ restaurantId, recipeId: r.recipe_id, done: d })
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {unplanned.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <button
            onClick={() => setShowOther((v) => !v)}
            className="flex w-full items-center gap-1.5 px-4 py-3 text-left"
          >
            {showOther ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-semibold text-foreground">Not on today's list</span>
            <span className="text-sm text-muted-foreground">
              — {unplanned.length} other recipe{unplanned.length === 1 ? "" : "s"} you can
              still log
            </span>
          </button>
          {showOther && (
            <ul className="divide-y divide-border border-t border-border">
              {unplanned.map((r) => (
                <WorkRow
                  key={r.recipe_id}
                  row={r}
                  onMake={onMake}
                  onToggle={null}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function WorkRow({
  row,
  onMake,
  onToggle,
}: {
  row: PrepBoardRow;
  onMake: (r: PrepBoardRow) => void;
  /** null = not a planned line, so there is nothing to tick. */
  onToggle: ((done: boolean) => void) | null;
}) {
  const hero = recipeMediaUrl(row.hero_image_path);
  const isDone = !!row.completed_at;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {onToggle && (
        <button
          onClick={() => onToggle(!isDone)}
          title={isDone ? "Mark as still to do" : "Mark as done"}
          className="shrink-0"
        >
          {isDone ? (
            <CheckCircle2 className="h-6 w-6 text-success" />
          ) : (
            <Circle className="h-6 w-6 text-muted-foreground" />
          )}
        </button>
      )}

      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
        {hero && <img src={hero} alt="" className="h-full w-full object-cover" />}
      </div>

      <div className="min-w-[140px] flex-1">
        <Link
          to={`/recipes/${row.recipe_id}`}
          className={cn(
            "font-medium text-foreground hover:underline",
            isDone && "line-through opacity-70"
          )}
        >
          {row.name}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {row.prep_time_mins != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3" />
              {row.prep_time_mins}m
            </span>
          )}
          {row.is_stocked && (
            <span className="inline-flex items-center gap-1">
              <Boxes className="h-3 w-3" /> stocked
            </span>
          )}
          {row.made_today > 0 && (
            <span className="tabular-nums text-success">
              {formatQty(row.made_today, row.yield_unit)} made
            </span>
          )}
          {row.plan_note && <span className="italic">{row.plan_note}</span>}
        </div>
      </div>

      {row.planned && (
        <div className="w-28 text-right">
          <p className="font-semibold tabular-nums text-foreground">
            {formatQty(row.target_qty, row.yield_unit)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {row.remaining != null && row.remaining > 0
              ? `${formatQty(row.remaining, row.yield_unit)} to go`
              : "target met"}
          </p>
        </div>
      )}

      <Button
        size="sm"
        variant={row.planned && (row.remaining ?? 0) > 0 ? "default" : "outline"}
        onClick={() => onMake(row)}
      >
        Made it
      </Button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan mode — what a manager sets each morning
// ─────────────────────────────────────────────────────────────────────────────

function PlanMode({
  board,
  restaurantId,
  onCopyYesterday,
  onClear,
  busy,
}: {
  board: PrepBoardRow[];
  restaurantId: string;
  onCopyYesterday: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return board.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q)
    );
  }, [board, search]);

  const plannedCount = board.filter((r) => r.planned).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={onCopyYesterday}>
          <CopyPlus className="mr-1.5 h-4 w-4" /> Copy yesterday
        </Button>
        <Button variant="outline" size="sm" disabled={busy || plannedCount === 0} onClick={onClear}>
          <Eraser className="mr-1.5 h-4 w-4" /> Clear day
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Set a quantity against anything that needs prepping today. Leave the rest blank —
        the team only sees what you set. Clearing a quantity takes it back off the list.
      </p>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold text-foreground">All prep recipes</h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {plannedCount} on today's list
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nothing matches that search.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <PlanRow key={r.recipe_id} row={r} restaurantId={restaurantId} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlanRow({ row, restaurantId }: { row: PrepBoardRow; restaurantId: string }) {
  const setItem = useSetPrepPlanItem();
  const savePrepCheck = useSavePrepCheck();
  const [qty, setQty] = useState(row.target_qty == null ? "" : String(row.target_qty));
  const [note, setNote] = useState(row.plan_note ?? "");

  function save(nextQty: string, nextNote: string) {
    const n = nextQty.trim() === "" ? null : Number(nextQty);
    if (n != null && Number.isNaN(n)) return;
    setItem.mutate(
      { restaurantId, recipeId: row.recipe_id, targetQty: n, note: nextNote.trim() || null },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that") }
    );
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 px-4 py-3",
        row.planned && "bg-primary/[0.03]"
      )}
    >
      <div className="min-w-[150px] flex-1">
        <Link to={`/recipes/${row.recipe_id}`} className="font-medium text-foreground hover:underline">
          {row.name}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span className="tabular-nums">Batch {formatQty(row.yield_qty, row.yield_unit)}</span>
          {row.par_qty != null && (
            <span className="tabular-nums">Par {formatQty(row.par_qty, row.yield_unit)}</span>
          )}
          {row.on_hand != null && (
            <span className="tabular-nums">
              {formatQty(row.on_hand, row.yield_unit)} on hand
              {row.on_hand_source === "stock" ? " (stock)" : " (counted)"}
            </span>
          )}
          {row.made_today > 0 && (
            <span className="tabular-nums text-success">
              {formatQty(row.made_today, row.yield_unit)} made today
            </span>
          )}
        </div>
      </div>

      {/* A shelf count is only worth asking for when there is no ledger figure. */}
      {row.on_hand_source !== "stock" && (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            placeholder="on hand"
            defaultValue={row.on_hand ?? ""}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === "" || Number(raw) === row.on_hand) return;
              savePrepCheck.mutate({
                restaurantId,
                recipeId: row.recipe_id,
                onHandQty: Number(raw),
                unit: row.yield_unit,
              });
            }}
            className="h-9 w-20 text-right tabular-nums"
          />
        </div>
      )}

      {row.suggested_qty != null && row.suggested_qty > 0 && (
        <button
          onClick={() => {
            const v = String(row.suggested_qty);
            setQty(v);
            save(v, note);
          }}
          title="Fill in par minus what's on hand"
          className="inline-flex items-center gap-1 rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Sparkles className="h-3 w-3" />
          {formatQty(row.suggested_qty, row.yield_unit)}
        </button>
      )}

      <Input
        placeholder="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if ((row.plan_note ?? "") !== note.trim() && qty.trim() !== "") save(qty, note);
        }}
        className="h-9 w-32"
      />

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          placeholder="—"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => {
            const current = row.target_qty == null ? "" : String(row.target_qty);
            if (qty.trim() === current) return;
            save(qty, note);
          }}
          className={cn(
            "h-9 w-24 text-right tabular-nums",
            row.planned && "border-primary font-semibold"
          )}
        />
        <span className="w-8 text-xs text-muted-foreground">{row.yield_unit}</span>
      </div>
    </li>
  );
}
