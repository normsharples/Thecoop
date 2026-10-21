import { useState } from "react";
import { MessageSquareHeart, X, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { usePendingExitSurvey, useExitSurveySubmit } from "@/hooks/useOffboarding";
import { ScaleAnswer } from "./ScaleAnswer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PulseAnswer } from "@/types";

/**
 * The exit survey, asked on whatever page a leaver lands on after their last
 * shift — before the nightly revocation closes their access.
 *
 * It uses the same answer controls as the Pulse check-in, and says plainly that
 * it is NOT anonymous. Pulse's whole promise is that nobody can trace an answer
 * back to a person; borrowing its look without borrowing that promise would be
 * a quiet lie, so the line is in the header, not the small print.
 */
export function ExitSurveyPrompt() {
  const { data: pending } = usePendingExitSurvey();
  const { submit, skip } = useExitSurveySubmit();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, PulseAnswer>>({});

  if (!pending || pending.questions.length === 0) return null;

  const setScale = (id: string, value: number) =>
    setAnswers((a) => ({ ...a, [id]: { question_id: id, value_int: value } }));
  const setText = (id: string, value: string) =>
    setAnswers((a) => ({ ...a, [id]: { question_id: id, value_text: value } }));

  const answered = Object.values(answers).filter(
    (a) => a.value_int != null || (a.value_text ?? "").trim() !== ""
  );

  const handleSubmit = async () => {
    if (!answered.length) {
      toast.error("Answer at least one question, or choose No thanks.");
      return;
    }
    try {
      await submit.mutateAsync({ offboardingId: pending.offboarding_id, answers: answered });
      toast.success("Thanks for the feedback.");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your answers");
    }
  };

  const handleSkip = async () => {
    try {
      await skip.mutateAsync(pending.offboarding_id);
      setOpen(false);
    } catch {
      // Not worth a toast — it only means they get asked once more.
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <MessageSquareHeart className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm text-foreground">
            <span className="font-medium">Before you go — three quick questions.</span>{" "}
            Your last shift was{" "}
            {format(parseISO(pending.last_shift_date), "d MMMM")}. Answering is optional.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={handleSkip} disabled={skip.isPending}>
            No thanks
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            Answer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <h2 className="font-display text-base font-semibold text-card-foreground">
            Exit survey
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            This one is <span className="font-medium text-foreground">not anonymous</span> —
            your name is attached, and only the brand owner can read it.
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="space-y-5 p-4">
        {pending.questions.map((q) => (
          <div key={q.id} className="space-y-2">
            <p className="text-sm font-medium text-foreground">{q.text}</p>
            {q.type === "scale_1_5" ? (
              <ScaleAnswer
                value={answers[q.id]?.value_int ?? null}
                onChange={(v) => setScale(q.id, v)}
              />
            ) : (
              <Textarea
                rows={3}
                value={answers[q.id]?.value_text ?? ""}
                onChange={(e) => setText(q.id, e.target.value)}
                placeholder="Optional"
              />
            )}
          </div>
        ))}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={handleSkip} disabled={skip.isPending}>
            No thanks
          </Button>
          <Button onClick={handleSubmit} disabled={submit.isPending}>
            {submit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
