import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  Loader2,
  UserPlus,
  X,
  Users,
  Trash2,
  KeyRound,
  ClipboardList,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ROLE_LABELS } from "@/lib/constants";
import { getInitials, cn } from "@/lib/utils";
import { useOnboardingList, useOnboardingActions, type OnboardingRow } from "@/hooks/useOnboarding";
import { LEVEL_LABELS, type AwardLevel } from "@/lib/award";
import EmployeeOnboardingDrawer from "@/components/onboarding/EmployeeOnboardingDrawer";
import ChangeRequests from "@/components/onboarding/ChangeRequests";
import type { Profile, OnboardingStatus } from "@/types";

const ONBOARDING_META: Record<OnboardingStatus, { label: string; className: string }> = {
  pending:     { label: "Not started", className: "bg-warning/10 text-warning border-warning/30" },
  in_progress: { label: "In progress", className: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  complete:    { label: "Complete",    className: "bg-success/10 text-success border-success/30" },
  exempt:      { label: "Exempt",      className: "bg-muted text-muted-foreground border-border" },
  legacy:      { label: "Not required",className: "bg-muted text-muted-foreground border-border" },
};

const createSchema = z.object({
  username: z
    .string()
    .min(3, "At least 3 characters")
    .regex(
      /^[a-z0-9._-]+$/,
      "Lowercase letters, numbers, dots, underscores or hyphens only"
    ),
  full_name: z.string().min(2, "Name is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["superadmin", "area_manager", "manager", "shift_supervisor", "staff", "team_member"]),
  restaurant_access: z.array(z.string()),
  home_restaurant_id: z.string().nullable().optional(),
  contact_email: z.string().optional(),
  phone: z.string().optional(),
  display_colour: z.string().nullable().optional(),
  is_rosterable: z.boolean().optional(),
  // Employment terms — captured up front so the contract can be issued as
  // soon as the person has filled in their own details.
  employment_type: z.string().optional(),
  award_level: z.string().optional(),
  position_title: z.string().optional(),
  start_date: z.string().optional(),
});

const EMP_SWATCHES = [
  "#6366f1", "#ec4899", "#f97316", "#22c55e",
  "#0ea5e9", "#eab308", "#8b5cf6", "#ef4444",
  "#14b8a6", "#64748b",
];

type CreateFormData = z.infer<typeof createSchema>;

// Invokes the superadmin-only admin-users edge function.
async function invokeAdminUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    // Surface the function's JSON { error } message rather than a generic 4xx.
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const payload = await ctx.json();
        if (payload?.error) message = payload.error;
      } catch {
        /* keep original message */
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function TeamSettings() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OnboardingStatus | "none">("all");
  const queryClient = useQueryClient();
  const { profile: currentUser } = useAuth();
  const { data: restaurants } = useRestaurants();
  const { data: onboardingRows } = useOnboardingList();
  const { request: requestOnboarding, update: updateOnboarding } = useOnboardingActions();

  const onboardingFor = (userId: string) =>
    onboardingRows?.find((r) => r.employee_id === userId) ?? null;

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (formData: CreateFormData) => {
      const { employment_type, award_level, position_title, start_date, ...account } = formData;
      const rosterable = account.is_rosterable ?? account.role === "team_member";

      const res = await invokeAdminUsers({
        action: "create",
        ...account,
        contact_email: account.contact_email?.trim() || null,
        phone: account.phone?.trim() || null,
        home_restaurant_id: account.home_restaurant_id || null,
        display_colour: account.display_colour || null,
        is_rosterable: rosterable,
      });
      const newId = (res?.id as string | undefined) ?? undefined;

      // The edge function only knows about account fields, so the employment
      // terms go on in a second write (superadmin-only, enforced by the 063 guard).
      if (newId && (employment_type || award_level || position_title || start_date)) {
        const { error } = await supabase
          .from("profiles")
          .update({
            employment_type: employment_type || null,
            award_level: award_level || null,
            position_title: position_title || null,
            start_date: start_date || null,
          })
          .eq("id", newId);
        if (error) throw error;
      }

      // A trigger enrols rosterable profiles, but do it explicitly too so this
      // works even if the trigger has not been applied yet. Idempotent.
      if (newId && rosterable) {
        await supabase.from("employee_onboarding").upsert(
          {
            employee_id: newId,
            status: "pending",
            requested_at: new Date().toISOString(),
            requested_by: currentUser?.id ?? null,
          },
          { onConflict: "employee_id", ignoreDuplicates: true }
        );
      }
      return { id: newId, rosterable };
    },
    onSuccess: (res) => {
      toast.success(
        res.rosterable ? "Team member added — onboarding started" : "User created"
      );
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      setShowCreate(false);
      // Straight into their record so pay and award level can be set now.
      if (res.id && res.rosterable) setDrawerId(res.id);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      role,
      restaurant_access,
      home_restaurant_id,
      contact_email,
      phone,
      display_colour,
      is_rosterable,
    }: {
      id: string;
      role: string;
      restaurant_access: string[];
      home_restaurant_id?: string | null;
      contact_email?: string | null;
      phone?: string | null;
      display_colour?: string | null;
      is_rosterable?: boolean;
    }) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          role,
          restaurant_access,
          home_restaurant_id: home_restaurant_id ?? null,
          contact_email: contact_email ?? null,
          phone: phone ?? null,
          display_colour: display_colour ?? null,
          is_rosterable: is_rosterable ?? false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditingUser(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      await invokeAdminUsers({ action: "reset_password", id, password });
    },
    onSuccess: () => {
      toast.success("Password updated");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await invokeAdminUsers({ action: "delete", id });
    },
    onSuccess: () => {
      toast.success("User deleted");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditingUser(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Team</h2>
          <p className="text-sm text-muted-foreground">
            Access, employment details, paperwork and contracts — all in one place
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Onboard team member
        </button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          restaurants={restaurants ?? []}
          onClose={() => setShowCreate(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isSubmitting={createMutation.isPending}
        />
      )}

      {/* Edit Modal */}
      {editingUser && (
        <EditModal
          user={editingUser}
          restaurants={restaurants ?? []}
          currentUserId={currentUser?.id ?? ""}
          onClose={() => setEditingUser(null)}
          onSubmit={(data) => updateMutation.mutate(data)}
          onResetPassword={(password) =>
            resetPasswordMutation.mutate({ id: editingUser.id, password })
          }
          onDelete={() => deleteMutation.mutate(editingUser.id)}
          isSubmitting={updateMutation.isPending}
          isResettingPassword={resetPasswordMutation.isPending}
          isDeleting={deleteMutation.isPending}
          allUsers={users ?? []}
        />
      )}

      {/* Detail changes waiting on you (bank / super / legal name / DOB) */}
      <ChangeRequests />

      {/* Onboarding at a glance */}
      {onboardingRows && onboardingRows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {(["pending", "in_progress", "complete"] as OnboardingStatus[]).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter((f) => (f === st ? "all" : st))}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                statusFilter === st ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
              )}
            >
              <p className="text-xs text-muted-foreground">{ONBOARDING_META[st].label}</p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {onboardingRows.filter((r) => r.status === st).length}
              </p>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team"
          className="h-9 min-w-[180px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="all">All onboarding states</option>
          <option value="pending">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="complete">Complete</option>
          <option value="legacy">Not required</option>
          <option value="exempt">Exempt</option>
          <option value="none">No onboarding record</option>
        </select>
      </div>

      {/* Users List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    Role
                  </th>
                  <th className="hidden px-6 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium lg:table-cell">
                    Restaurants
                  </th>
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    Onboarding
                  </th>
                  <th className="px-6 py-3 text-right text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users
                  ?.filter((user) => {
                    const q = search.trim().toLowerCase();
                    if (q && !user.full_name.toLowerCase().includes(q) &&
                        !(user.username ?? "").toLowerCase().includes(q)) return false;
                    if (statusFilter === "all") return true;
                    const ob = onboardingFor(user.id);
                    if (statusFilter === "none") return !ob;
                    return ob?.status === statusFilter;
                  })
                  .map((user) => (
                  <tr key={user.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(user.full_name)}
                        </div>
                        <div>
                          <button
                            onClick={() => setDrawerId(user.id)}
                            className="text-left text-sm font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {user.full_name}
                          </button>
                          <p className="text-xs text-muted-foreground">
                            {user.username ?? user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-md bg-muted/50 px-2 py-1 text-xs font-medium text-foreground">
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="hidden px-6 py-4 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {user.role === "superadmin" ? (
                          <span className="text-xs text-muted-foreground">
                            All restaurants
                          </span>
                        ) : (
                          user.restaurant_access.map((rid) => {
                            const r = restaurants?.find((rest) => rest.id === rid);
                            return (
                              <span
                                key={rid}
                                className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                              >
                                {r?.name ?? "Unknown"}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <OnboardingCell row={onboardingFor(user.id)} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setDrawerId(user.id)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <ClipboardList className="h-3 w-3" />
                          Open
                        </button>
                        <button
                          onClick={() => setEditingUser(user)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                          Access
                        </button>
                        <RowMenu
                          row={onboardingFor(user.id)}
                          onStart={() =>
                            requestOnboarding.mutate({
                              employeeIds: [user.id],
                              collectDetails: true,
                              issueContract: true,
                            })
                          }
                          onStatus={(status) =>
                            updateOnboarding.mutate({ employeeId: user.id, patch: { status } })
                          }
                          onToggleSkip={(skip) =>
                            updateOnboarding.mutate({ employeeId: user.id, patch: { skip_allowed: skip } })
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!users || users.length === 0) && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mb-2" />
              <p className="text-sm">No users found</p>
            </div>
          )}
        </div>
      )}

      {drawerId && (
        <EmployeeOnboardingDrawer employeeId={drawerId} onClose={() => setDrawerId(null)} />
      )}
    </div>
  );
}

/**
 * The onboarding controls that used to live on the separate Onboarding tab:
 * start it, exempt someone from the gate, or let one person past it.
 */
function RowMenu({
  row,
  onStart,
  onStatus,
  onToggleSkip,
}: {
  row: OnboardingRow | null;
  onStart: () => void;
  onStatus: (status: OnboardingStatus) => void;
  onToggleSkip: (skip: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        •••
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
            {(!row || row.status === "legacy" || row.status === "exempt") && (
              <MenuItem onClick={() => { onStart(); close(); }}>Start onboarding</MenuItem>
            )}
            {row && row.status !== "complete" && (
              <MenuItem onClick={() => { onToggleSkip(!row.skip_allowed); close(); }}>
                {row.skip_allowed ? "Remove skip permission" : "Let them skip the gate"}
              </MenuItem>
            )}
            {row && row.status !== "exempt" && row.status !== "legacy" && (
              <MenuItem onClick={() => { onStatus("exempt"); close(); }}>
                Exempt from onboarding
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

/** Status pill + what is still outstanding, per person. */
function OnboardingCell({ row }: { row: OnboardingRow | null }) {
  if (!row) {
    return <span className="text-xs text-muted-foreground">Not required</span>;
  }
  const meta = ONBOARDING_META[row.status];
  const outstanding: string[] = [];
  if (row.collect_details && !row.details_complete) outstanding.push("details");
  if (row.collect_details && !row.sensitive_complete) outstanding.push("tax & bank");
  if (row.issue_contract && !row.contract_signed) outstanding.push("contract");

  return (
    <div>
      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", meta.className)}>
        {meta.label}
      </span>
      {outstanding.length > 0 && row.status !== "legacy" && row.status !== "exempt" && (
        <p className="mt-1 text-[11px] text-muted-foreground">Waiting on {outstanding.join(", ")}</p>
      )}
    </div>
  );
}

function CreateModal({
  restaurants,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  restaurants: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (data: CreateFormData) => void;
  isSubmitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { restaurant_access: [], role: "manager" },
  });

  const selectedAccess = watch("restaurant_access");
  const role = watch("role");
  const isRosterable = watch("is_rosterable") ?? role === "team_member";
  const homeStore = watch("home_restaurant_id") ?? "";
  const colour = watch("display_colour") ?? "";

  const toggleRestaurant = (id: string) => {
    const current = selectedAccess ?? [];
    setValue(
      "restaurant_access",
      current.includes(id)
        ? current.filter((r) => r !== id)
        : [...current, id]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Onboard team member</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Full Name</label>
            <input
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Jane Smith"
              {...register("full_name")}
            />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Username</label>
            <input
              autoCapitalize="none"
              autoComplete="off"
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="jane"
              {...register("username")}
            />
            {errors.username && (
              <p className="text-xs text-destructive">{errors.username.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              They'll sign in with this username.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Password</label>
            <input
              type="text"
              autoComplete="new-password"
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Set a password"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              {...register("role")}
            >
              <option value="team_member">Team Member (roster only)</option>
              <option value="staff">Restaurant Staff (incidents, cash & invoices only)</option>
              <option value="shift_supervisor">Shift Supervisor (roster view, incidents, banking)</option>
              <option value="manager">Restaurant Manager</option>
              <option value="area_manager">Area Manager</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>

          {role === "team_member" ? (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Team members can only see their own roster — no restaurant data access.
            </p>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Restaurant Access
              </label>
              <div className="space-y-2">
                {restaurants.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAccess?.includes(r.id) ?? false}
                      onChange={() => toggleRestaurant(r.id)}
                      className="rounded border-input"
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Rostering */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={isRosterable}
                onChange={(e) => setValue("is_rosterable", e.target.checked)}
                className="rounded border-input"
              />
              Rosterable (appears in the roster builder)
            </label>

            {isRosterable && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Home store</label>
                  <select
                    value={homeStore}
                    onChange={(e) => setValue("home_restaurant_id", e.target.value || null)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">None</option>
                    {restaurants.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Roster colour</label>
                  <div className="flex flex-wrap gap-2">
                    {EMP_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setValue("display_colour", c)}
                        className="h-7 w-7 rounded-full"
                        style={{ backgroundColor: c, boxShadow: colour === c ? `0 0 0 2px ${c}` : undefined }}
                      />
                    ))}
                  </div>
                </div>

                {/* Employment terms — the contract can't be issued without an
                    award level (or a manual rate, set later on their record). */}
                <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Employment type</label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      {...register("employment_type")}
                    >
                      <option value="">Select…</option>
                      <option value="casual">Casual</option>
                      <option value="part_time">Part-time</option>
                      <option value="full_time">Full-time</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Award level</label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      {...register("award_level")}
                    >
                      <option value="">Select…</option>
                      {(Object.keys(LEVEL_LABELS) as AwardLevel[]).map((l) => (
                        <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Position title</label>
                    <input
                      placeholder="Crew Member"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      {...register("position_title")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">Start date</label>
                    <input
                      type="date"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      {...register("start_date")}
                    />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    They'll be asked for their own details and to sign their contract the first time
                    they log in. Pay rate and the rest are on their record afterwards.
                  </p>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Contact email</label>
                <input
                  type="email"
                  placeholder="jane@email.com"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  {...register("contact_email")}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Phone</label>
                <input
                  type="tel"
                  placeholder="04…"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  {...register("phone")}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Contact details are used for roster notifications (email / push) later.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create &amp; start onboarding
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditModal({
  user,
  restaurants,
  currentUserId,
  onClose,
  onSubmit,
  onResetPassword,
  onDelete,
  isSubmitting,
  isResettingPassword,
  isDeleting,
  allUsers,
}: {
  user: Profile;
  restaurants: { id: string; name: string }[];
  currentUserId: string;
  onClose: () => void;
  onSubmit: (data: {
    id: string;
    role: string;
    restaurant_access: string[];
    home_restaurant_id?: string | null;
    contact_email?: string | null;
    phone?: string | null;
    display_colour?: string | null;
    is_rosterable?: boolean;
  }) => void;
  onResetPassword: (password: string) => void;
  onDelete: () => void;
  isSubmitting: boolean;
  isResettingPassword: boolean;
  isDeleting: boolean;
  allUsers: Profile[];
}) {
  const [role, setRole] = useState(user.role);
  const [access, setAccess] = useState<string[]>(user.restaurant_access);
  const [isRosterable, setIsRosterable] = useState<boolean>(user.is_rosterable ?? false);
  const [homeStore, setHomeStore] = useState<string>(user.home_restaurant_id ?? "");
  const [colour, setColour] = useState<string>(user.display_colour ?? "");
  const [contactEmail, setContactEmail] = useState<string>(user.contact_email ?? "");
  const [phone, setPhone] = useState<string>(user.phone ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isSelf = user.id === currentUserId;
  const isLastSuperadmin =
    user.role === "superadmin" &&
    allUsers.filter((u) => u.role === "superadmin").length <= 1;

  const toggleRestaurant = (id: string) => {
    setAccess((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    if (isSelf && role !== "superadmin" && isLastSuperadmin) {
      toast.error("Cannot remove the last superadmin role");
      return;
    }
    onSubmit({
      id: user.id,
      role,
      restaurant_access: role === "team_member" ? [] : access,
      home_restaurant_id: homeStore || null,
      contact_email: contactEmail.trim() || null,
      phone: phone.trim() || null,
      display_colour: colour || null,
      is_rosterable: isRosterable,
    });
  };

  const handleResetPassword = () => {
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    onResetPassword(newPassword);
    setNewPassword("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">
            Edit {user.full_name}
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Profile["role"])}
              disabled={isSelf && isLastSuperadmin}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="team_member">Team Member (roster only)</option>
              <option value="staff">Restaurant Staff (incidents, cash & invoices only)</option>
              <option value="shift_supervisor">Shift Supervisor (roster view, incidents, banking)</option>
              <option value="manager">Restaurant Manager</option>
              <option value="area_manager">Area Manager</option>
              <option value="superadmin">Superadmin</option>
            </select>
            {isSelf && isLastSuperadmin && (
              <p className="text-xs text-warning">
                Cannot change role — you are the last superadmin
              </p>
            )}
          </div>
          {role === "team_member" ? (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Team members can only see their own roster — no restaurant data access.
            </p>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Restaurant Access
              </label>
              <div className="space-y-2">
                {restaurants.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={access.includes(r.id)}
                      onChange={() => toggleRestaurant(r.id)}
                      className="rounded border-input"
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Rostering */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={isRosterable}
                onChange={(e) => setIsRosterable(e.target.checked)}
                className="rounded border-input"
              />
              Rosterable (appears in the roster builder)
            </label>
            {isRosterable && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Home store</label>
                  <select
                    value={homeStore}
                    onChange={(e) => setHomeStore(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">None</option>
                    {restaurants.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Roster colour</label>
                  <div className="flex flex-wrap gap-2">
                    {EMP_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColour(c)}
                        className="h-7 w-7 rounded-full"
                        style={{ backgroundColor: c, boxShadow: colour === c ? `0 0 0 2px ${c}` : undefined }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Contact email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="jane@email.com"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="04…"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </button>
          </div>

          {/* Reset password */}
          <div className="space-y-2 border-t border-border pt-4">
            <label className="text-sm font-medium text-foreground">
              Reset Password
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="New password"
              />
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={isResettingPassword || newPassword.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isResettingPassword ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                Set
              </button>
            </div>
          </div>

          {/* Delete user */}
          {!isSelf && (
            <div className="space-y-2 border-t border-border pt-4">
              <label className="text-sm font-medium text-destructive">
                Danger Zone
              </label>
              {confirmDelete ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Permanently delete {user.full_name}? Their login and profile
                    will be removed. This can't be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                    >
                      {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Delete Permanently
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isLastSuperadmin}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete User
                </button>
              )}
              {isLastSuperadmin && (
                <p className="text-xs text-warning">
                  Cannot delete the last superadmin
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
