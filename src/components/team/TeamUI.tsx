import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Shared furniture for the three Team modules.
// Every screen in these modules needs the same four things — an empty state, a
// loading state, a section shell and a stat — so they live here once.
// ============================================================================

/**
 * Empty state. The line under the heading says what to do next, not that there
 * is nothing here: "No check-ins yet" with nothing after it tells the reader
 * something they can already see.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/30" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-sunken" />
      ))}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

/** Card shell: hairline border, no shadow — elevation is for things that float. */
export function Panel({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />}
            <div className="min-w-0">
              {title && <h2 className="font-display text-base font-semibold text-card-foreground">{title}</h2>}
              {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** A supporting figure: eyebrow label, 24px value, one line of context. */
export function Stat({
  label,
  value,
  context,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  context?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "destructive" | "muted";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tnum", toneClass)}>{value}</p>
      {context && <p className="mt-0.5 text-[13px] text-muted-foreground">{context}</p>}
    </div>
  );
}
