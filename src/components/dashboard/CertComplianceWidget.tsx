import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { CheckCircle2, FileCheck2 } from "lucide-react";
import { useCertificateCompliance } from "@/hooks/useNewHires";
import { cn } from "@/lib/utils";

/**
 * Certificate compliance, on the dashboard.
 *
 * Expired first, then whatever runs out soonest — the order a manager would
 * actually work through it. Anything more than 30 days out is not shown at all;
 * a list of things that are fine is a list nobody reads.
 */
export function CertComplianceWidget({ restaurantIds }: { restaurantIds?: string[] }) {
  const { data: rows = [], isLoading, isError } = useCertificateCompliance(restaurantIds);

  const attention = rows
    .filter((r) => r.compliance_status !== "ok")
    .sort((a, b) => {
      if (a.compliance_status !== b.compliance_status) {
        return a.compliance_status === "expired" ? -1 : 1;
      }
      return a.expires_on.localeCompare(b.expires_on);
    });

  const expired = attention.filter((r) => r.compliance_status === "expired").length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-primary" />
          <h3 className="font-display text-base font-semibold text-card-foreground">
            Certificates
          </h3>
        </div>
        <Link to="/team/onboarding" className="text-[13px] text-primary hover:underline">
          Open
        </Link>
      </div>

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-lg bg-surface-sunken" />
      ) : isError ? (
        <p className="py-4 text-sm text-muted-foreground">
          Run migration 094 to start tracking certificate expiry.
        </p>
      ) : attention.length === 0 ? (
        <div className="flex items-center gap-2 py-3">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <p className="text-sm text-muted-foreground">
            Nothing expiring in the next 30 days.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-6">
            <div>
              <p className="eyebrow">Expired</p>
              <p
                className={cn(
                  "mt-0.5 text-2xl font-semibold tnum",
                  expired ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {expired}
              </p>
            </div>
            <div>
              <p className="eyebrow">Within 30 days</p>
              <p className="mt-0.5 text-2xl font-semibold tnum text-warning">
                {attention.length - expired}
              </p>
            </div>
          </div>

          <ul className="space-y-1.5 border-t border-border pt-3">
            {attention.slice(0, 5).map((r) => (
              <li
                key={r.certificate_id}
                className="flex items-center justify-between gap-3 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {r.person_name}
                  <span className="text-muted-foreground"> · {r.label}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 tnum",
                    r.compliance_status === "expired" ? "font-semibold text-destructive" : "text-warning"
                  )}
                >
                  {r.compliance_status === "expired"
                    ? "expired"
                    : format(parseISO(r.expires_on), "d MMM")}
                </span>
              </li>
            ))}
          </ul>
          {attention.length > 5 && (
            <p className="text-[12px] text-muted-foreground">
              and {attention.length - 5} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}
