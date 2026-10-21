import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarX2, Plus, UserMinus, Users } from "lucide-react";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { EXIT_REASON_LABEL, EXIT_REASONS, useOffboardings } from "@/hooks/useOffboarding";
import { StartExitDialog } from "@/components/team/StartExitDialog";
import { OffboardingDrawer } from "@/components/team/OffboardingDrawer";
import { EmptyState, LoadingRows, Panel, Stat } from "@/components/team/TeamUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSetPageContextLine } from "@/contexts/PageContextLine";
import { cn } from "@/lib/utils";
import type { ExitReason, OffboardingRow } from "@/types";

// ============================================================================
// OFFBOARDING
// ----------------------------------------------------------------------------
// Two tabs over one list. "In progress" is anyone whose access has not been
// revoked yet — the window where the checklist still matters and the exit
// survey can still be answered. "Alumni" is everyone else, filterable by venue,
// reason and whether you'd have them back.
// ============================================================================

type Tab = "current" | "alumni";

export default function TeamOffboardingPage() {
  const { data: venues = [] } = useRestaurants();
  const { selectedRestaurantIds } = useSelectedRestaurant();
  const { data: exits = [], isLoading, isError } = useOffboardings(
    selectedRestaurantIds.length ? selectedRestaurantIds : undefined
  );

  const [tab, setTab] = useState<Tab>("current");
  const [starting, setStarting] = useState(false);
  const [drawer, setDrawer] = useState<OffboardingRow | null>(null);

  // Alumni filters
  const [venueFilter, setVenueFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState<ExitReason | "">("");
  const [rehireFilter, setRehireFilter] = useState<"" | "yes" | "no">("");

  const current = useMemo(() => exits.filter((e) => !e.access_revoked_at), [exits]);
  const alumni = useMemo(() => {
    let rows = exits.filter((e) => !!e.access_revoked_at);
    if (venueFilter) rows = rows.filter((e) => e.restaurant_id === venueFilter);
    if (reasonFilter) rows = rows.filter((e) => e.reason === reasonFilter);
    if (rehireFilter)
      rows = rows.filter((e) => e.eligible_for_rehire === (rehireFilter === "yes"));
    return rows;
  }, [exits, venueFilter, reasonFilter, rehireFilter]);

  const openShifts = current.reduce((n, e) => n + e.shifts_unassigned, 0);

  useSetPageContextLine(
    exits.length
      ? `${current.length} in progress · ${exits.length - current.length} alumni`
      : "No exits recorded"
  );

  const rows = tab === "current" ? current : alumni;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserMinus className="h-7 w-7 text-primary" />
          <h1 className="font-display text-2xl font-bold text-foreground">Offboarding</h1>
        </div>
        <Button size="sm" onClick={() => setStarting(true)}>
          <Plus className="h-3.5 w-3.5" />
          Start an exit
        </Button>
      </div>

      <div className="flex flex-wrap gap-0.5 rounded-lg border border-border-strong bg-card p-0.5">
        {(
          [
            { key: "current", label: "In progress", icon: CalendarX2 },
            { key: "alumni", label: "Alumni", icon: Users },
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

      {tab === "current" && (
        <Panel>
          <div className="grid grid-cols-3 gap-5">
            <Stat label="In progress" value={current.length} context="access not ended yet" />
            <Stat
              label="Shifts to fill"
              value={openShifts}
              tone={openShifts ? "warning" : "muted"}
              context={openShifts ? "opened by these exits" : "none outstanding"}
            />
            <Stat
              label="Checklists open"
              value={current.filter((e) => !e.checklist_complete).length}
              tone={current.some((e) => !e.checklist_complete) ? "warning" : "muted"}
              context="uniform, keys, logins, pay"
            />
          </div>
        </Panel>
      )}

      {tab === "alumni" && (
        <Panel title="Filter">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="eyebrow">Venue</span>
              <select
                className="h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm"
                value={venueFilter}
                onChange={(e) => setVenueFilter(e.target.value)}
              >
                <option value="">Any venue</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="eyebrow">Reason</span>
              <select
                className="h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm"
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value as ExitReason | "")}
              >
                <option value="">Any reason</option>
                {EXIT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="eyebrow">Would hire again</span>
              <select
                className="h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm"
                value={rehireFilter}
                onChange={(e) => setRehireFilter(e.target.value as "" | "yes" | "no")}
              >
                <option value="">Either</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
        </Panel>
      )}

      <Panel title={tab === "current" ? "Exits in progress" : "Alumni"}>
        {isLoading ? (
          <LoadingRows rows={4} />
        ) : isError ? (
          <EmptyState
            icon={UserMinus}
            title="Offboarding isn't set up in the database yet"
            hint="Run migration 095_team_offboarding.sql in Supabase, then reload this page."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={tab === "current" ? CalendarX2 : Users}
            title={tab === "current" ? "No exits in progress" : "Nobody in the alumni list"}
            hint={
              tab === "current"
                ? "When someone leaves, start their exit here — the shifts after their last day open up on their own."
                : "People appear here once their access has ended."
            }
            action={
              tab === "current" ? (
                <Button onClick={() => setStarting(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Start an exit
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {rows.map((e) => (
              <button
                key={e.id}
                onClick={() => setDrawer(e)}
                className="flex w-full flex-wrap items-center gap-3 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {e.employee_name}
                    </span>
                    <Badge variant="outline">{EXIT_REASON_LABEL[e.reason]}</Badge>
                    {!e.eligible_for_rehire && <Badge variant="destructive">No rehire</Badge>}
                    {tab === "current" && !e.checklist_complete && (
                      <Badge variant="warning">Checklist open</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                    {e.venue_name ?? "No venue"} · last shift{" "}
                    {format(parseISO(e.last_shift_date), "d MMM yyyy")}
                    {e.shifts_unassigned > 0 && ` · ${e.shifts_unassigned} shift(s) opened`}
                    {e.access_revoked_at
                      ? ` · access ended ${format(parseISO(e.access_revoked_at), "d MMM")}`
                      : e.access_revoke_at
                      ? ` · access ends ${format(parseISO(e.access_revoke_at), "d MMM")}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] text-primary">Open</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {starting && (
        <StartExitDialog onClose={() => setStarting(false)} onStarted={() => setStarting(false)} />
      )}
      {drawer && <OffboardingDrawer exit={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
