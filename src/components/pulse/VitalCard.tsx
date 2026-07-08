import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, ExternalLink, Loader2 } from "lucide-react";
import type { VitalStatus, VitalTrend } from "@/hooks/usePulseData";

export interface VitalCardProps {
  label: string;
  value: string;
  target?: string | null;
  status: VitalStatus;
  trend?: VitalTrend;
  trendValue?: string;
  subtitle?: string;
  onClick?: () => void;
  loading?: boolean;
  isPlaceholder?: boolean;
  placeholderPhase?: string;
  compact?: boolean;
}

const statusClasses: Record<VitalStatus, string> = {
  green: "vital-green",
  amber: "vital-amber",
  red: "vital-red",
  grey: "vital-grey",
};

const statusBadgeClasses: Record<VitalStatus, string> = {
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  grey: "text-slate-500",
};

const statusDotClasses: Record<VitalStatus, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-slate-600",
};

function TrendIcon({ trend }: { trend: VitalTrend }) {
  if (trend === "up")
    return <TrendingUp className="h-3.5 w-3.5" />;
  if (trend === "down")
    return <TrendingDown className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}

export function VitalCard({
  label,
  value,
  target,
  status,
  trend = "flat",
  trendValue,
  subtitle,
  onClick,
  loading = false,
  isPlaceholder = false,
  compact = false,
}: VitalCardProps) {
  if (loading) {
    return (
      <div
        className={cn(
          "rounded-xl border-2 border-slate-700 bg-[hsl(220,20%,10%)] p-5 flex flex-col gap-3",
          compact && "p-4"
        )}
      >
        <div className="h-3 w-20 rounded bg-slate-700 animate-pulse" />
        <div className="h-8 w-28 rounded bg-slate-700 animate-pulse" />
        <div className="h-2 w-16 rounded bg-slate-700 animate-pulse" />
      </div>
    );
  }

  if (isPlaceholder) {
    return (
      <div
        className={cn(
          "rounded-xl border-2 border-slate-800 bg-[hsl(220,20%,9%)] p-5 flex flex-col gap-2 opacity-40 select-none",
          compact && "p-4"
        )}
      >
        <p className="text-xs font-medium tracking-widest uppercase text-slate-500">
          {label}
        </p>
        <p className="text-3xl font-bold tabular-nums text-slate-600">—</p>
        <p className="text-xs text-slate-600">{subtitle}</p>
      </div>
    );
  }

  const clickable = !!onClick;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => e.key === "Enter" && onClick?.() : undefined}
      className={cn(
        "rounded-xl border-2 bg-[hsl(220,20%,10%)] p-5 flex flex-col gap-2 transition-all duration-200",
        statusClasses[status],
        clickable && "cursor-pointer hover:scale-[1.02] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
        compact && "p-4 gap-1.5"
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p
          className={cn(
            "text-xs font-semibold tracking-widest uppercase",
            statusBadgeClasses[status]
          )}
        >
          {label}
        </p>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              statusDotClasses[status]
            )}
          />
          {clickable && (
            <ExternalLink className="h-3 w-3 text-slate-600" />
          )}
        </div>
      </div>

      {/* Main value */}
      <p
        className={cn(
          "font-bold tabular-nums leading-none text-white",
          compact ? "text-2xl" : "text-4xl"
        )}
      >
        {value}
      </p>

      {/* Target */}
      {target && (
        <p className="text-xs text-slate-400">
          <span className="text-slate-600">Target: </span>
          {target}
        </p>
      )}

      {/* Trend + subtitle row */}
      <div className="flex items-center justify-between mt-auto pt-1">
        {trendValue ? (
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              trend === "up" && "text-green-400",
              trend === "down" && "text-red-400",
              trend === "flat" && "text-slate-500"
            )}
          >
            <TrendIcon trend={trend} />
            <span>{trendValue}</span>
          </div>
        ) : (
          <span />
        )}
        {subtitle && (
          <p className="text-xs text-slate-500 text-right truncate max-w-[60%]">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// Compact variant used in "All Stores" per-store row
export function VitalDot({
  status,
  label,
}: {
  status: VitalStatus;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full flex-shrink-0",
          statusDotClasses[status]
        )}
      />
      <span className="text-xs text-slate-400 truncate hidden sm:block">
        {label}
      </span>
    </div>
  );
}

// Loading spinner for full page
export function PulseSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
    </div>
  );
}
