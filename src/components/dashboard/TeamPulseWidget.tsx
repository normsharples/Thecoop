import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { EyeOff, HeartPulse } from "lucide-react";
import {
  useDefaultPulseSurvey,
  usePulseQuestionAverages,
  usePulseResponseRate,
} from "@/hooks/usePulseSurveys";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { ScaleValue } from "@/components/team/ScaleAnswer";
import { cn } from "@/lib/utils";

/**
 * Team Pulse, on the dashboard.
 *
 * A venue manager's dashboard is scoped to their venue, so the widget asks for
 * that venue's results; a brand admin looking at everything gets the brand roll-
 * up. Either way the figures come from the same floor-enforcing functions as the
 * full report — the widget cannot show a number the report would suppress.
 */
export function TeamPulseWidget({ restaurantIds }: { restaurantIds?: string[] }) {
  const { profile } = useAuth();
  const { isSuperadmin } = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { survey, isLoading } = useDefaultPulseSurvey();

  const isBrandAdmin = isSuperadmin || profile?.role === "area_manager";
  // One venue in view (either pinned on the widget or chosen in the top bar)
  // narrows the figures; otherwise brand admins see the brand.
  const venueId =
    restaurantIds?.length === 1
      ? restaurantIds[0]
      : selectedRestaurantId ?? (isBrandAdmin ? null : profile?.home_restaurant_id ?? null);

  const { data: rates = [] } = usePulseResponseRate(survey?.id, null, venueId);
  const { data: averages = [] } = usePulseQuestionAverages(survey?.id, null, venueId);

  const totals = rates.reduce(
    (a, r) => ({ responses: a.responses + r.responses, eligible: a.eligible + r.eligible }),
    { responses: 0, eligible: 0 }
  );
  const metFloor = averages.some((a) => a.met_floor);
  const scored = averages.filter((a) => a.average != null);
  const overall = scored.length
    ? scored.reduce((s, a) => s + (a.average ?? 0), 0) / scored.length
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-primary" />
          <h3 className="font-display text-base font-semibold text-card-foreground">
            Team Pulse
          </h3>
        </div>
        <Link to="/team/surveys" className="text-[13px] text-primary hover:underline">
          Open
        </Link>
      </div>

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-lg bg-surface-sunken" />
      ) : !survey ? (
        <p className="py-4 text-sm text-muted-foreground">
          No check-in set up for this brand yet.
        </p>
      ) : !metFloor ? (
        <div className="flex items-start gap-2 py-2">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            Not enough responses to protect anonymity — {totals.responses} of 5.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Overall</p>
              <p className="mt-0.5 text-2xl font-semibold tnum text-foreground">
                {overall?.toFixed(1) ?? "—"}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ 5</span>
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">Responses</p>
              <p className="mt-0.5 text-sm text-muted-foreground tnum">
                {totals.responses}
                {totals.eligible ? ` of ${totals.eligible}` : ""}
              </p>
            </div>
          </div>

          <ul className="space-y-1.5 border-t border-border pt-3">
            {averages.slice(0, 4).map((a) => (
              <li key={a.question_id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {a.question_text}
                </span>
                <span
                  className={cn(
                    "shrink-0",
                    (a.average ?? 0) >= 4
                      ? "text-success"
                      : (a.average ?? 5) < 3
                      ? "text-warning"
                      : "text-foreground"
                  )}
                >
                  <ScaleValue average={a.average} />
                </span>
              </li>
            ))}
          </ul>

          <p className="text-[12px] text-muted-foreground">
            {survey.title}
            {survey.status === "open"
              ? ` · open until ${format(parseISO(survey.closes_at), "d MMM")}`
              : ` · ${survey.status}`}
          </p>
        </div>
      )}
    </div>
  );
}
