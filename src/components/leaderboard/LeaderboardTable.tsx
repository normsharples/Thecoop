import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Medal,
  ChevronDown,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn, formatCurrency } from "@/lib/utils";
import type { LeaderboardRow, LeaderboardWeights } from "@/hooks/useLeaderboardData";

// ── Helpers ───────────────────────────────────────────────────────────────────

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-yellow-500/15 text-yellow-500 text-sm font-bold">
        1
      </span>
    );
  if (rank === 2)
    return (
      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-slate-400/15 text-slate-400 text-sm font-bold">
        2
      </span>
    );
  if (rank === 3)
    return (
      <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-amber-700/15 text-amber-700 text-sm font-bold">
        3
      </span>
    );
  return (
    <span className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground text-sm font-medium">
      {rank}
    </span>
  );
}

function MovementBadge({
  movement,
}: {
  movement: LeaderboardRow["movement"];
}) {
  if (movement === "up")
    return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (movement === "down")
    return <TrendingDown className="h-4 w-4 text-red-500" />;
  if (movement === "new")
    return (
      <span className="text-xs text-primary font-semibold">NEW</span>
    );
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function ScoreBar({ score }: { score: number }) {
  if (score < 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const color =
    score >= 90
      ? "bg-green-500"
      : score >= 70
      ? "bg-amber-500"
      : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-foreground w-8 text-right">
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function DisabledCell({ phase }: { phase: string }) {
  return (
    <span className="text-xs text-muted-foreground/40 italic">{phase}</span>
  );
}

// ── Expanded row detail ───────────────────────────────────────────────────────

function ExpandedDetail({
  row,
  weights,
}: {
  row: LeaderboardRow;
  weights: LeaderboardWeights;
}) {
  const navigate = useNavigate();
  const activeMetrics = [
    { key: "sales" as const, label: "Net Sales", weight: weights.sales },
    { key: "labour" as const, label: "Labour %", weight: weights.labour },
    { key: "rating" as const, label: "Google Rating", weight: weights.rating },
    {
      key: "transactions" as const,
      label: "Transactions",
      weight: weights.transactions,
    },
  ];

  return (
    <div className="px-5 py-4 bg-muted/30 border-t border-border">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {activeMetrics.map(({ key, label, weight }) => {
          const metric = row.scores[key];
          return (
            <div key={key} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {label}
                </p>
                <span className="text-xs text-muted-foreground">{weight}%</span>
              </div>
              {metric.actual !== null ? (
                <>
                  <p className="text-lg font-bold tabular-nums text-foreground">
                    {key === "sales"
                      ? formatCurrency(metric.actual)
                      : key === "labour"
                      ? `${metric.actual.toFixed(1)}%`
                      : key === "rating"
                      ? metric.actual.toFixed(1)
                      : metric.actual.toLocaleString()}
                  </p>
                  {metric.target !== null && (
                    <p className="text-xs text-muted-foreground">
                      Target:{" "}
                      {key === "sales"
                        ? formatCurrency(metric.target)
                        : key === "labour"
                        ? `${metric.target.toFixed(1)}%`
                        : key === "rating"
                        ? metric.target.toFixed(1)
                        : metric.target.toLocaleString()}
                    </p>
                  )}
                  <div className="mt-2">
                    <ScoreBar score={metric.score} />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No data</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() =>
            navigate(
              `/reports/sales?restaurant=${row.restaurantId}`
            )
          }
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Sales Report
        </button>
        <button
          onClick={() =>
            navigate(
              `/reports/labour?restaurant=${row.restaurantId}`
            )
          }
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Labour Report
        </button>
        <button
          onClick={() =>
            navigate(
              `/reports/reviews?restaurant=${row.restaurantId}`
            )
          }
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Reviews Report
        </button>
      </div>
    </div>
  );
}

// ── Main table ────────────────────────────────────────────────────────────────

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  weights: LeaderboardWeights;
  isLoading: boolean;
}

export default function LeaderboardTable({
  rows,
  weights,
  isLoading,
}: LeaderboardTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-0 animate-pulse"
          >
            <div className="h-7 w-7 rounded-full bg-muted" />
            <div className="h-4 w-4 rounded bg-muted" />
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="flex-1 h-4 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
        <Medal className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          No restaurant data for this period.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Table header */}
      <div className="hidden lg:grid grid-cols-[48px_40px_1fr_140px_140px_140px_140px_80px_80px_90px] gap-3 px-5 py-2.5 border-b border-border bg-muted/30">
        <span className="text-xs font-semibold text-muted-foreground">Rank</span>
        <span className="text-xs font-semibold text-muted-foreground"></span>
        <span className="text-xs font-semibold text-muted-foreground">Restaurant</span>
        <span className="text-xs font-semibold text-muted-foreground">Net Sales</span>
        <span className="text-xs font-semibold text-muted-foreground">Labour %</span>
        <span className="text-xs font-semibold text-muted-foreground">Rating</span>
        <span className="text-xs font-semibold text-muted-foreground">Transactions</span>
        <span className="text-xs font-semibold text-muted-foreground/40">Food Cost</span>
        <span className="text-xs font-semibold text-muted-foreground/40">Waste</span>
        <span className="text-xs font-semibold text-muted-foreground text-right">Score</span>
      </div>

      {rows.map((row) => {
        const isExpanded = expandedId === row.restaurantId;

        return (
          <div key={row.restaurantId} className="border-b border-border last:border-0">
            {/* Main row */}
            <button
              onClick={() =>
                setExpandedId(isExpanded ? null : row.restaurantId)
              }
              className={cn(
                "w-full text-left transition-colors hover:bg-muted/30",
                isExpanded && "bg-muted/20"
              )}
            >
              {/* Mobile layout */}
              <div className="lg:hidden flex items-center gap-3 px-5 py-4">
                <RankMedal rank={row.rank} />
                <MovementBadge movement={row.movement} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-foreground truncate">
                      {row.restaurantName}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      {row.hasPartialData && (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                      )}
                      <span className="text-sm font-bold tabular-nums text-foreground">
                        {row.noData ? "—" : row.compositeScore.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  {!row.noData && (
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground flex-wrap">
                      {row.scores.sales.actual !== null && (
                        <span>
                          Sales: {formatCurrency(row.scores.sales.actual)}
                        </span>
                      )}
                      {row.scores.labour.actual !== null && (
                        <span>
                          Labour: {row.scores.labour.actual.toFixed(1)}%
                        </span>
                      )}
                      {row.scores.rating.actual !== null && (
                        <span>
                          Rating: {row.scores.rating.actual.toFixed(1)}★
                        </span>
                      )}
                    </div>
                  )}
                  {row.noData && (
                    <p className="text-xs text-muted-foreground">No data this period</p>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform",
                    isExpanded && "rotate-180"
                  )}
                />
              </div>

              {/* Desktop layout */}
              <div className="hidden lg:grid grid-cols-[48px_40px_1fr_140px_140px_140px_140px_80px_80px_90px] gap-3 px-5 py-3.5 items-center">
                <div>
                  <RankMedal rank={row.rank} />
                </div>
                <div>
                  <MovementBadge movement={row.movement} />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {row.restaurantName}
                  </p>
                  {row.hasPartialData && (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  )}
                </div>
                {/* Net Sales */}
                <div>
                  {row.scores.sales.actual !== null ? (
                    <div>
                      <p className="text-sm tabular-nums text-foreground">
                        {formatCurrency(row.scores.sales.actual)}
                      </p>
                      <ScoreBar score={row.scores.sales.score} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
                {/* Labour % */}
                <div>
                  {row.scores.labour.actual !== null ? (
                    <div>
                      <p className="text-sm tabular-nums text-foreground">
                        {row.scores.labour.actual.toFixed(1)}%
                      </p>
                      <ScoreBar score={row.scores.labour.score} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
                {/* Rating */}
                <div>
                  {row.scores.rating.actual !== null ? (
                    <div>
                      <p className="text-sm tabular-nums text-foreground">
                        {row.scores.rating.actual.toFixed(1)}★
                      </p>
                      <ScoreBar score={row.scores.rating.score} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
                {/* Transactions */}
                <div>
                  {row.scores.transactions.actual !== null ? (
                    <div>
                      <p className="text-sm tabular-nums text-foreground">
                        {row.scores.transactions.actual.toLocaleString()}
                      </p>
                      <ScoreBar score={row.scores.transactions.score} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
                {/* Disabled columns */}
                <DisabledCell phase="Ph.4" />
                <DisabledCell phase="Ph.4" />
                {/* Composite */}
                <div className="text-right">
                  {row.noData ? (
                    <span className="text-sm text-muted-foreground">No data</span>
                  ) : (
                    <span
                      className={cn(
                        "text-base font-bold tabular-nums",
                        row.compositeScore >= 90
                          ? "text-green-500"
                          : row.compositeScore >= 70
                          ? "text-amber-500"
                          : "text-red-500"
                      )}
                    >
                      {row.compositeScore.toFixed(1)}
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground inline ml-1 transition-transform",
                      isExpanded && "rotate-180"
                    )}
                  />
                </div>
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <ExpandedDetail row={row} weights={weights} />
            )}
          </div>
        );
      })}
    </div>
  );
}
