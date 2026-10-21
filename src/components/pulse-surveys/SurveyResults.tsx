import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EyeOff, MessageSquare, ShieldCheck, TrendingDown } from "lucide-react";
import {
  usePulseComments,
  usePulseQuestionAverages,
  usePulseResponseRate,
  usePulseTrend,
} from "@/hooks/usePulseSurveys";
import { ScaleValue } from "@/components/team/ScaleAnswer";
import { EmptyState, LoadingRows, Panel, Stat } from "@/components/team/TeamUI";
import { Badge } from "@/components/ui/badge";
import type { SurveyWithQuestions } from "@/hooks/usePulseSurveys";

// ============================================================================
// RESULTS FOR ONE VENUE (or the whole brand when venueId is null)
// ----------------------------------------------------------------------------
// Nothing here decides what to hide. Every number arrives from a Postgres
// function that has already applied the five-response floor; when it is not met
// the average comes back null and `met_floor` false, so there is no figure on
// the client to leak even by mistake.
// ============================================================================

const FLOOR = 5;

function Suppressed({ responses }: { responses: number }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-subtle p-3.5">
      <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="text-[13px]">
        <p className="font-medium text-foreground">
          Not enough responses to protect anonymity
        </p>
        <p className="text-muted-foreground">
          {responses} of {FLOOR} needed. Results appear once {FLOOR} people have answered —
          below that, an average can point at an individual.
        </p>
      </div>
    </div>
  );
}

export function SurveyResults({
  survey,
  cycleStart,
  venueId,
  venueName,
}: {
  survey: SurveyWithQuestions;
  cycleStart: string | null;
  venueId: string | null;
  venueName?: string;
}) {
  const { data: rates = [], isLoading: ratesLoading } = usePulseResponseRate(
    survey.id,
    cycleStart,
    venueId
  );
  const { data: averages = [], isLoading: avgLoading } = usePulseQuestionAverages(
    survey.id,
    cycleStart,
    venueId
  );
  const { data: trend = [] } = usePulseTrend(survey.id, venueId, 12);
  const { data: comments = [] } = usePulseComments(survey.id, cycleStart, venueId);

  const [trendQuestion, setTrendQuestion] = useState<string>("overall");

  const totals = useMemo(
    () =>
      rates.reduce(
        (acc, r) => ({
          responses: acc.responses + r.responses,
          eligible: acc.eligible + r.eligible,
        }),
        { responses: 0, eligible: 0 }
      ),
    [rates]
  );

  const metFloor = averages.some((a) => a.met_floor);

  // One point per cycle. "Overall" is the average of every scale answer in that
  // cycle; a specific question narrows to that question's rows.
  const trendData = useMemo(() => {
    const byCycle = new Map<string, { cycle: string; responses: number; value: number | null }>();
    for (const row of trend) {
      const value = trendQuestion === "overall" ? row.overall : null;
      const existing = byCycle.get(row.cycle_start);
      if (!existing) {
        byCycle.set(row.cycle_start, {
          cycle: row.cycle_start,
          responses: row.responses,
          value,
        });
      }
      if (trendQuestion !== "overall" && row.question_id === trendQuestion) {
        byCycle.set(row.cycle_start, {
          cycle: row.cycle_start,
          responses: row.responses,
          value: row.average,
        });
      }
    }
    return Array.from(byCycle.values())
      .sort((a, b) => a.cycle.localeCompare(b.cycle))
      .map((d) => ({
        label: format(parseISO(d.cycle), "d MMM"),
        value: d.value,
        responses: d.responses,
      }));
  }, [trend, trendQuestion]);

  const trendQuestions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of trend) if (!seen.has(r.question_id)) seen.set(r.question_id, r.question_text);
    return Array.from(seen, ([id, text]) => ({ id, text }));
  }, [trend]);

  // Is any question down 0.5+ on its own four-cycle average? The brand
  // benchmark computes this server-side; here it is a hint on the venue's own
  // page, derived from the same trend rows.
  const dips = useMemo(() => {
    const byQuestion = new Map<string, { text: string; points: { cycle: string; avg: number }[] }>();
    for (const r of trend) {
      if (r.average == null) continue;
      const entry = byQuestion.get(r.question_id) ?? { text: r.question_text, points: [] };
      entry.points.push({ cycle: r.cycle_start, avg: r.average });
      byQuestion.set(r.question_id, entry);
    }
    const out: { text: string; drop: number }[] = [];
    for (const { text, points } of byQuestion.values()) {
      const sorted = points.slice().sort((a, b) => b.cycle.localeCompare(a.cycle));
      const latest = sorted[0];
      const prior = sorted.slice(1, 5);
      if (!latest || prior.length === 0) continue;
      const base = prior.reduce((s, p) => s + p.avg, 0) / prior.length;
      if (base - latest.avg >= 0.5) out.push({ text, drop: base - latest.avg });
    }
    return out;
  }, [trend]);

  if (ratesLoading || avgLoading) return <LoadingRows rows={4} />;

  return (
    <div className="space-y-4">
      <Panel
        title={venueName ?? "All venues on this brand"}
        description={
          cycleStart
            ? `Cycle starting ${format(parseISO(cycleStart), "d MMMM yyyy")}`
            : "Current cycle"
        }
        icon={ShieldCheck}
      >
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat
            label="Responses"
            value={totals.responses}
            context={totals.eligible ? `of ${totals.eligible} on the team` : "No headcount set"}
          />
          <Stat
            label="Response rate"
            value={totals.eligible ? `${Math.round((totals.responses / totals.eligible) * 100)}%` : "—"}
            context={totals.eligible ? undefined : "Set home venues to measure this"}
          />
          <Stat
            label="Questions"
            value={averages.length}
            context="scored 1–5"
          />
          <Stat
            label="Watch"
            value={dips.length}
            tone={dips.length ? "destructive" : "muted"}
            context={dips.length ? "down 0.5+ on its own average" : "nothing slipping"}
          />
        </div>
      </Panel>

      {!metFloor ? (
        <Panel title="Results">
          <Suppressed responses={totals.responses} />
        </Panel>
      ) : (
        <>
          <Panel title="Average per question">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="eyebrow pb-2 pr-4">Question</th>
                    <th className="eyebrow pb-2 pr-4 text-right">Answers</th>
                    <th className="eyebrow pb-2 text-right">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {averages.map((a) => (
                    <tr key={a.question_id} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-4 text-foreground">{a.question_text}</td>
                      <td className="py-2.5 pr-4 text-right text-muted-foreground tnum">
                        {a.responses}
                      </td>
                      <td className="py-2.5 text-right">
                        <ScaleValue average={a.average} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {dips.length > 0 && (
              <div className="mt-4 space-y-1.5 rounded-lg border border-destructive-border bg-destructive-soft p-3">
                <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-destructive">
                  <TrendingDown className="h-3.5 w-3.5" />
                  Slipping against its own recent average
                </p>
                <ul className="space-y-0.5 text-[13px] text-destructive">
                  {dips.map((d) => (
                    <li key={d.text}>
                      {d.text} — down {d.drop.toFixed(1)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel
            title="Trend"
            description="The last 12 cycles. Gaps are cycles that didn't clear the five-response floor."
            actions={
              trendQuestions.length > 0 ? (
                <select
                  aria-label="Question to chart"
                  className="h-8 rounded-md border border-border-strong bg-card px-2 text-[13px]"
                  value={trendQuestion}
                  onChange={(e) => setTrendQuestion(e.target.value)}
                >
                  <option value="overall">All questions</option>
                  {trendQuestions.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.text}
                    </option>
                  ))}
                </select>
              ) : undefined
            }
          >
            {trendData.length < 2 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                One cycle so far. The line appears from the second cycle on.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      stroke="hsl(var(--border))"
                    />
                    <YAxis
                      domain={[1, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => [typeof v === "number" ? v.toFixed(1) : "—", "Average"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(var(--chart-2))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel
            title="Comments"
            description="Shuffled, with no time and no role attached — so nothing can be matched to a shift."
            icon={MessageSquare}
          >
            {comments.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No comments this cycle"
                hint="The free-text question is optional, so quiet cycles are normal."
              />
            ) : (
              <ul className="space-y-2">
                {comments.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-border bg-surface-subtle p-3 text-sm text-foreground"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {rates.length > 1 && (
        <Panel title="Response rate by venue">
          <div className="flex flex-wrap gap-2">
            {rates.map((r) => (
              <Badge key={r.venue_id} variant={r.met_floor ? "success" : "outline"}>
                {r.venue_name} · {r.responses}/{r.eligible || "?"}
                {r.rate != null ? ` · ${r.rate}%` : ""}
              </Badge>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
