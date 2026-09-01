import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Printer, Boxes, Info } from "lucide-react";
import { usePostProductionRun, useRecipeAllergens, formatQty } from "@/hooks/useRecipes";
import { usePrinters } from "@/hooks/usePrinters";
import { printPrepLabel } from "@/lib/prepLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export interface MakeBatchTarget {
  recipeId: string;
  name: string;
  yieldQty: number;
  yieldUnit: string;
  isStocked: boolean;
  /** Suggested batches from the prep list, when it knows. */
  suggestedBatches?: number | null;
}

export function MakeBatchDialog({
  target,
  restaurantId,
  venueName,
  open,
  onClose,
}: {
  target: MakeBatchTarget;
  restaurantId: string;
  venueName?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const post = usePostProductionRun();
  const { data: allergens = [] } = useRecipeAllergens(target.recipeId);
  const { data: printers = [] } = usePrinters(restaurantId);

  // With a printer set up, logging the batch prints the label by itself (a
  // trigger queues it and the watcher on the Mac sends it). Without one, fall
  // back to the browser window so a desk still gets something.
  const hasPrinter = printers.some((p) => p.active);

  const [batches, setBatches] = useState(
    String(target.suggestedBatches && target.suggestedBatches > 0
      ? Math.max(0.25, Math.round(target.suggestedBatches * 4) / 4)
      : 1)
  );
  const [produced, setProduced] = useState("");
  const [madeBy, setMadeBy] = useState("");
  const [notes, setNotes] = useState("");

  const batchNum = Number(batches) || 0;
  const expected = batchNum * target.yieldQty;
  const producedNum = produced === "" ? expected : Number(produced);
  const variance = producedNum - expected;

  const varianceLabel = useMemo(() => {
    if (produced === "" || !expected) return null;
    if (Math.abs(variance) < 1e-9) return null;
    const pct = (variance / expected) * 100;
    return `${variance > 0 ? "+" : ""}${formatQty(variance, target.yieldUnit)} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%) vs expected`;
  }, [produced, variance, expected, target.yieldUnit]);

  async function onSubmit() {
    if (!(batchNum > 0)) return;
    try {
      const run = await post.mutateAsync({
        restaurantId,
        recipeId: target.recipeId,
        batches: batchNum,
        producedQty: produced === "" ? null : Number(produced),
        notes: notes.trim() || null,
        madeByName: madeBy.trim() || null,
      });
      const stock = run.posted
        ? ` — ${formatQty(run.produced_qty, run.produced_unit)} into stock`
        : "";

      if (hasPrinter) {
        toast.success(`Logged${stock}. Label printing.`);
      } else {
        toast.success(`Logged${stock}`);
        const ok = printPrepLabel({
          recipeName: target.name,
          venueName,
          madeAt: run.made_at,
          useBy: run.use_by,
          quantity: formatQty(run.produced_qty, run.produced_unit),
          madeBy: run.made_by_name,
          allergens,
        });
        if (!ok) toast.message("Label ready — allow pop-ups to print it automatically.");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log that batch");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Made {target.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="batches">Batches</Label>
              <Input
                id="batches"
                type="number"
                step="0.25"
                min="0"
                value={batches}
                onChange={(e) => setBatches(e.target.value)}
              />
              <p className="text-xs text-muted-foreground tabular-nums">
                = {formatQty(expected, target.yieldUnit)}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="produced">Actually made</Label>
              <Input
                id="produced"
                type="number"
                step="any"
                min="0"
                placeholder={String(expected)}
                value={produced}
                onChange={(e) => setProduced(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if it came out as expected
              </p>
            </div>
          </div>

          {varianceLabel && (
            <p className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm text-foreground tabular-nums">
              {varianceLabel}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="madeby">Made by</Label>
              <Input
                id="madeby"
                placeholder="Name for the label"
                value={madeBy}
                onChange={(e) => setMadeBy(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
            {target.isStocked ? (
              <>
                <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Ingredients come out of stock and the batch goes in at what it cost to make.
              </>
            ) : (
              <>
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This one isn't tracked as stock, so nothing moves in the ledger — it's
                depleted through whatever sells it. The batch is still logged and labelled.
              </>
            )}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!(batchNum > 0) || post.isPending}>
            <Printer className="mr-1.5 h-4 w-4" />
            {post.isPending ? "Logging…" : hasPrinter ? "Log & print label" : "Log batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
