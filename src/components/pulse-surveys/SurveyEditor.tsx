import { useState } from "react";
import { addDays, format } from "date-fns";
import { GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  RECURRENCE_LABEL,
  usePulseQuestions,
  usePulseSurveyActions,
  type SurveyWithQuestions,
} from "@/hooks/usePulseSurveys";
import { cn } from "@/lib/utils";
import type { PulseRecurrence } from "@/types";

const selectCls =
  "h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** datetime-local wants "yyyy-MM-ddTHH:mm" in local time. */
const toLocalInput = (iso: string) => format(new Date(iso), "yyyy-MM-dd'T'HH:mm");

export function SurveyEditor({
  brandId,
  survey,
  onClose,
}: {
  brandId: string;
  survey?: SurveyWithQuestions;
  onClose: () => void;
}) {
  const { data: questions = [] } = usePulseQuestions(brandId);
  const { data: venues = [] } = useRestaurants();
  const { save } = usePulseSurveyActions();

  const brandVenues = venues.filter((v) => v.brand_id === brandId);
  const active = questions.filter((q) => q.is_active || survey?.question_ids.includes(q.id));

  const [title, setTitle] = useState(survey?.title ?? "Weekly check-in");
  const [opensAt, setOpensAt] = useState(
    survey ? toLocalInput(survey.opens_at) : format(new Date(), "yyyy-MM-dd'T'09:00")
  );
  const [closesAt, setClosesAt] = useState(
    survey
      ? toLocalInput(survey.closes_at)
      : format(addDays(new Date(), 3), "yyyy-MM-dd'T'23:59")
  );
  const [recurrence, setRecurrence] = useState<PulseRecurrence>(survey?.recurrence ?? "weekly");
  const [target, setTarget] = useState<"all_venues" | "selected">(survey?.target ?? "all_venues");
  const [venueIds, setVenueIds] = useState<string[]>(survey?.target_venue_ids ?? []);
  // Order matters — it is the order the questions appear on screen.
  const [picked, setPicked] = useState<string[]>(
    survey?.question_ids ?? active.map((q) => q.id)
  );

  // A recurring survey can't have its question set changed without breaking the
  // trend it exists to produce, so say so rather than letting it happen quietly.
  const lockedQuestions = !!survey && survey.recurrence !== "none" && survey.status !== "scheduled";

  const toggleQuestion = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const move = (id: string, dir: -1 | 1) =>
    setPicked((p) => {
      const i = p.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = p.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const handleSave = async () => {
    if (!title.trim()) return toast.error("Give the check-in a name");
    if (!picked.length) return toast.error("Pick at least one question");
    if (new Date(closesAt) <= new Date(opensAt)) {
      return toast.error("It has to close after it opens");
    }
    if (target === "selected" && !venueIds.length) {
      return toast.error("Pick at least one venue");
    }
    try {
      await save.mutateAsync({
        id: survey?.id,
        brand_id: brandId,
        title,
        opens_at: new Date(opensAt).toISOString(),
        closes_at: new Date(closesAt).toISOString(),
        recurrence,
        target,
        target_venue_ids: venueIds,
        question_ids: picked,
      });
      toast.success(survey ? "Check-in updated" : "Check-in scheduled");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the check-in");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{survey ? "Edit check-in" : "New check-in"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="survey-title">Name</Label>
            <Input
              id="survey-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekly check-in"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="survey-opens">Opens</Label>
              <Input
                id="survey-opens"
                type="datetime-local"
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="survey-closes">Closes</Label>
              <Input
                id="survey-closes"
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="survey-recurrence">Repeats</Label>
            <select
              id="survey-recurrence"
              className={selectCls}
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as PulseRecurrence)}
            >
              {(Object.keys(RECURRENCE_LABEL) as PulseRecurrence[]).map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABEL[r]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {recurrence === "none"
                ? "Opens once and closes for good."
                : "The same window reopens on this cycle, with the same questions, so the trend line stays comparable."}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Who gets it</Label>
            <div className="flex gap-2">
              {(["all_venues", "selected"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    target === t
                      ? "border-primary bg-primary-softer text-primary"
                      : "border-border-strong bg-card text-secondary-foreground hover:bg-accent"
                  )}
                >
                  {t === "all_venues" ? "Every venue" : "Chosen venues"}
                </button>
              ))}
            </div>
            {target === "selected" && (
              <div className="grid gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-2">
                {brandVenues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No venues on this brand yet.
                  </p>
                ) : (
                  brandVenues.map((v) => (
                    <label key={v.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <Checkbox
                        checked={venueIds.includes(v.id)}
                        onCheckedChange={(c) =>
                          setVenueIds((ids) =>
                            c ? [...ids, v.id] : ids.filter((x) => x !== v.id)
                          )
                        }
                      />
                      {v.name}
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Questions · {picked.length} on</Label>
              {lockedQuestions && (
                <span className="text-xs text-warning">
                  Locked while a repeating check-in is live
                </span>
              )}
            </div>

            {/* Chosen questions, in order */}
            <div className="space-y-1 rounded-lg border border-border p-2">
              {picked.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Nothing picked yet — tick questions below.
                </p>
              ) : (
                picked.map((id, i) => {
                  const q = questions.find((x) => x.id === id);
                  if (!q) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-md bg-surface-subtle px-2 py-1.5"
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      <span className="flex-1 truncate text-[13px] text-foreground">
                        {q.text}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {q.type === "text" ? "Comment" : "1–5"}
                      </span>
                      <div className="flex shrink-0">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={i === 0 || lockedQuestions}
                          onClick={() => move(id, -1)}
                          className="rounded px-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={i === picked.length - 1 || lockedQuestions}
                          onClick={() => move(id, 1)}
                          className="rounded px-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* The brand's bank */}
            <div className="grid gap-1.5 rounded-lg border border-border p-3">
              {active.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This brand's question bank is empty. Add questions under Settings → Brands →
                  Team.
                </p>
              ) : (
                active.map((q) => (
                  <label
                    key={q.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 text-sm",
                      lockedQuestions && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      disabled={lockedQuestions}
                      checked={picked.includes(q.id)}
                      onCheckedChange={() => toggleQuestion(q.id)}
                    />
                    <span className="flex-1">
                      {q.text}
                      {q.version > 1 && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          v{q.version}
                        </span>
                      )}
                      {!q.is_active && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">retired</span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {survey ? "Save changes" : "Schedule it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
