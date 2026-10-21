import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2,
  FileCheck2,
  Plus,
  QrCode,
  UserPlus,
  Users,
} from "lucide-react";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { HIRE_STATUS_LABEL, useNewHires } from "@/hooks/useNewHires";
import { NewHireDialog } from "@/components/team/NewHireDialog";
import { NewHireDrawer } from "@/components/team/NewHireDrawer";
import { InviteLinkDialog } from "@/components/team/InviteLinkDialog";
import { ComplianceList } from "@/components/team/ComplianceList";
import { EmptyState, LoadingRows, Panel, Stat } from "@/components/team/TeamUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSetPageContextLine } from "@/contexts/PageContextLine";
import { cn } from "@/lib/utils";
import type { NewHire, NewHireStatus } from "@/types";

// ============================================================================
// ONBOARDING
// ----------------------------------------------------------------------------
// The pipeline, in the order a manager thinks about it: who hasn't started, who
// is mid-way, who is ready to go on the roster, and who is already working.
// The second tab is certificate compliance, which is the half of onboarding
// that keeps mattering long after someone has started.
// ============================================================================

type Tab = "pipeline" | "compliance";

const PIPELINE: { key: NewHireStatus | "all"; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "invited", label: "Invited" },
  { key: "in_progress", label: "In progress" },
  { key: "ready", label: "Ready" },
  { key: "active", label: "Active" },
];

export default function TeamOnboardingPage() {
  const { data: venues = [] } = useRestaurants();
  const { selectedRestaurantIds } = useSelectedRestaurant();

  const scopedVenueIds = selectedRestaurantIds.length
    ? selectedRestaurantIds
    : venues.map((v) => v.id);

  const { data: hires = [], isLoading, isError } = useNewHires(
    selectedRestaurantIds.length ? selectedRestaurantIds : undefined
  );

  const [tab, setTab] = useState<Tab>("pipeline");
  const [stage, setStage] = useState<NewHireStatus | "all">("all");
  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState<NewHire | null>(null);
  const [invite, setInvite] = useState<NewHire | null>(null);

  const counts = useMemo(() => {
    const base: Record<NewHireStatus, number> = {
      invited: 0,
      in_progress: 0,
      ready: 0,
      active: 0,
    };
    for (const h of hires) base[h.status] += 1;
    return base;
  }, [hires]);

  const shown = useMemo(
    () => (stage === "all" ? hires : hires.filter((h) => h.status === stage)),
    [hires, stage]
  );

  useSetPageContextLine(
    hires.length
      ? `${counts.invited + counts.in_progress} still to finish · ${counts.ready} ready to roster`
      : "No one in onboarding"
  );

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? "—";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserPlus className="h-7 w-7 text-primary" />
          <h1 className="font-display text-2xl font-bold text-foreground">Onboarding</h1>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add a new hire
        </Button>
      </div>

      <div className="flex flex-wrap gap-0.5 rounded-lg border border-border-strong bg-card p-0.5">
        {(
          [
            { key: "pipeline", label: "Pipeline", icon: Users },
            { key: "compliance", label: "Certificates", icon: FileCheck2 },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "text-secondary-foreground hover:bg-accent"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "compliance" ? (
        <ComplianceList restaurantIds={scopedVenueIds} />
      ) : (
        <>
          <Panel>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="Invited" value={counts.invited} context="haven't opened it" tone="muted" />
              <Stat
                label="In progress"
                value={counts.in_progress}
                context="part way through"
                tone={counts.in_progress ? "warning" : "muted"}
              />
              <Stat
                label="Ready"
                value={counts.ready}
                context="can be rostered"
                tone={counts.ready ? "success" : "muted"}
              />
              <Stat label="Active" value={counts.active} context="have worked a shift" />
            </div>
          </Panel>

          <Panel
            title="Pipeline"
            actions={
              <div className="flex flex-wrap gap-0.5 rounded-lg border border-border-strong bg-card p-0.5">
                {PIPELINE.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setStage(p.key)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors",
                      stage === p.key
                        ? "bg-primary text-primary-foreground"
                        : "text-secondary-foreground hover:bg-accent"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            }
          >
            {isLoading ? (
              <LoadingRows rows={4} />
            ) : isError ? (
              <EmptyState
                icon={UserPlus}
                title="Onboarding isn't set up in the database yet"
                hint="Run migration 094_team_onboarding.sql in Supabase, then reload this page."
              />
            ) : shown.length === 0 ? (
              <EmptyState
                icon={stage === "all" ? UserPlus : CheckCircle2}
                title={
                  stage === "all"
                    ? "Nobody in onboarding"
                    : `No one is ${HIRE_STATUS_LABEL[stage as NewHireStatus].toLowerCase()}`
                }
                hint={
                  stage === "all"
                    ? "Add a hire and you'll get a link and QR code to hand them. They do the rest on their phone."
                    : undefined
                }
                action={
                  stage === "all" ? (
                    <Button onClick={() => setCreating(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      Add a new hire
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {shown.map((h) => {
                  const outstanding = [
                    !h.details_complete && "details",
                    !h.certificates_complete && "certificates",
                    !h.policies_complete && "sign-offs",
                    !h.payroll_confirmed && "payroll",
                    !h.checklist_complete && "your checklist",
                  ].filter(Boolean) as string[];
                  return (
                    <div key={h.id} className="flex flex-wrap items-center gap-3 py-3">
                      <button
                        onClick={() => setDrawer(h)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">
                            {h.full_name}
                          </span>
                          <Badge
                            variant={
                              h.status === "ready" || h.status === "active"
                                ? "success"
                                : h.status === "in_progress"
                                ? "warning"
                                : "outline"
                            }
                          >
                            {HIRE_STATUS_LABEL[h.status]}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {venueName(h.restaurant_id)}
                          {h.start_date && ` · starts ${format(parseISO(h.start_date), "d MMM")}`}
                          {outstanding.length > 0 && ` · waiting on ${outstanding.join(", ")}`}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {h.status !== "active" && (
                          <Button variant="outline" size="sm" onClick={() => setInvite(h)}>
                            <QrCode className="h-3.5 w-3.5" />
                            Link
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setDrawer(h)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </>
      )}

      {creating && (
        <NewHireDialog
          onClose={() => setCreating(false)}
          onCreated={(hire: NewHire) => {
            setCreating(false);
            // Straight to the link — handing it over is the next thing they do.
            setInvite(hire);
          }}
        />
      )}
      {invite && <InviteLinkDialog hire={invite} onClose={() => setInvite(null)} />}
      {drawer && <NewHireDrawer hireId={drawer.id} fallback={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
