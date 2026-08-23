import { useMemo, useState } from "react";
import {
  Loader2, Send, Printer, AlertTriangle, FileSignature, Archive, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useContractTemplates } from "@/hooks/useContractTemplates";
import { useCompanySettings, useEmployeeProfile, useOnboardingList, useOnboardingActions } from "@/hooks/useOnboarding";
import {
  useEmployeeContracts, useArchiveContract, useAutoIssueContract, useIssueBlockers,
  ISSUE_REASONS, previewContract, renderSignedDocument,
} from "@/hooks/useContracts";
import { CONTRACT_CSS, printContract, withSignature, groupMissingBySource } from "@/lib/contract";
import { SelectInput, Field } from "./fields";
import type { EmployeeContract, ContractStatus } from "@/types";

/** Why the contract has not sent itself yet — one line per reason. */
function IssueBlockers({ employeeId }: { employeeId: string }) {
  const { data: blockers } = useIssueBlockers(employeeId);
  if (!blockers || blockers.length === 0) return null;
  // "Already signed" / "already out for signature" are outcomes, not problems.
  const problems = blockers.filter(
    (b) => !b.startsWith("They have already signed") && !b.startsWith("A contract is already out")
  );
  if (problems.length === 0) return null;

  return (
    <div className="mt-3 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="text-foreground">
        <p className="font-medium">Not sent automatically yet:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {problems.map((b) => <li key={b}>{b}</li>)}
        </ul>
      </div>
    </div>
  );
}

/**
 * Contracts go out on their own once both halves are ready. This says so, and
 * lets you switch it off for one person when you want to read theirs first.
 */
function AutoIssueNote({ employeeId }: { employeeId: string }) {
  const { data: rows } = useOnboardingList();
  const { update } = useOnboardingActions();
  const row = rows?.find((r) => r.employee_id === employeeId);
  if (!row || !row.issue_contract || row.contract_signed) return null;

  return (
    <label className="mt-3 flex items-start gap-2.5 rounded-md border border-border bg-muted/40 p-3">
      <input
        type="checkbox"
        checked={row.auto_issue !== false}
        onChange={(e) => update.mutate({ employeeId, patch: { auto_issue: e.target.checked } })}
        className="mt-0.5 h-4 w-4"
      />
      <span className="text-xs">
        <span className="font-medium text-foreground">Send automatically</span>
        <span className="block text-muted-foreground">
          The contract goes out by itself as soon as the employment terms are set and they've
          finished their own details — signed in the name of whoever started their onboarding.
          Untick to review theirs by hand first.
        </span>
      </span>
    </label>
  );
}

const EMP_TERM: Record<string, string> = {
  casual: "Casual", part_time: "Part-time", full_time: "Full-time",
};

function TermCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? "font-medium text-foreground" : "font-medium text-warning"}>
        {value ?? "Not set"}
      </dd>
    </div>
  );
}

const STATUS_LABEL: Record<ContractStatus, { label: string; className: string }> = {
  draft:      { label: "Draft",      className: "bg-muted text-muted-foreground" },
  issued:     { label: "Sent",       className: "bg-warning/10 text-warning" },
  viewed:     { label: "Opened",     className: "bg-sky-500/10 text-sky-600" },
  signed:     { label: "Signed",     className: "bg-success/10 text-success" },
  declined:   { label: "Declined",   className: "bg-destructive/10 text-destructive" },
  superseded: { label: "Replaced",   className: "bg-muted text-muted-foreground" },
};

export default function ContractPanel({ employeeId }: { employeeId: string }) {
  const { data: profile } = useEmployeeProfile(employeeId);
  const { data: templates } = useContractTemplates();
  const { data: restaurants } = useRestaurants();
  const { data: company } = useCompanySettings();
  const { data: contracts, isLoading } = useEmployeeContracts(employeeId);
  const issue = useAutoIssueContract();
  const archive = useArchiveContract();

  const [kind, setKind] = useState<"contract" | "variation">("contract");
  const [templateId, setTemplateId] = useState<string>("");
  const [showPreview, setShowPreview] = useState(false);

  const restaurant = restaurants?.find((r) => r.id === profile?.home_restaurant_id) ?? null;

  const preview = useMemo(() => {
    if (!profile || !templates || !company) return null;
    try {
      return previewContract({
        profile, templates, restaurant, company, kind,
        templateId: templateId || null,
      });
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [profile, templates, company, restaurant, kind, templateId]);

  const openContract = (contracts ?? []).find((c) => ["issued", "viewed"].includes(c.status));

  /**
   * Every issued document stores the token values it was rendered with, so we
   * can compare what they signed against what is true now. A pay rise or a move
   * from casual to part-time makes the signed contract wrong — that is a
   * variation, not a profile edit.
   */
  const drift = useMemo(() => {
    const lastSigned = (contracts ?? [])
      .filter((c) => c.status === "signed")
      .sort((a, b) => (b.signed_at ?? "").localeCompare(a.signed_at ?? ""))[0];
    if (!lastSigned || !preview || "error" in preview) return null;
    const WATCH: [string, string][] = [
      ["employment.pay_rate", "Pay rate"],
      ["employment.salary", "Salary"],
      ["employment.type", "Employment type"],
      ["employment.position", "Position"],
      ["employment.hours", "Contracted hours"],
      ["award.level", "Award level"],
      ["restaurant.name", "Store"],
    ];
    const changed = WATCH.filter(([k]) => {
      const was = lastSigned.tokens?.[k] ?? "";
      const now = preview.tokens[k] ?? "";
      return was !== now;
    }).map(([, label]) => label);
    return changed.length ? { changed, signedAt: lastSigned.signed_at } : null;
  }, [contracts, preview]);

  const doIssue = async () => {
    if (!profile) return;
    try {
      const res = await issue.mutateAsync({
        employeeId: profile.id,
        kind,
        templateId: templateId || null,
        force: true, // an explicit click overrides the readiness gate
      });
      if (res?.issued) {
        toast.success(
          `Contract sent${res.signatory ? `, signed as ${res.signatory}` : ""} — they'll see it next time they open the app.`
        );
        setShowPreview(false);
      } else {
        toast.error(ISSUE_REASONS[res?.reason ?? ""] ?? "Contract could not be sent.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const print = (c: EmployeeContract) => {
    if (!company) return;
    try {
      printContract(renderSignedDocument(c, company), "Employment agreement");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (isLoading || !profile) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const hasError = preview && "error" in preview;
  const missing = preview && !("error" in preview) ? preview.missing : [];

  return (
    <div className="space-y-5">
      {/* Issue */}
      <div className="rounded-lg border border-border p-4">
        <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <FileSignature className="h-4 w-4" /> Issue a document
        </h4>

        {/* What the contract will actually print — so "but I filled that in"
            can be checked at a glance against what the app really holds. */}
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/40 p-3 text-xs sm:grid-cols-4">
          <TermCell label="Employment type" value={profile.employment_type ? EMP_TERM[profile.employment_type] : null} />
          <TermCell label="Award level" value={profile.award_level ? `Level ${profile.award_level}` : null} />
          <TermCell
            label={profile.pay_type === "salary" ? "Salary" : "Base rate"}
            value={
              profile.pay_type === "salary"
                ? profile.salary_annual != null ? `$${profile.salary_annual.toLocaleString()}` : null
                : preview && !("error" in preview) ? preview.tokens["employment.pay_rate"] || null : null
            }
          />
          <TermCell label="Store" value={restaurant?.name ?? null} />
        </dl>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <SelectInput
              value={kind}
              onChange={(v) => { setKind(v as "contract" | "variation"); setTemplateId(""); }}
              options={[
                { value: "contract", label: "Employment contract" },
                { value: "variation", label: "Variation of terms" },
              ]}
            />
          </Field>
          <Field label="Template" hint="Leave on automatic unless you need a specific one.">
            <SelectInput
              value={templateId}
              onChange={setTemplateId}
              placeholder="Automatic (best match)"
              options={(templates ?? [])
                .filter((t) => t.kind === kind && t.active)
                .map((t) => ({ value: t.id, label: `${t.name} (v${t.version})` }))}
            />
          </Field>
        </div>

        {hasError && (
          <div className="mt-3 flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-foreground">{(preview as { error: string }).error}</p>
          </div>
        )}

        {!hasError && missing.length > 0 && (
          <div className="mt-3 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 text-foreground">
              <p className="font-medium">Not ready to send.</p>
              <p className="mb-2 text-xs text-muted-foreground">
                This template uses fields that are still empty. They would print as visible gaps in
                the signed contract, so here is where each one is set:
              </p>
              <ul className="space-y-1.5">
                {groupMissingBySource(missing).map((g) => (
                  <li key={g.source} className="text-xs">
                    <span className="font-medium text-foreground">{g.source}</span>
                    <span className="text-muted-foreground"> — {g.labels.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {drift && !openContract && (
          <div className="mt-3 flex gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <div className="text-foreground">
              <p className="font-medium">Their terms have changed since they signed.</p>
              <p className="text-xs">
                {drift.changed.join(", ")} {drift.changed.length === 1 ? "is" : "are"} different from
                the contract signed{drift.signedAt ? ` on ${format(new Date(drift.signedAt), "d MMM yyyy")}` : ""}.
                Issue a <span className="font-medium">variation of terms</span> so the paperwork matches.
              </p>
            </div>
          </div>
        )}

        <IssueBlockers employeeId={profile.id} />
        <AutoIssueNote employeeId={profile.id} />

        {openContract && (
          <p className="mt-3 text-xs text-muted-foreground">
            There is already a contract waiting to be signed. Issuing a new one replaces it.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setShowPreview((p) => !p)}
            disabled={!!hasError}
            className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {showPreview ? "Hide preview" : "Preview"}
          </button>
          <button
            onClick={doIssue}
            disabled={!!hasError || missing.length > 0 || issue.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {issue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send for signature
          </button>
        </div>

        {showPreview && preview && !("error" in preview) && (
          <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-border bg-white p-5">
            <style>{CONTRACT_CSS}</style>
            <div
              className="contract-doc"
              dangerouslySetInnerHTML={{
                __html: withSignature(preview.bodyHtml, {
                  employeeName: preview.tokens["employee.legal_name"],
                  employerName: company?.signatory_name,
                  employerTitle: company?.signatory_title,
                  employerSignature: company?.signature_image || null,
                }),
              }}
            />
          </div>
        )}
      </div>

      {/* History */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">History</h4>
        {!contracts?.length ? (
          <p className="text-sm text-muted-foreground">Nothing issued yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {contracts.map((c) => (
              <li key={c.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {c.template_name ?? (c.kind === "variation" ? "Variation" : "Employment agreement")}
                      {c.template_version != null && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">v{c.template_version}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.issued_at && `Sent ${format(new Date(c.issued_at), "d MMM yyyy")}`}
                      {c.auto_issued && " automatically"}
                      {c.employer_signatory_name && ` · authorised by ${c.employer_signatory_name}`}
                      {c.signed_at && ` · signed ${format(new Date(c.signed_at), "d MMM yyyy, h:mma")}`}
                    </p>
                    {c.status === "signed" && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Signed as “{c.signature_name}”
                        {c.signature_ip && ` from ${c.signature_ip}`}
                        {c.content_hash && ` · fingerprint ${c.content_hash.slice(0, 12)}…`}
                      </p>
                    )}
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_LABEL[c.status].className)}>
                    {STATUS_LABEL[c.status].label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => print(c)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs"
                  >
                    <Printer className="h-3.5 w-3.5" /> Open / PDF
                  </button>
                  {c.status === "signed" && company && (
                    <button
                      onClick={async () => {
                        try {
                          await archive.mutateAsync({ contract: c, company });
                          toast.success("Saved a file copy");
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                      disabled={archive.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs disabled:opacity-50"
                    >
                      {c.storage_path ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Archive className="h-3.5 w-3.5" />}
                      {c.storage_path ? "File copy saved" : "Save file copy"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
