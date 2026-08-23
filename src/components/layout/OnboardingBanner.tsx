import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { EmployeeOnboarding } from "@/types";

/**
 * Nag banner for anyone the gate lets through — managers on the soft gate, and
 * anyone a superadmin has granted a temporary skip.
 */
export function OnboardingBanner({ onboarding }: { onboarding: EmployeeOnboarding }) {
  const outstanding: string[] = [];
  if (onboarding.collect_details && !onboarding.details_complete) outstanding.push("your details");
  if (onboarding.collect_details && !onboarding.sensitive_complete) outstanding.push("tax, super and bank");
  if (onboarding.issue_contract && !onboarding.contract_signed) outstanding.push("your contract");

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-sm text-foreground">
          <span className="font-medium">Your onboarding isn't finished.</span>{" "}
          {outstanding.length > 0 && `Still to do: ${outstanding.join(", ")}.`}
        </p>
      </div>
      <Link
        to="/onboarding"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
      >
        Finish now <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
