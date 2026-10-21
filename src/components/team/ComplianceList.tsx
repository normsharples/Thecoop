import { useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { useCertificateCompliance } from "@/hooks/useNewHires";
import { useRestaurants } from "@/hooks/useRestaurants";
import { EmptyState, LoadingRows, Panel, Stat } from "./TeamUI";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CertificateComplianceRow } from "@/types";

// ============================================================================
// CERTIFICATE COMPLIANCE
// Everyone's expiring tickets in one list — new hires and existing team — with
// a warning at 30 days and an alert once a date has passed. The same rows feed
// the dashboard widget and the nightly email from migration 064.
// ============================================================================

const FILTERS = [
  { key: "attention", label: "Needs attention" },
  { key: "expired", label: "Expired" },
  { key: "expiring", label: "Expiring soon" },
  { key: "all", label: "Everything" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

function statusBadge(row: CertificateComplianceRow) {
  if (row.compliance_status === "expired") {
    return <Badge variant="destructive">Expired</Badge>;
  }
  if (row.compliance_status === "expiring") {
    return <Badge variant="warning">{row.days_remaining} days</Badge>;
  }
  return <Badge variant="outline">OK</Badge>;
}

export function ComplianceList({ restaurantIds }: { restaurantIds?: string[] }) {
  const { data: rows = [], isLoading, isError } = useCertificateCompliance(restaurantIds);
  const { data: venues = [] } = useRestaurants();
  const [filter, setFilter] = useState<Filter>("attention");

  const counts = useMemo(
    () => ({
      expired: rows.filter((r) => r.compliance_status === "expired").length,
      expiring: rows.filter((r) => r.compliance_status === "expiring").length,
      total: rows.length,
    }),
    [rows]
  );

  const shown = useMemo(() => {
    const byFilter =
      filter === "all"
        ? rows
        : filter === "attention"
        ? rows.filter((r) => r.compliance_status !== "ok")
        : rows.filter((r) => r.compliance_status === filter);
    return byFilter
      .slice()
      .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
  }, [rows, filter]);

  const venueName = (id: string | null) =>
    venues.find((v) => v.id === id)?.name ?? "No venue set";

  if (isLoading) return <LoadingRows rows={4} />;

  if (isError) {
    return (
      <Panel title="Certificates">
        <EmptyState
          icon={FileCheck2}
          title="Compliance list isn't available yet"
          hint="Run migration 094_team_onboarding.sql in Supabase, then reload."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="Certificates" icon={ShieldCheck}>
        <div className="grid grid-cols-3 gap-5">
          <Stat
            label="Expired"
            value={counts.expired}
            tone={counts.expired ? "destructive" : "muted"}
            context={counts.expired ? "stop rostering these people" : "none"}
          />
          <Stat
            label="Within 30 days"
            value={counts.expiring}
            tone={counts.expiring ? "warning" : "muted"}
            context={counts.expiring ? "chase a renewal" : "none"}
          />
          <Stat label="Tracked" value={counts.total} context="with an expiry date" />
        </div>
      </Panel>

      <Panel
        title="By expiry"
        actions={
          <div className="flex flex-wrap gap-0.5 rounded-lg border border-border-strong bg-card p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "text-secondary-foreground hover:bg-accent"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={
              filter === "attention"
                ? "Nothing needs chasing"
                : "Nothing matches that filter"
            }
            hint={
              filter === "attention"
                ? "Every certificate with an expiry date is more than 30 days out."
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="eyebrow pb-2 pr-4">Person</th>
                  <th className="eyebrow pb-2 pr-4">Certificate</th>
                  <th className="eyebrow pb-2 pr-4">Venue</th>
                  <th className="eyebrow pb-2 pr-4">Expires</th>
                  <th className="eyebrow pb-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.certificate_id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-4">
                      <span className="text-foreground">{r.person_name}</span>
                      {r.source === "new_hire" && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">new hire</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{r.label}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {venueName(r.restaurant_id)}
                    </td>
                    <td className="py-2.5 pr-4 tnum text-muted-foreground">
                      {format(parseISO(r.expires_on), "d MMM yyyy")}
                      <span className="ml-1.5 text-[12px]">
                        {differenceInCalendarDays(parseISO(r.expires_on), new Date()) < 0
                          ? "(past)"
                          : ""}
                      </span>
                    </td>
                    <td className="py-2.5">{statusBadge(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
