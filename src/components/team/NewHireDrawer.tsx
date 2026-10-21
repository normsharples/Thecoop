import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileCheck2,
  FileText,
  GraduationCap,
  Link2,
  Loader2,
  Paperclip,
  QrCode,
  ShieldAlert,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  HIRE_STATUS_LABEL,
  newHireDocUrl,
  useNewHire,
  useNewHireActions,
  useNewHireCertificates,
  useNewHireChecklist,
  useNewHireSignoffs,
  useNewHireTraining,
  useToggleHireChecklist,
  useToggleHireTraining,
} from "@/hooks/useNewHires";
import { useEmployees } from "@/hooks/useEmployees";
import { useTeamAudit, auditActionLabel } from "@/hooks/useTeamAudit";
import { LoadingRows } from "./TeamUI";
import { InviteLinkDialog } from "./InviteLinkDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { NewHire } from "@/types";

const statusVariant = (s: NewHire["status"]) =>
  s === "ready" || s === "active" ? "success" : s === "in_progress" ? "warning" : "outline";

/**
 * Everything about one hire, in a slide-over: where their paperwork stands, the
 * manager's checklist, their training, and the trail of status changes.
 *
 * The checklist is the manager's half of "ready". Anything the hire has to do
 * is read-only here — the manager cannot tick it on their behalf, because the
 * policy sign-off is a signature.
 */
export function NewHireDrawer({
  hireId,
  fallback,
  onClose,
}: {
  hireId: string;
  /** The row the list already had, so the drawer opens with content on screen. */
  fallback: NewHire;
  onClose: () => void;
}) {
  // Ticking a checklist item changes the hire's status, so the drawer follows
  // the live row rather than the snapshot the list handed it.
  const { data: live } = useNewHire(hireId);
  const hire = live ?? fallback;

  const { data: certs = [] } = useNewHireCertificates(hire.id);
  const { data: signoffs = [] } = useNewHireSignoffs(hire.id);
  const { data: checklist = [], isLoading: checklistLoading } = useNewHireChecklist(hire.id);
  const { data: training = [] } = useNewHireTraining(hire.id);
  const { data: audit = [] } = useTeamAudit({ subjectId: hire.id, limit: 20 });
  const { data: employees = [] } = useEmployees();
  const toggleChecklist = useToggleHireChecklist();
  const toggleTraining = useToggleHireTraining();
  const { linkProfile, remove } = useNewHireActions();

  const [showInvite, setShowInvite] = useState(false);
  const [linkTo, setLinkTo] = useState("");

  const steps = [
    { label: "Personal details", done: hire.details_complete },
    { label: "Certificates", done: hire.certificates_complete },
    { label: "Policy sign-offs", done: hire.policies_complete },
    { label: "Payroll", done: hire.payroll_confirmed },
    { label: "Manager checklist", done: hire.checklist_complete },
  ];

  const openDoc = async (path: string) => {
    try {
      window.open(await newHireDocUrl(path), "_blank", "noopener");
    } catch {
      toast.error("Couldn't open that file");
    }
  };

  const unlinked = employees.filter((e) => e.id !== hire.profile_id);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-card"
        role="dialog"
        aria-label={`${hire.full_name} onboarding`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-card-foreground">
              {hire.full_name}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
              <Badge variant={statusVariant(hire.status)}>{HIRE_STATUS_LABEL[hire.status]}</Badge>
              {hire.start_date && <>starts {format(parseISO(hire.start_date), "d MMM")}</>}
              {hire.mobile && <>· {hire.mobile}</>}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* Where they're up to */}
          <section className="space-y-2">
            <p className="eyebrow">Progress</p>
            <ul className="space-y-1.5">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      s.done ? "bg-success-soft text-success" : "bg-surface-sunken text-muted-foreground"
                    )}
                  >
                    {s.done ? <Check className="h-3 w-3" /> : <span className="text-[10px]">•</span>}
                  </span>
                  <span className={s.done ? "text-foreground" : "text-muted-foreground"}>
                    {s.label}
                  </span>
                </li>
              ))}
            </ul>
            {hire.status !== "ready" && hire.status !== "active" && (
              <p className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning-soft p-2.5 text-[13px] text-warning">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                They can't be put on the roster until every line above is done.
              </p>
            )}
          </section>

          {/* The invite */}
          <section className="space-y-2">
            <p className="eyebrow">Invite</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowInvite(true)}>
                <QrCode className="h-3.5 w-3.5" />
                Link &amp; QR code
              </Button>
              <span className="text-[13px] text-muted-foreground">
                {hire.invite_opened_at
                  ? `Opened ${format(parseISO(hire.invite_opened_at), "d MMM, HH:mm")}`
                  : "Not opened yet"}
              </span>
            </div>
          </section>

          {/* Certificates */}
          <section className="space-y-2">
            <p className="eyebrow">Certificates</p>
            {certs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing uploaded yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {certs.map((c) => {
                  const expired = c.expires_on && parseISO(c.expires_on) < new Date();
                  return (
                    <li key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                      <FileCheck2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {c.label || c.kind}
                      </span>
                      {c.expires_on && (
                        <span
                          className={cn(
                            "shrink-0 text-[12px] tnum",
                            expired ? "font-semibold text-destructive" : "text-muted-foreground"
                          )}
                        >
                          {expired ? "expired " : "to "}
                          {format(parseISO(c.expires_on), "d MMM yy")}
                        </span>
                      )}
                      {c.file_path && (
                        <button
                          onClick={() => void openDoc(c.file_path!)}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                          aria-label={`Open ${c.label || c.kind}`}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Policy sign-offs */}
          <section className="space-y-2">
            <p className="eyebrow">Policy sign-offs</p>
            {signoffs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">None signed yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {signoffs.map((s) => (
                  <li key={s.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {s.document_title}
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          v{s.document_version}
                        </span>
                      </span>
                    </div>
                    <p className="mt-0.5 pl-6 text-[12px] text-muted-foreground">
                      Signed “{s.typed_name}” · {format(parseISO(s.signed_at), "d MMM yyyy, HH:mm")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Manager checklist */}
          <section className="space-y-2">
            <p className="eyebrow">Your checklist</p>
            {checklistLoading ? (
              <LoadingRows rows={3} />
            ) : checklist.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                This brand has no induction checklist set up. Add one under Settings → Brands →
                Team.
              </p>
            ) : (
              <ul className="space-y-1.5 rounded-lg border border-border p-3">
                {checklist.map((row) => (
                  <li key={row.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={row.done}
                        onCheckedChange={(c) =>
                          toggleChecklist.mutate({
                            rowId: row.id,
                            hireId: hire.id,
                            done: c === true,
                          })
                        }
                      />
                      <span className={row.done ? "text-muted-foreground line-through" : "text-foreground"}>
                        {row.label}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Training */}
          <section className="space-y-2">
            <p className="eyebrow">Training</p>
            {training.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Assigned automatically once they submit their form.
              </p>
            ) : (
              <ul className="space-y-1.5 rounded-lg border border-border p-3">
                {training.map((t) => (
                  <li key={t.id} className="flex items-start gap-2.5 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={t.status === "complete"}
                      onCheckedChange={(c) =>
                        toggleTraining.mutate({
                          rowId: t.id,
                          hireId: hire.id,
                          complete: c === true,
                        })
                      }
                    />
                    <span className="flex-1">
                      <span
                        className={
                          t.status === "complete"
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        }
                      >
                        {t.module_name}
                      </span>
                      {t.url && (
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1.5 inline-flex items-center text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ORBIT has no training platform yet, so these are a named list the brand sets up and
              you tick off. Swap it for the real thing when there is one.
            </p>
          </section>

          {/* Link to a login */}
          <section className="space-y-2">
            <p className="eyebrow">ORBIT login</p>
            {hire.profile_id ? (
              <p className="flex items-center gap-1.5 text-[13px] text-success">
                <UserCheck className="h-3.5 w-3.5" />
                Linked to{" "}
                {employees.find((e) => e.id === hire.profile_id)?.full_name ?? "a team member"}
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[13px] text-muted-foreground">
                  Create their login under Settings → Team, then link it here. Their details and
                  certificates copy across.
                </p>
                <div className="flex gap-2">
                  <select
                    aria-label="Team member to link"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 text-sm"
                    value={linkTo}
                    onChange={(e) => setLinkTo(e.target.value)}
                  >
                    <option value="">Pick a team member…</option>
                    {unlinked.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    disabled={!linkTo || linkProfile.isPending}
                    onClick={async () => {
                      try {
                        await linkProfile.mutateAsync({ id: hire.id, profileId: linkTo });
                        toast.success("Linked");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Couldn't link them");
                      }
                    }}
                  >
                    {linkProfile.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    Link
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Trail */}
          <section className="space-y-2">
            <p className="eyebrow">History</p>
            {audit.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {audit.map((a) => (
                  <li key={a.id} className="text-[13px]">
                    <span className="text-foreground">{auditActionLabel(a.action)}</span>
                    {a.from_value && a.to_value && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {a.from_value} → {a.to_value}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {" · "}
                      {format(parseISO(a.created_at), "d MMM, HH:mm")}
                      {a.actor_label ? ` · ${a.actor_label}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={async () => {
              if (
                !confirm(
                  `Delete ${hire.full_name}'s onboarding? Their uploads and sign-offs go with it.`
                )
              )
                return;
              try {
                await remove.mutateAsync(hire.id);
                toast.success("Deleted");
                onClose();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't delete it");
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </footer>
      </aside>

      {showInvite && <InviteLinkDialog hire={hire} onClose={() => setShowInvite(false)} />}
    </>
  );
}

/** Red/amber dot used in the list to show someone is blocked from the roster. */
export function BlockedDot({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px] text-warning"
      title={reasons.join(" · ")}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      {reasons.length} outstanding
    </span>
  );
}
