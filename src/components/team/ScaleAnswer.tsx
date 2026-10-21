import { SCALE_FACES } from "@/hooks/usePulseSurveys";
import { cn } from "@/lib/utils";

/**
 * The 1–5 answer control, shared by the Pulse check-in and the exit survey.
 *
 * Built for a thumb: each face is its own 64px-tall button in a row that wraps
 * on narrow phones, and tapping one answers and advances. The number stays
 * visible under the face because the faces alone are ambiguous — one person's
 * 🙂 is another's 😐 — and because screen readers need something to say.
 */
export function ScaleAnswer({
  value,
  onChange,
  autoFocus,
}: {
  value: number | null;
  onChange: (value: number) => void;
  autoFocus?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Pick a rating from 1 to 5" className="flex gap-2">
      {SCALE_FACES.map((face, i) => {
        const selected = value === face.value;
        return (
          <button
            key={face.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${face.value} — ${face.label}`}
            autoFocus={autoFocus && i === 0}
            onClick={() => onChange(face.value)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 py-3 transition-colors",
              "min-h-[76px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-primary bg-primary-softer"
                : "border-border bg-card hover:border-border-strong hover:bg-accent"
            )}
          >
            <span className="text-[26px] leading-none" aria-hidden>
              {face.emoji}
            </span>
            <span
              className={cn(
                "text-[11px] font-semibold tnum",
                selected ? "text-primary" : "text-muted-foreground"
              )}
            >
              {face.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The same scale as a read-only summary, for results screens. */
export function ScaleValue({ average }: { average: number | null }) {
  if (average == null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const face = SCALE_FACES[Math.min(4, Math.max(0, Math.round(average) - 1))];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden>{face.emoji}</span>
      <span className="font-semibold tnum">{average.toFixed(1)}</span>
    </span>
  );
}
