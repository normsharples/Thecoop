import { useEffect, useMemo } from "react";
import { useAuth } from "./useAuth";
import { useViewMode } from "@/contexts/ViewMode";
import type { Profile } from "@/types";

type Role = Profile["role"];

// A superadmin in staff mode is treated as this role everywhere downstream, so
// the sidebar, mobile nav and route guards all narrow without a second code
// path to keep in sync.
const STAFF_MODE_ROLE: Role = "team_member";

interface Permissions {
  /** The role in force — already narrowed if staff mode is on. */
  role: Role | null;
  /** The role on the profile row, whatever the view mode. */
  realRole: Role | null;
  /** True for a real superadmin even while previewing staff mode. */
  isRealSuperadmin: boolean;
  /** True while a superadmin is previewing the app as a team member. */
  isStaffMode: boolean;
  canAccessRestaurant: (restaurantId: string) => boolean;
  canManageSettings: boolean;
  canViewLeaderboard: boolean;
  canManageUsers: boolean;
  canViewSalesData: boolean;
  assignedRestaurants: string[];
  isSuperadmin: boolean;
  isStaff: boolean;
  isTeamMember: boolean;
  isShiftSupervisor: boolean;
}

export function usePermissions(): Permissions {
  const { profile } = useAuth();
  const { mode, setCanSwitch } = useViewMode();

  const realRole = profile?.role ?? null;
  const realSuperadmin = realRole === "superadmin";

  // Tell the provider who is allowed to flip the switch. Doing it here keeps
  // the rule in one place rather than duplicated in the Topbar.
  useEffect(() => {
    setCanSwitch(realSuperadmin);
  }, [realSuperadmin, setCanSwitch]);

  return useMemo(() => {
    if (!profile) {
      return {
        role: null,
        realRole: null,
        isRealSuperadmin: false,
        isStaffMode: false,
        canAccessRestaurant: () => false,
        canManageSettings: false,
        canViewLeaderboard: false,
        canManageUsers: false,
        canViewSalesData: false,
        assignedRestaurants: [],
        isSuperadmin: false,
        isStaff: false,
        isTeamMember: false,
        isShiftSupervisor: false,
      };
    }

    // Only a real superadmin can be in staff mode; the provider already forces
    // everyone else to "operations", this is belt and braces.
    const isStaffMode = mode === "staff" && realSuperadmin;
    const effectiveRole: Role = isStaffMode ? STAFF_MODE_ROLE : profile.role;

    const isSuperadmin      = effectiveRole === "superadmin";
    const isAreaManager     = effectiveRole === "area_manager";
    const isStaff           = effectiveRole === "staff";
    const isTeamMember      = effectiveRole === "team_member";
    const isShiftSupervisor = effectiveRole === "shift_supervisor";

    return {
      role: effectiveRole,
      realRole: profile.role,
      isRealSuperadmin: realSuperadmin,
      isStaffMode,
      canAccessRestaurant: (restaurantId: string) =>
        isSuperadmin || profile.restaurant_access.includes(restaurantId),
      canManageSettings: isSuperadmin,
      canViewLeaderboard: isSuperadmin || isAreaManager,
      canManageUsers: isSuperadmin,
      canViewSalesData: !isStaff && !isTeamMember && !isShiftSupervisor,
      assignedRestaurants: profile.restaurant_access,
      isSuperadmin,
      isStaff,
      isTeamMember,
      isShiftSupervisor,
    };
  }, [profile, mode, realSuperadmin]);
}
