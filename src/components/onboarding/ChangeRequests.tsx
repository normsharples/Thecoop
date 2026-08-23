import { Loader2, Check, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { usePendingChangeRequests, useReviewChangeRequest } from "@/hooks/useOnboarding";

const FIELD_LABELS: Record<string, string> = {
  legal_first_name: "Legal first name",
  legal_middle_name: "Middle name",
  legal_last_name: "Legal last name",
  date_of_birth: "Date of birth",
  super_choice: "Super choice",
  super_fund_name: "Super fund",
  super_usi: "Super USI",
  super_member_number: "Super member number",
  bank_account_name: "Account name",
  bank_bsb: "BSB",
  bank_account_number: "Account number",
};

/**
 * Bank, super, legal name and DOB changes wait here. A silent bank-account swap
 * is the one change on a profile that costs real money, so it takes a second
 * pair of eyes rather than applying itself.
 */
export default function ChangeRequests() {
  const { data: requests, isLoading } = usePendingChangeRequests();
  const review = useReviewChangeRequest();

  if (isLoading) return null;
  if (!requests?.length) return null;

  const act = async (id: string, approve: boolean) => {
    try {
      await review.mutateAsync({ id, approve });
      toast.success(approve ? "Applied" : "Declined");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/5">
      <div className="flex items-center gap-2 border-b border-sky-500/20 px-4 py-2.5">
        <ShieldAlert className="h-4 w-4 text-sky-600" />
        <h3 className="text-sm font-semibold text-foreground">
          {requests.length} detail {requests.length === 1 ? "change" : "changes"} waiting for approval
        </h3>
      </div>
      <ul className="divide-y divide-sky-500/20">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {r.employee?.full_name ?? "Team member"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {format(new Date(r.requested_at), "d MMM, h:mma")}
                </span>
              </p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(r.payload)
                  .filter(([, v]) => v != null && v !== "")
                  .map(([k, v]) => (
                    <li key={k} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{FIELD_LABELS[k] ?? k}:</span> {String(v)}
                    </li>
                  ))}
              </ul>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => act(r.id, true)}
                disabled={review.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {review.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approve
              </button>
              <button
                onClick={() => act(r.id, false)}
                disabled={review.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
