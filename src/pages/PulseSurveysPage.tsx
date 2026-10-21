import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  HeartPulse,
  ListChecks,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { useActiveBrand } from "@/hooks/useActiveBrand";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useAuth } from "@/hooks/useAuth";
import {
  RECURRENCE_LABEL,
  usePulseOpenForMe,
  usePulseSurveyActions,
  usePulseSurveys,
  type SurveyWithQuestions,
} from "@/hooks/usePulseSurveys";
import { SurveyEditor } from "@/components/pulse-surveys/SurveyEditor";
import { SurveyResults } from "@/components/pulse-surveys/SurveyResults";
import { VenueBenchmark } from "@/components/pulse-surveys/VenueBenchmark";
import { EmptyState, LoadingRows, Panel } from "@/components/team/TeamUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSetPageContextLine } from "@/contexts/PageContextLine";
import { cn } from "@/lib/utils";

// ============================================================================
// PULSE SURVEYS
// ----------------------------------------------------------------------------
// One route, two faces — the same shape CashDepositsPage uses. Staff and
// supervisors get their own check-in and nothing else; manager and above get
// the surveys, their venue's results, and (for brand admins) the comparison.
// Branching at the top means neither view has to guard every query it makes.
// ============================================================================

export default function PulseSurveysPage() {
  const { isStaff, isTeamMember, isShiftSupervisor } = usePermissions();
  if (isStaff || isTeamMember || isShiftSupervisor) return <MyCheckIns />;
  return <PulseAdmin />;
}

// ── Staff: just the check-in ────────────────────────────────────────────────

function MyCheckIns() {
  const { data: open = [], isLoading } = usePulseOpenForMe();
  useSetPageContextLine(
    open.length ? `${open.length} waiting · takes about 30 seconds` : "Nothing waiting"
  );

  if (isLoading) return <LoadingRows rows={2} />;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <HeartPulse className="h-7 w-7 text-primary" />
        <h1 className="font-display text-2xl font-bold text-foreground">Check-in</h1>
      </div>

      {open.length === 0 ? (
        <Panel>
          <EmptyState
            icon={CheckCircle2}
            title="Nothing to answer right now"
            hint="When your venue has a check-in open you'll see it here, and on your dashboard."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your answers are anonymous. Your manager sees averages for the venue, never who
            said what — and only once five people have answered.
          </p>
          {open.map((s) => (
            <Link
              key={s.survey_id}
              to={`/team/surveys/${s.survey_id}`}
              className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{s.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {s.question_count} question{s.question_count === 1 ? "" : "s"} · closes{" "}
                    {format(parseISO(s.cycle_closes), "EEE d MMM")}
                  </p>
                </div>
                <Badge variant="default">30 sec</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Manager and above ──────────────────────────────────────────────────────

type Tab = "results" | "benchmark" | "surveys";

function PulseAdmin() {
  const { profile } = useAuth();
  const { isSuperadmin } = usePermissions();
  const { brand } = useActiveBrand();
  const { data: venues = [] } = useRestaurants();
  const { selectedRestaurantId } = useSelectedRestaurant();

  const isBrandAdmin = isSuperadmin || profile?.role === "area_manager";

  const { data: surveys = [], isLoading } = usePulseSurveys(brand?.id ?? null);
  const { setStatus, remove } = usePulseSurveyActions();
  const { data: openForMe = [] } = usePulseOpenForMe();

  const [tab, setTab] = useState<Tab>("results");
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SurveyWithQuestions | "new" | null>(null);

  // Default to the open survey, or the most recent one.
  useEffect(() => {
    if (surveys.length && (!surveyId || !surveys.some((s) => s.id === surveyId))) {
      setSurveyId((surveys.find((s) => s.status === "open") ?? surveys[0]).id);
    }
  }, [surveys, surveyId]);

  const survey = surveys.find((s) => s.id === surveyId) ?? null;

  // A venue manager only ever sees their own venue. A brand admin can look at
  // the brand as a whole, or narrow to one venue.
  const myVenues = isBrandAdmin
    ? venues
    : venues.filter((v) => profile?.restaurant_access.includes(v.id));
  const [venueId, setVenueId] = useState<string | null>(
    isBrandAdmin ? null : selectedRestaurantId ?? null
  );
  useEffect(() => {
    if (!isBrandAdmin && !venueId && myVenues.length) setVenueId(myVenues[0].id);
  }, [isBrandAdmin, venueId, myVenues]);

  useSetPageContextLine(
    survey
      ? `${survey.title} · ${RECURRENCE_LABEL[survey.recurrence].toLowerCase()}`
      : brand
      ? `${brand.name} · no check-ins yet`
      : "Pick a brand to set up check-ins"
  );

  if (!brand) {
    return (
      <Panel>
        <EmptyState
          icon={HeartPulse}
          title="Pick a brand first"
          hint="Check-ins and their questions belong to a brand. Choose one in the top bar to see or set up its check-ins."
        />
      </Panel>
    );
  }

  const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
    { key: "results", label: "Results", icon: BarChart3 },
    ...(isBrandAdmin
      ? ([{ key: "benchmark", label: "Compare venues", icon: ListChecks }] as const)
      : []),
    ...(isBrandAdmin
      ? ([{ key: "surveys", label: "Check-ins", icon: CalendarClock }] as const)
      : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <HeartPulse className="h-7 w-7 text-primary" />
          <h1 className="font-display text-2xl font-bold text-foreground">Pulse Surveys</h1>
        </div>
        <div className="flex items-center gap-2">
          {openForMe.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/team/surveys/${openForMe[0].survey_id}`}>
                <HeartPulse className="h-3.5 w-3.5" />
                Answer yours
              </Link>
            </Button>
          )}
          {isBrandAdmin && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="h-3.5 w-3.5" />
              New check-in
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-0.5 rounded-lg border border-border-strong bg-card p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "text-secondary-foreground hover:bg-accent"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingRows rows={4} />
      ) : surveys.length === 0 ? (
        <Panel>
          <EmptyState
            icon={CalendarClock}
            title="No check-ins for this brand yet"
            hint={
              isBrandAdmin
                ? "Set one up and it opens on its own at the time you choose. The six starter questions are already in this brand's bank."
                : "Your brand owner sets these up. Results appear here once a check-in has run."
            }
            action={
              isBrandAdmin ? (
                <Button onClick={() => setEditing("new")}>
                  <Plus className="h-3.5 w-3.5" />
                  New check-in
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          {/* Which check-in, and (for results) which venue */}
          {tab !== "surveys" && (
            <div className="flex flex-wrap gap-3">
              <label className="flex-1 space-y-1">
                <span className="eyebrow">Check-in</span>
                <select
                  className="h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm"
                  value={surveyId ?? ""}
                  onChange={(e) => setSurveyId(e.target.value)}
                >
                  {surveys.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} — {s.status}
                    </option>
                  ))}
                </select>
              </label>
              {tab === "results" && (
                <label className="flex-1 space-y-1">
                  <span className="eyebrow">Venue</span>
                  <select
                    className="h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm"
                    value={venueId ?? ""}
                    onChange={(e) => setVenueId(e.target.value || null)}
                    disabled={!isBrandAdmin && myVenues.length <= 1}
                  >
                    {isBrandAdmin && <option value="">All venues on this brand</option>}
                    {myVenues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {tab === "results" && survey && (
            <SurveyResults
              survey={survey}
              cycleStart={null}
              venueId={venueId}
              venueName={venues.find((v) => v.id === venueId)?.name}
            />
          )}

          {tab === "benchmark" && survey && <VenueBenchmark survey={survey} cycleStart={null} />}

          {tab === "surveys" && (
            <Panel
              title="Check-ins"
              description="Scheduled ones open on their own. A repeating check-in keeps the same questions each cycle."
            >
              <div className="divide-y divide-border">
                {surveys.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-foreground">{s.title}</p>
                        <Badge
                          variant={
                            s.status === "open"
                              ? "success"
                              : s.status === "scheduled"
                              ? "warning"
                              : "outline"
                          }
                        >
                          {s.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {RECURRENCE_LABEL[s.recurrence]} ·{" "}
                        {format(parseISO(s.opens_at), "d MMM HH:mm")} –{" "}
                        {format(parseISO(s.closes_at), "d MMM HH:mm")} · {s.question_ids.length}{" "}
                        question{s.question_ids.length === 1 ? "" : "s"} ·{" "}
                        {s.target === "all_venues"
                          ? "every venue"
                          : `${s.target_venue_ids.length} venue${
                              s.target_venue_ids.length === 1 ? "" : "s"
                            }`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {s.status !== "closed" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await setStatus.mutateAsync({ id: s.id, status: "closed" });
                              toast.success("Closed");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Couldn't close it");
                            }
                          }}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Close
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await setStatus.mutateAsync({ id: s.id, status: "open" });
                              toast.success("Reopened");
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Couldn't reopen it");
                            }
                          }}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Reopen
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Edit ${s.title}`}
                        onClick={() => setEditing(s)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${s.title}`}
                        onClick={async () => {
                          if (
                            !confirm(
                              `Delete "${s.title}"? Its answers go with it and cannot be recovered.`
                            )
                          )
                            return;
                          try {
                            await remove.mutateAsync(s.id);
                            toast.success("Deleted");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Couldn't delete it");
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}

      {editing && (
        <SurveyEditor
          brandId={brand.id}
          survey={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
