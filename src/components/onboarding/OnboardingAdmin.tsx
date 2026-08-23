import { useMemo, useState } from "react";
import {
  ClipboardList,
  Loader2,
  Search,
  Send,
  ShieldAlert,
  CheckCircle2,
  Circle,
  Clock,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useEmployees } from "@/hooks/useEmployees";
import { useOnboardingList, useOnboardingActions, type OnboardingRow } from "@/hooks/useOnboarding";
import { usePermissions } from "@/hooks/usePermissions";
import EmployeeOnboardingDrawer from "./EmployeeOnboardingDrawer";
import ChangeRequests from "./ChangeRequests";
import type { OnboardingStatus } from "@/types";

const STATUS_META: Record<OnboardingStatus, { label: string; className: string }> = {
  pending:     { label: "Not started", className: "bg-warning/10 text-warning border-warning/30" },
  in_progress: { label: "In progress", className: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  complete:    { label: "Complete",    className: "bg-success/10 text-success border-success/30" },
  exempt:      { label: "Exempt",      className: "bg-muted text-muted-foreground border-border" },
  legacy:      { label: "Not required",className: "bg-muted text-muted-foreground border-border" },
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  casual: "Casual",
  part_time: "Part-time",
  full_time: "Full-time",
};

export default function OnboardingAdmin() {
  const { isSuperadmin } = usePermissions();
  const { data: rows, isLoading } = useOnboardingList();
  const { data: restaurants } = useRestaurants();
  const { data: employees } = useEmployees();
  const { request, update } = useOnboardingActions();

  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | OnboardingStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);

  const storeName = (id?: string | null) =>
    restaurants?.find((r) => r.id === id)?.name ?? "—";

  // Rosterable people who have no onboarding record at all yet (created before
  // this feature, or created with onboarding turned off).
  const missing = useMemo(() => {
    if (!employees || !rows) return [];
    const have = new Set(rows.map((r) => r.employee_id));
    return employees.filter((e) => !have.has(e.id));
  }, [employees, rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (storeFilter !== "all" && r.employee?.home_restaurant_id !== storeFilter) return false;
      if (q && !(r.employee?.full_name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, storeFilter, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, in_progress: 0, complete: 0, exempt: 0, legacy: 0 };
    (rows ?? []).forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  if (!isSuperadmin) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Onboarding is managed by a superadmin.
        </p>
      </div>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startFor = async (ids: string[], collectDetails: boolean, issueContract: boolean) => {
    if (!ids.length) return;
    try {
      await request.mutateAsync({ employeeIds: ids, collectDetails, issueContract });
      toast.success(
        ids.length === 1 ? "Onboarding started" : `Onboarding started for ${ids.length} people`
      );
      setSelected(new Set());
      setShowStart(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const setStatus = async (employeeId: string, status: OnboardingStatus) => {
    try {
      await update.mutateAsync({ employeeId, patch: { status } });
      toast.success("Updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <ChangeRequests />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Not started" value={counts.pending} tone="amber" />
        <SummaryCard label="In progress" value={counts.in_progress} tone="sky" />
        <SummaryCard label="Complete" value={counts.complete} tone="emerald" />
        <SummaryCard label="Not required" value={counts.legacy + counts.exempt} tone="muted" />
      </div>

      {missing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">{missing.length}</span> rostered{" "}
            {missing.length === 1 ? "person has" : "people have"} no onboarding record yet.
          </p>
          <button
            onClick={() => startFor(missing.map((m) => m.id), true, true)}
            disabled={request.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {request.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Add them
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team member"
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm"
          />
        </div>
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="all">All stores</option>
          {restaurants?.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | OnboardingStatus)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="pending">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="complete">Complete</option>
          <option value="legacy">Not required</option>
          <option value="exempt">Exempt</option>
        </select>
        {selected.size > 0 && (
          <button
            onClick={() => setShowStart(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            <Send className="h-4 w-4" />
            Start onboarding ({selected.size})
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nobody matches those filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="px-3 py-2">Name</th>
                <th className="hidden px-3 py-2 sm:table-cell">Store</th>
                <th className="hidden px-3 py-2 md:table-cell">Type</th>
                <th className="px-3 py-2">Progress</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.employee_id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.employee_id)}
                      onChange={() => toggle(r.employee_id)}
                      className="h-4 w-4 rounded border-border"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setOpenId(r.employee_id)}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {r.employee?.full_name ?? "Unknown"}
                    </button>
                    {r.skip_allowed && r.status !== "complete" && (
                      <span className="ml-2 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                        skip allowed
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                    {storeName(r.employee?.home_restaurant_id)}
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                    {EMPLOYMENT_LABELS[r.employee?.employment_type ?? ""] ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <ProgressChip label="Details" done={r.details_complete} muted={!r.collect_details} />
                      <ProgressChip label="Tax & bank" done={r.sensitive_complete} muted={!r.collect_details} />
                      <ProgressChip label="Contract" done={r.contract_signed} muted={!r.issue_contract} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_META[r.status].className)}>
                      {STATUS_META[r.status].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RowMenu
                      row={r}
                      onOpen={() => setOpenId(r.employee_id)}
                      onStatus={(s) => setStatus(r.employee_id, s)}
                      onToggleSkip={() =>
                        update.mutate({ employeeId: r.employee_id, patch: { skip_allowed: !r.skip_allowed } })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showStart && (
        <StartDialog
          count={selected.size}
          busy={request.isPending}
          onCancel={() => setShowStart(false)}
          onConfirm={(collect, contract) => startFor([...selected], collect, contract)}
        />
      )}

      {openId && (
        <EmployeeOnboardingDrawer employeeId={openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    amber: "text-warning",
    sky: "text-sky-600",
    emerald: "text-success",
    muted: "text-muted-foreground",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold", tones[tone])}>{value}</p>
    </div>
  );
}

function ProgressChip({ label, done, muted }: { label: string; done: boolean; muted?: boolean }) {
  if (muted) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground/60">
        {label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
        done
          ? "border-success/30 bg-success/10 text-success"
          : "border-border text-muted-foreground"
      )}
    >
      {done ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function RowMenu({
  row,
  onOpen,
  onStatus,
  onToggleSkip,
}: {
  row: OnboardingRow;
  onOpen: () => void;
  onStatus: (s: OnboardingStatus) => void;
  onToggleSkip: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        •••
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
            <MenuItem onClick={() => { onOpen(); setOpen(false); }}>View details</MenuItem>
            {row.status !== "complete" && (
              <MenuItem onClick={() => { onToggleSkip(); setOpen(false); }}>
                {row.skip_allowed ? "Remove skip permission" : "Allow them to skip"}
              </MenuItem>
            )}
            {row.status !== "exempt" ? (
              <MenuItem onClick={() => { onStatus("exempt"); setOpen(false); }}>
                Mark exempt (no gate)
              </MenuItem>
            ) : (
              <MenuItem onClick={() => { onStatus("pending"); setOpen(false); }}>
                Require onboarding
              </MenuItem>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
    >
      {children}
    </button>
  );
}

function StartDialog({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (collectDetails: boolean, issueContract: boolean) => void;
}) {
  const [collect, setCollect] = useState(true);
  const [contract, setContract] = useState(true);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-foreground">
            Start onboarding for {count} {count === 1 ? "person" : "people"}
          </h3>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          They will be asked to complete this the next time they log in.
        </p>
        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span className="text-sm">
              <span className="font-medium text-foreground">Collect their details</span>
              <span className="block text-xs text-muted-foreground">
                Personal, address, emergency contact, work eligibility, tax, super and bank.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={contract} onChange={(e) => setContract(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span className="text-sm">
              <span className="font-medium text-foreground">Issue an employment contract</span>
              <span className="block text-xs text-muted-foreground">
                Leave this off for long-standing staff who already signed on paper.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(collect, contract)}
            disabled={busy || (!collect && !contract)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
