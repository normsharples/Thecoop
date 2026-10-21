import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  CalendarX2,
  Check,
  Loader2,
  Lock,
  MessageSquareHeart,
  RotateCcw,
  Save,
  ShieldOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  EXIT_REASON_LABEL,
  useExitSurveyResponses,
  useOffboardingActions,
  useOffboardingChecklist,
  useOffboardingNotes,
  useToggleExitChecklist,
} from "@/hooks/useOffboarding";
import { useTeamAudit, auditActionLabel } from "@/hooks/useTeamAudit";
import { ScaleValue } from "./ScaleAnswer";
import { LoadingRows } from "./TeamUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { OffboardingRow } from "@/types";

/**
 * One exit, in a slide-over.
 *
 * The private-notes panel only renders when the view says `can_view_notes`, and
 * the notes themselves come from a separate RPC the database refuses unless you
 * are a brand admin. Two layers, because hiding a panel is not security.
 */
export function OffboardingDrawer({
  exit,
  onClose,
}: {
  exit: OffboardingRow;
  onClose: () => void;
}) {
  const { data: checklist = [], isLoading } = useOffboardingChecklist(exit.id);
  const { data: notes, isLoading: notesLoading } = useOffboardingNotes(
    exit.id,
    exit.can_view_notes
  );
  const { data: answers = [] } = useExitSurveyResponses(exit.id, exit.can_view_notes);
  const { data: audit = [] } = useTeamAudit({ subjectId: exit.id, limit: 20 });
  const toggle = useToggleExitChecklist();
  const { setNotes, reinvite } = useOffboardingActions();

  const [draftNotes, setDraftNotes] = useState<string | null>(null);

  const revoked = !!exit.access_revoked_at;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-card"
        role="dialog"
        aria-label={`${exit.employee_name} exit`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-card-foreground">
              {exit.employee_name}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
              <Badge variant={revoked ? "outline" : "warning"}>
                {revoked ? "Access ended" : "Access ends soon"}
              </Badge>
              {EXIT_REASON_LABEL[exit.reason]} · last shift{" "}
              {format(parseISO(exit.last_shift_date), "d MMM yyyy")}
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
          {/* The mechanics */}
          <section className="space-y-2">
            <p className="eyebrow">What happened</p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2.5">
                <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-foreground">
                  {exit.shifts_unassigned === 0
                    ? "No shifts after their last day to reassign."
                    : `${exit.shifts_unassigned} shift${
                        exit.shifts_unassigned === 1 ? "" : "s"
                      } opened up for someone else to pick up.`}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                {revoked ? (
                  <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                )}
                <span className={revoked ? "text-foreground" : "text-warning"}>
                  {revoked
                    ? `Access ended ${format(parseISO(exit.access_revoked_at!), "d MMM yyyy, HH:mm")}.`
                    : exit.access_revoke_at
                    ? `Access ends ${format(parseISO(exit.access_revoke_at), "d MMM yyyy, HH:mm")}.`
                    : "No revocation scheduled."}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-foreground">
                  {exit.eligible_for_rehire
                    ? "Marked as someone you'd hire again."
                    : "Marked as not eligible for rehire."}
                </span>
              </li>
            </ul>
          </section>

          {/* Checklist */}
          <section className="space-y-2">
            <p className="eyebrow">Exit checklist</p>
            {isLoading ? (
              <LoadingRows rows={4} />
            ) : checklist.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                This brand has no exit checklist set up. Add one under Settings → Brands → Team.
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
                          toggle.mutate({
                            rowId: row.id,
                            offboardingId: exit.id,
                            done: c === true,
                          })
                        }
                      />
                      <span
                        className={
                          row.done ? "text-muted-foreground line-through" : "text-foreground"
                        }
                      >
                        {row.label}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Exit survey answers — brand admin only */}
          {exit.can_view_notes && (
            <section className="space-y-2">
              <p className="eyebrow">Exit survey</p>
              {!exit.exit_survey_enabled ? (
                <p className="text-[13px] text-muted-foreground">Not asked.</p>
              ) : !exit.exit_survey_completed_at ? (
                <p className="text-[13px] text-muted-foreground">
                  Waiting for them to answer, or they declined.
                </p>
              ) : answers.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">They chose not to answer.</p>
              ) : (
                <ul className="space-y-2.5 rounded-lg border border-border p-3">
                  {answers.map((a) => (
                    <li key={a.id} className="text-sm">
                      <p className="text-muted-foreground">{a.question_text}</p>
                      <p className="mt-0.5 text-foreground">
                        {a.value_int != null ? (
                          <ScaleValue average={a.value_int} />
                        ) : (
                          a.value_text
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
                <MessageSquareHeart className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Named, not anonymous — and only you and a superadmin can read it.
              </p>
            </section>
          )}

          {/* Private notes — brand admin only */}
          {exit.can_view_notes && (
            <section className="space-y-2">
              <p className="eyebrow">Private notes</p>
              {notesLoading ? (
                <LoadingRows rows={2} />
              ) : (
                <>
                  <Textarea
                    rows={4}
                    value={draftNotes ?? notes ?? ""}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    placeholder="Visible to you and superadmins only."
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={draftNotes === null || setNotes.isPending}
                    onClick={async () => {
                      try {
                        await setNotes.mutateAsync({ id: exit.id, notes: draftNotes ?? "" });
                        setDraftNotes(null);
                        toast.success("Notes saved");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Couldn't save the notes");
                      }
                    }}
                  >
                    {setNotes.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save notes
                  </Button>
                </>
              )}
            </section>
          )}

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
          <span
            className={cn(
              "text-[13px]",
              exit.checklist_complete ? "text-success" : "text-muted-foreground"
            )}
          >
            {exit.checklist_complete ? (
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                Checklist done
              </span>
            ) : (
              "Checklist outstanding"
            )}
          </span>
          {exit.eligible_for_rehire && (
            <Button
              size="sm"
              variant="outline"
              disabled={reinvite.isPending}
              onClick={async () => {
                if (
                  !confirm(
                    `Re-invite ${exit.employee_name} through onboarding? They'll get a fresh link and stay off the roster until they finish it.`
                  )
                )
                  return;
                try {
                  await reinvite.mutateAsync(exit.id);
                  toast.success("Re-invited — find them under Onboarding");
                  onClose();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Couldn't re-invite them");
                }
              }}
            >
              {reinvite.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Re-invite
            </Button>
          )}
        </footer>
      </aside>
    </>
  );
}
