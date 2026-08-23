import { useEffect, useMemo, useState } from "react";
import { Loader2, GraduationCap, Users } from "lucide-react";
import { toast } from "sonner";
import { useEmployees } from "@/hooks/useEmployees";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePositions } from "@/hooks/usePositions";
import { useStationTraining } from "@/hooks/useStationTraining";
import { effectiveColour } from "@/lib/positions";
import { cn, getInitials } from "@/lib/utils";
import type { Position, ProficiencyLevel } from "@/types";

const LEVELS: { value: ProficiencyLevel; label: string }[] = [
  { value: "basic", label: "Basic" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

// Cell tint per level so the matrix is scannable at a glance.
const LEVEL_CLASS: Record<ProficiencyLevel, string> = {
  basic: "bg-slate-500/10 text-slate-600 border-slate-500/30",
  intermediate: "bg-warning/10 text-warning border-warning/30",
  advanced: "bg-success/10 text-success border-success/30",
};

type Column = { position: Position; isArea: boolean };

export default function TrainingSettings() {
  const { data: employees = [], isLoading: loadingEmp } = useEmployees();
  const { data: restaurants = [] } = useRestaurants();
  const [venueId, setVenueId] = useState<string>("");
  useEffect(() => {
    if (!venueId && restaurants.length) setVenueId(restaurants[0].id);
  }, [restaurants, venueId]);
  const { positions, activePositions, isLoading: loadingPos } = usePositions(venueId || null);
  const { training, isLoading: loadingTrain, setLevel, clearLevel } =
    useStationTraining();

  const byId = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  // Areas (in configured order), each followed by its own "General" column and
  // then its sub-areas — the same stations a shift can be assigned to.
  const { columns, areaGroups } = useMemo(() => {
    const areas = activePositions.filter((p) => !p.parent_id);
    const cols: Column[] = [];
    const groups: { area: Position; span: number }[] = [];
    for (const area of areas) {
      const subs = activePositions.filter((s) => s.parent_id === area.id);
      cols.push({ position: area, isArea: true });
      for (const sub of subs) cols.push({ position: sub, isArea: false });
      groups.push({ area, span: 1 + subs.length });
    }
    return { columns: cols, areaGroups: groups };
  }, [activePositions]);

  // (employee_id|position_id) → level for quick cell lookups.
  const levelMap = useMemo(() => {
    const m = new Map<string, ProficiencyLevel>();
    for (const t of training) m.set(`${t.employee_id}|${t.position_id}`, t.level);
    return m;
  }, [training]);

  const handleChange = async (
    employeeId: string,
    positionId: string,
    value: string
  ) => {
    try {
      if (value === "") {
        await clearLevel({ employee_id: employeeId, position_id: positionId });
      } else {
        await setLevel({
          employee_id: employeeId,
          position_id: positionId,
          level: value as ProficiencyLevel,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save training");
    }
  };

  const isLoading = loadingEmp || loadingPos || loadingTrain;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Station training</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Set which stations each team member is trained on and how proficient
            they are. Auto-build uses this to fill each shift — advanced people
            first, then intermediate, then basic. Leave a cell blank if they aren't
            trained on that station. Stations shown are for the selected venue.
          </p>
        </div>
        <select
          value={venueId}
          onChange={(e) => setVenueId(e.target.value)}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Levels:</span>
        {LEVELS.map((l) => (
          <span
            key={l.value}
            className={cn(
              "rounded-full border px-2 py-0.5 font-medium",
              LEVEL_CLASS[l.value]
            )}
          >
            {l.label}
          </span>
        ))}
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          Blank = not trained
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-12 text-center text-muted-foreground">
          <Users className="mb-2 h-10 w-10" />
          <p className="text-sm">
            No rosterable team members yet. Flag people as rosterable under the
            Members tab first.
          </p>
        </div>
      ) : columns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-12 text-center text-muted-foreground">
          <GraduationCap className="mb-2 h-10 w-10" />
          <p className="text-sm">
            No stations yet. Add areas and sub-areas in Settings → Positions,
            then set training here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              {/* Area group row */}
              <tr className="border-b border-border bg-muted/30">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 min-w-[180px] bg-muted/30 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Team member
                </th>
                {areaGroups.map((g) => (
                  <th
                    key={g.area.id}
                    colSpan={g.span}
                    className="border-l border-border px-2 py-1.5 text-center text-xs font-semibold text-foreground"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: effectiveColour(g.area.id, byId) }}
                      />
                      {g.area.name}
                    </span>
                  </th>
                ))}
              </tr>
              {/* Station row */}
              <tr className="border-b border-border bg-muted/20">
                {columns.map((c) => (
                  <th
                    key={c.position.id}
                    className="min-w-[130px] border-l border-border px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground"
                  >
                    {c.isArea ? "General" : c.position.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-muted/10">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: emp.display_colour ?? "#94a3b8" }}
                      >
                        {getInitials(emp.full_name)}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {emp.full_name}
                      </span>
                    </div>
                  </td>
                  {columns.map((c) => {
                    const current =
                      levelMap.get(`${emp.id}|${c.position.id}`) ?? "";
                    return (
                      <td
                        key={c.position.id}
                        className="border-l border-border px-1.5 py-1.5 text-center"
                      >
                        <select
                          value={current}
                          onChange={(e) =>
                            handleChange(emp.id, c.position.id, e.target.value)
                          }
                          className={cn(
                            "h-8 w-full rounded-md border px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring",
                            current
                              ? LEVEL_CLASS[current]
                              : "border-input bg-background text-muted-foreground"
                          )}
                        >
                          <option value="">—</option>
                          {LEVELS.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
