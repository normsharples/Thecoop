import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  Loader2,
  UserPlus,
  X,
  Users,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ROLE_LABELS } from "@/lib/constants";
import { getInitials } from "@/lib/utils";
import type { Profile } from "@/types";

const inviteSchema = z.object({
  email: z.email("Valid email required"),
  full_name: z.string().min(2, "Name is required"),
  role: z.enum(["superadmin", "area_manager", "manager", "staff"]),
  restaurant_access: z.array(z.string()),
});

type InviteFormData = z.infer<typeof inviteSchema>;

export default function TeamSettings() {
  const [showInvite, setShowInvite] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const queryClient = useQueryClient();
  const { profile: currentUser } = useAuth();
  const { data: restaurants } = useRestaurants();

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

  const inviteMutation = useMutation({
    mutationFn: async (formData: InviteFormData) => {
      // Step 1: Create the Supabase auth user.
      // This fires the on_auth_user_created trigger which inserts the profile row.
      // Supabase sends a confirmation email; the user clicks it and sets their password.
      // The random password here is never usable — they must go through the email link.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: crypto.randomUUID(),
        options: { data: { full_name: formData.full_name } },
      });
      if (signUpError) throw signUpError;

      const userId = data.user?.id;
      if (!userId) throw new Error("Account already exists for this email address.");

      // Step 2: Upsert the profile with the correct role and access.
      // The trigger may have already created it with defaults; this overrides them.
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({
          id: userId,
          email: formData.email,
          full_name: formData.full_name,
          role: formData.role,
          restaurant_access: formData.restaurant_access,
        });
      if (profileError) throw profileError;
    },
    onSuccess: () => {
      toast.success("Invite sent — they'll receive an email to confirm and set their password");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setShowInvite(false);
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
    }: {
      id: string;
      role: string;
      restaurant_access: string[];
    }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ role, restaurant_access, updated_at: new Date().toISOString() })
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Team Management</h2>
          <p className="text-sm text-muted-foreground">
            Manage users and their access to restaurants
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Invite User
        </button>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <InviteModal
          restaurants={restaurants ?? []}
          onClose={() => setShowInvite(false)}
          onSubmit={(data) => inviteMutation.mutate(data)}
          isSubmitting={inviteMutation.isPending}
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
          isSubmitting={updateMutation.isPending}
          allUsers={users ?? []}
        />
      )}

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
                  <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    Restaurants
                  </th>
                  <th className="px-6 py-3 text-right text-xs uppercase tracking-wider text-muted-foreground font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users?.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(user.full_name)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {user.full_name}
                          </p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-md bg-muted/50 px-2 py-1 text-xs font-medium text-foreground">
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="px-6 py-4">
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
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
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
    </div>
  );
}

function InviteModal({
  restaurants,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  restaurants: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (data: InviteFormData) => void;
  isSubmitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { restaurant_access: [], role: "manager" },
  });

  const selectedAccess = watch("restaurant_access");

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
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Invite User</h3>
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
            <label className="text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="jane@pollorotisserie.com.au"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              {...register("role")}
            >
              <option value="manager">Restaurant Manager</option>
              <option value="staff">Restaurant Staff (incidents, cash & invoices only)</option>
              <option value="area_manager">Area Manager</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>
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
              Send Invite
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
  isSubmitting,
  allUsers,
}: {
  user: Profile;
  restaurants: { id: string; name: string }[];
  currentUserId: string;
  onClose: () => void;
  onSubmit: (data: { id: string; role: string; restaurant_access: string[] }) => void;
  isSubmitting: boolean;
  allUsers: Profile[];
}) {
  const [role, setRole] = useState(user.role);
  const [access, setAccess] = useState<string[]>(user.restaurant_access);

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
    onSubmit({ id: user.id, role, restaurant_access: access });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 mx-4">
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
              <option value="manager">Restaurant Manager</option>
              <option value="staff">Restaurant Staff (incidents, cash & invoices only)</option>
              <option value="area_manager">Area Manager</option>
              <option value="superadmin">Superadmin</option>
            </select>
            {isSelf && isLastSuperadmin && (
              <p className="text-xs text-warning">
                Cannot change role — you are the last superadmin
              </p>
            )}
          </div>
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
        </div>
      </div>
    </div>
  );
}
