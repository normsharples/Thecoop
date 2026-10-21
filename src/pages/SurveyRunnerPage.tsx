import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  usePulseOpenForMe,
  usePulseRunnerQuestions,
  usePulseSubmit,
} from "@/hooks/usePulseSurveys";
import { ScaleAnswer } from "@/components/team/ScaleAnswer";
import { EmptyState, LoadingBlock } from "@/components/team/TeamUI";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSetPageContextLine } from "@/contexts/PageContextLine";
import type { PulseAnswer } from "@/types";

// ============================================================================
// THE CHECK-IN
// ----------------------------------------------------------------------------
// One question per screen, a progress bar, and tap targets sized for a thumb on
// a phone in a kitchen. Everything else is stripped out: no nav back into the
// app mid-flow, no counters, nothing to read but the question.
//
// Scale questions advance on tap. Free text does not — people are mid-sentence.
// ============================================================================

export default function SurveyRunnerPage() {
  const { surveyId } = useParams<{ surveyId: string }>();
  const navigate = useNavigate();

  const { data: open = [] } = usePulseOpenForMe();
  const { data: questions = [], isLoading, isError, error } = usePulseRunnerQuestions(surveyId);
  const submit = usePulseSubmit();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, PulseAnswer>>({});
  const [done, setDone] = useState(false);

  const survey = open.find((s) => s.survey_id === surveyId);
  const title = survey?.title ?? "Quick check-in";

  useSetPageContextLine(done ? "Submitted · anonymous" : `${title} · anonymous`);

  const answeredCount = useMemo(
    () =>
      Object.values(answers).filter(
        (a) => a.value_int != null || (a.value_text ?? "").trim() !== ""
      ).length,
    [answers]
  );

  if (isLoading) return <LoadingBlock label="Opening your check-in…" />;

  if (isError) {
    return (
      <div className="mx-auto max-w-lg">
        <EmptyState
          icon={Lock}
          title="This check-in isn't open for you"
          hint={
            error instanceof Error
              ? error.message
              : "It may have closed, or it may be for another venue."
          }
          action={<Button onClick={() => navigate("/team/surveys")}>Back</Button>}
        />
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div className="mx-auto max-w-lg">
        <EmptyState
          icon={ShieldCheck}
          title="Nothing to answer"
          hint="This check-in has no questions on it yet."
          action={<Button onClick={() => navigate("/team/surveys")}>Back</Button>}
        />
      </div>
    );
  }

  // ── Confirmation ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-14 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
          <Check className="h-7 w-7 text-success" />
        </span>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Thanks — this is anonymous
          </h1>
          <p className="text-sm text-muted-foreground">
            Your answers aren't stored against your name. Your manager sees averages for the
            venue, and only once at least five people have answered.
          </p>
        </div>
        <Button onClick={() => navigate("/team/surveys")}>Done</Button>
      </div>
    );
  }

  const q = questions[index];
  const current = answers[q.question_id];
  const isLast = index === questions.length - 1;
  const progress = ((index + 1) / questions.length) * 100;

  const setScale = (value: number) => {
    setAnswers((a) => ({ ...a, [q.question_id]: { question_id: q.question_id, value_int: value } }));
    // Tapping a face is the answer and the "next" in one motion.
    if (!isLast) setTimeout(() => setIndex((i) => i + 1), 180);
  };

  const setText = (value: string) =>
    setAnswers((a) => ({ ...a, [q.question_id]: { question_id: q.question_id, value_text: value } }));

  const handleSubmit = async () => {
    const payload = Object.values(answers).filter(
      (a) => a.value_int != null || (a.value_text ?? "").trim() !== ""
    );
    if (!payload.length) {
      toast.error("Answer at least one question before sending.");
      return;
    }
    try {
      await submit.mutateAsync({ surveyId: surveyId!, answers: payload });
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send your answers");
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span>
            Question {index + 1} of {questions.length}
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Anonymous
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={questions.length}
          aria-label="Check-in progress"
        >
          <div
            className="h-full rounded-full bg-brand-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* The question */}
      <div className="space-y-5 rounded-xl border border-border bg-card p-5">
        <h1 className="font-display text-xl font-semibold leading-snug text-card-foreground">
          {q.text}
        </h1>

        {q.type === "scale_1_5" ? (
          <ScaleAnswer value={current?.value_int ?? null} onChange={setScale} autoFocus />
        ) : (
          <div className="space-y-1.5">
            <Textarea
              rows={5}
              value={current?.value_text ?? ""}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type anything you want to say. Leave it blank if you'd rather not."
              className="text-base"
            />
            <p className="text-xs text-muted-foreground">Optional.</p>
          </div>
        )}
      </div>

      {/* Controls — big, and only ever two */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="lg"
          className="flex-1"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        {isLast ? (
          <Button size="lg" className="flex-1" onClick={handleSubmit} disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Send{answeredCount ? ` (${answeredCount})` : ""}
          </Button>
        ) : (
          <Button size="lg" className="flex-1" onClick={() => setIndex((i) => i + 1)}>
            {current ? "Next" : "Skip"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
