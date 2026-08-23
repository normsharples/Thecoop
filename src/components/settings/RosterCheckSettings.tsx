import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Save, ShieldAlert, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ISSUE_CODES,
  ISSUE_DESCRIPTIONS,
  ISSUE_LABELS,
  ISSUE_OPTION_KEYS,
  type ComplianceOptions,
  type IssueCode,
  type IssueSeverity,
  type RosterCheckConfig,
} from "@/lib/rosterCompliance";
import {
  useRosterCheckConfig,
  useSaveRosterChecks,
  useResetRosterChecks,
} from "@/hooks/useRosterChecks";

// How each threshold is presented: label, input kind and sane bounds.
const OPTION_META: Record<
  keyof ComplianceOptions,
  { label: string; kind: "hours" | "minutes" | "time"; min?: number; max?: number; step?: number }
> = {
  restHours: { label: "Minimum hours off between shifts", kind: "hours", min: 0, max: 24, step: 0.5 },
  breakAfterHours: { label: "A break is required past", kind: "hours", min: 1, max: 12, step: 0.5 },
  minBreakMinutes: { label: "Minimum break", kind: "minutes", min: 0, max: 120, step: 5 },
  maxShiftHours: { label: "Longest ordinary shift", kind: "hours", min: 1, max: 24, step: 0.5 },
  weeklyHours: { label: "Ordinary hours per week", kind: "hours", min: 1, max: 80, step: 0.5 },
  minorNightEnd: { label: "Under-18s finish by", kind: "time" },
  minorMorningStart: { label: "Under-18s start from", kind: "time" },
};

const SEVERITIES: { value: IssueSeverity; label: string; hint: string }[] = [
  { value: "error", label: "Must fix", hint: "Red — shown first in the roster check" },
  { value: "warning", label: "Check", hint: "Amber — worth a look before publishing" },
  { value: "info", label: "Cost note", hint: "Grey — informational only" },
];

function SeverityIcon({ severity }: { severity: IssueSeverity }) {
  const Icon = severity === "error" ? ShieldAlert : severity === "warning" ? AlertTriangle : Info;
  return (
    <Icon
      className={cn(
        "h-4 w-4 shrink-0",
        severity === "error"
          ? "text-destructive"
          : severity === "warning"
          ? "text-warning"
          : "text-blue-500"
      )}
    />
  );
}

const inputCls =
  "h-9 w-24 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Settings → Roster Checks. Controls the warnings the roster builder raises:
 * which checks run, how loudly, and the thresholds behind them.
 *
 * Defaults come from the award config, so leaving this page alone keeps the
 * award's own numbers. Saving stores an override in app_settings.
 */
export default function RosterCheckSettings() {
  const { config, defaults, isCustomised, isLoading } = useRosterCheckConfig();
  const save = useSaveRosterChecks();
  const reset = useResetRosterChecks();

  const [draft, setDraft] = useState<RosterCheckConfig | null>(null);

  // Adopt the loaded config once, and again whenever a save/reset lands.
  useEffect(() => {
    if (!isLoading) setDraft(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isCustomised]);

  const value = draft ?? config;
  const dirty = JSON.stringify(value) !== JSON.stringify(config);

  const setRule = (code: IssueCode, patch: Partial<RosterCheckConfig["rules"][IssueCode]>) =>
    setDraft({
      ...value,
      rules: { ...value.rules, [code]: { ...value.rules[code], ...patch } },
    });

  const setOption = (key: keyof ComplianceOptions, v: string) => {
    const meta = OPTION_META[key];
    const next =
      meta.kind === "time"
        ? v
        : Number.isFinite(Number(v))
        ? Math.min(meta.max ?? Infinity, Math.max(meta.min ?? 0, Number(v)))
        : (value.options[key] as number);
    setDraft({ ...value, options: { ...value.options, [key]: next } });
  };

  const onSave = async () => {
    try {
      await save.mutateAsync(value);
      toast.success("Roster checks saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save roster checks");
    }
  };

  const onReset = async () => {
    if (!window.confirm("Reset every roster check back to the award defaults?")) return;
    try {
      await reset.mutateAsync();
      setDraft(defaults);
      toast.success("Roster checks reset to the award defaults");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reset roster checks");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading roster checks…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Roster checks</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The warnings the roster builder raises while you're building a week. Turn a check
            off, change how loudly it shouts, or move its threshold. These are award rules, so
            they apply to every venue.
            {!isCustomised && " Right now they're the defaults from your award config."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCustomised && (
            <button
              onClick={onReset}
              disabled={reset.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {reset.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Reset to defaults
            </button>
          )}
          <button
            onClick={onSave}
            disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {ISSUE_CODES.map((code) => {
          const rule = value.rules[code];
          const optionKeys = ISSUE_OPTION_KEYS[code] ?? [];
          return (
            <div
              key={code}
              className={cn(
                "rounded-xl border border-border bg-card p-3 transition-opacity",
                !rule.enabled && "opacity-60"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => setRule(code, { enabled: e.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <SeverityIcon severity={rule.severity} />
                      {ISSUE_LABELS[code]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {ISSUE_DESCRIPTIONS[code]}
                    </span>
                  </span>
                </label>

                <select
                  value={rule.severity}
                  onChange={(e) =>
                    setRule(code, { severity: e.target.value as IssueSeverity })
                  }
                  disabled={!rule.enabled}
                  title={SEVERITIES.find((s) => s.value === rule.severity)?.hint}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {optionKeys.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 pl-7">
                  {optionKeys.map((key) => {
                    const meta = OPTION_META[key];
                    return (
                      <label key={key} className="flex items-center gap-2 text-xs text-muted-foreground">
                        {meta.label}
                        <input
                          type={meta.kind === "time" ? "time" : "number"}
                          value={String(value.options[key])}
                          min={meta.min}
                          max={meta.max}
                          step={meta.step}
                          disabled={!rule.enabled}
                          onChange={(e) => setOption(key, e.target.value)}
                          className={cn(inputCls, meta.kind === "time" && "w-28")}
                        />
                        {meta.kind === "hours" && <span>hours</span>}
                        {meta.kind === "minutes" && <span>minutes</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Overlaps and double-bookings can be turned off, but they're the two the roster builder
        can't work around for you — leave them on unless you have a reason.
      </p>
    </div>
  );
}
