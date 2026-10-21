import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, HeartPulse, X } from "lucide-react";
import { usePulseOpenForMe } from "@/hooks/usePulseSurveys";
import { useAuth } from "@/hooks/useAuth";

// ============================================================================
// "Quick 30-sec check-in"
// ----------------------------------------------------------------------------
// Dismissal is per session (sessionStorage), not permanent, and keyed by user +
// survey + cycle. The brief asks for the banner to come back on each login
// until the cycle closes or they answer — so it must NOT be remembered in
// localStorage, and it must forget itself when a new cycle starts.
//
// Answering removes it for good: pulse_open_for_me() stops returning the survey
// once a completion row exists, so there is nothing left to dismiss.
// ============================================================================

const key = (userId: string, surveyId: string, cycle: string) =>
  `orbit.pulse.dismissed.${userId}.${surveyId}.${cycle}`;

export function PulseCheckInBanner() {
  const { user } = useAuth();
  const { data: open = [] } = usePulseOpenForMe();
  const [dismissed, setDismissed] = useState(0); // bump to re-read sessionStorage

  if (!user || open.length === 0) return null;

  const next = open.find(
    (s) => sessionStorage.getItem(key(user.id, s.survey_id, s.cycle_start)) !== "1"
  );
  if (!next) return null;

  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-accent/40 bg-brand-accent/10 p-3"
      // Keyed on the dismissal counter so React re-renders when state is read
      // from sessionStorage rather than from props.
      key={dismissed}
    >
      <div className="flex items-start gap-2">
        <HeartPulse className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" />
        <p className="text-sm text-foreground">
          <span className="font-medium">Quick 30-sec check-in</span> — {next.question_count}{" "}
          question{next.question_count === 1 ? "" : "s"}, completely anonymous.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          to={`/team/surveys/${next.survey_id}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          Start <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <button
          onClick={() => {
            sessionStorage.setItem(key(user.id, next.survey_id, next.cycle_start), "1");
            setDismissed((n) => n + 1);
          }}
          aria-label="Dismiss until next time you sign in"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
