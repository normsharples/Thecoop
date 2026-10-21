import { useMemo } from "react";
import { AlertTriangle, BarChart3, EyeOff } from "lucide-react";
import { usePulseBenchmark } from "@/hooks/usePulseSurveys";
import { EmptyState, LoadingRows, Panel } from "@/components/team/TeamUI";
import { cn } from "@/lib/utils";
import type { SurveyWithQuestions } from "@/hooks/usePulseSurveys";

// ============================================================================
// VENUE BENCHMARKING
// ----------------------------------------------------------------------------
// One table, one survey. Comparing venues only makes sense when they were asked
// the same questions, and a survey IS a fixed question set — so scoping the
// table to a single survey is what keeps the comparison honest. There is
// deliberately no "all surveys" roll-up.
//
// The red flag is a venue against ITSELF: a question down 0.5 or more on that
// venue's own average over its previous four cycles. It never says one venue is
// worse than another, because a venue's baseline is its own.
// ============================================================================

function cellTone(average: number | null, flagged: boolean) {
  if (flagged) return "bg-destructive-soft text-destructive font-semibold";
  if (average == null) return "text-muted-foreground";
  if (average >= 4) return "text-success";
  if (average < 3) return "text-warning";
  return "text-foreground";
}

export function VenueBenchmark({
  survey,
  cycleStart,
}: {
  survey: SurveyWithQuestions;
  cycleStart: string | null;
}) {
  const { data: rows = [], isLoading, isError } = usePulseBenchmark(survey.id, cycleStart);

  const { questions, venues } = useMemo(() => {
    const qMap = new Map<string, string>();
    const vMap = new Map<
      string,
      {
        id: string;
        name: string;
        responses: number;
        eligible: number;
        metFloor: boolean;
        overall: number | null;
        cells: Map<string, { average: number | null; flagged: boolean; reason: string | null }>;
        flaggedCount: number;
      }
    >();

    for (const r of rows) {
      if (!qMap.has(r.question_id)) qMap.set(r.question_id, r.question_text);
      let v = vMap.get(r.venue_id);
      if (!v) {
        v = {
          id: r.venue_id,
          name: r.venue_name,
          responses: r.responses,
          eligible: r.eligible,
          metFloor: r.met_floor,
          overall: r.overall,
          cells: new Map(),
          flaggedCount: 0,
        };
        vMap.set(r.venue_id, v);
      }
      v.cells.set(r.question_id, {
        average: r.average,
        flagged: r.flagged,
        reason: r.flag_reason,
      });
      if (r.flagged) v.flaggedCount += 1;
    }

    return {
      questions: Array.from(qMap, ([id, text]) => ({ id, text })),
      venues: Array.from(vMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [rows]);

  if (isLoading) return <LoadingRows rows={4} />;

  if (isError) {
    return (
      <Panel title="Venue comparison">
        <EmptyState
          icon={EyeOff}
          title="Brand results are for brand admins"
          hint="A venue manager sees their own venue's results on the Results tab."
        />
      </Panel>
    );
  }

  if (!venues.length) {
    return (
      <Panel title="Venue comparison">
        <EmptyState
          icon={BarChart3}
          title="No answers in this cycle yet"
          hint="The table fills in as venues respond. Each one needs five answers before its numbers show."
        />
      </Panel>
    );
  }

  const flagged = venues.filter((v) => v.flaggedCount > 0);

  return (
    <div className="space-y-4">
      {flagged.length > 0 && (
        <div className="rounded-lg border border-destructive-border bg-destructive-soft p-3.5">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {flagged.length} venue{flagged.length === 1 ? "" : "s"} slipping
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[13px] text-destructive">
            {flagged.map((v) => (
              <li key={v.id}>
                {v.name} — {v.flaggedCount} question{v.flaggedCount === 1 ? "" : "s"} down 0.5+ on
                its own 4-cycle average
              </li>
            ))}
          </ul>
        </div>
      )}

      <Panel
        title="Venue comparison"
        description={`${survey.title} — every venue below answered the same questions, which is the only basis on which they can be compared.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="eyebrow sticky left-0 bg-card pb-2 pr-4">Venue</th>
                <th className="eyebrow pb-2 pr-4 text-right">Answers</th>
                <th className="eyebrow pb-2 pr-4 text-right">Overall</th>
                {questions.map((q) => (
                  <th key={q.id} className="eyebrow max-w-[140px] pb-2 pr-4 align-bottom">
                    {q.text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {venues.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0">
                  <td className="sticky left-0 bg-card py-2.5 pr-4 font-medium text-foreground">
                    {v.name}
                    {v.flaggedCount > 0 && (
                      <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-destructive" />
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-muted-foreground tnum">
                    {v.responses}
                    {v.eligible ? `/${v.eligible}` : ""}
                  </td>
                  {!v.metFloor ? (
                    <td
                      className="py-2.5 pr-4 text-[13px] text-muted-foreground"
                      colSpan={questions.length + 1}
                    >
                      Not enough responses to protect anonymity ({v.responses} of 5)
                    </td>
                  ) : (
                    <>
                      <td className="py-2.5 pr-4 text-right font-semibold tnum">
                        {v.overall?.toFixed(1) ?? "—"}
                      </td>
                      {questions.map((q) => {
                        const cell = v.cells.get(q.id);
                        return (
                          <td
                            key={q.id}
                            title={cell?.reason ?? undefined}
                            className={cn(
                              "py-2.5 pr-4 tnum",
                              cellTone(cell?.average ?? null, cell?.flagged ?? false)
                            )}
                          >
                            {cell?.average?.toFixed(1) ?? "—"}
                          </td>
                        );
                      })}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
