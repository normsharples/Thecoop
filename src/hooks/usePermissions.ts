import { useMemo } from "react";
import { useAuth } from "./useAuth";
import type { Profile } from "@/types";

interface Permissions {
  role: Profile["role"] | null;
  canAccessRestaurant: (restaurantId: string) => boolean;
  canManageSettings: boolean;
  canViewLeaderboard: boolean;
  canManageUsers: boolean;
  canViewSalesData: boolean;
  assignedRestaurants: string[];
  isSuperadmin: boolean;
  isStaff: boolean;
}

export function usePermissions(): Permissions {
  const { profile } = useAuth();

  return useMemo(() => {
    if (!profile) {
      return {
        role: null,
        canAccessRestaurant: () => false,
        canManageSettings: false,
        canViewLeaderboard: false,
        canManageUsers: false,
        canViewSalesData: false,
        assignedRestaurants: [],
        isSuperadmin: false,
        isStaff: false,
      };
    }

    const isSuperadmin  = profile.role === "superadmin";
    const isAreaManager = profile.role === "area_manager";
    const isStaff        = profile.role === "staff";

    return {
      role: profile.role,
      canAccessRestaurant: (restaurantId: string) =>
        isSuperadmin || profile.restaurant_access.includes(restaurantId),
      canManageSettings: isSuperadmin,
      canViewLeaderboard: isSuperadmin || isAreaManager,
      canManageUsers: isSuperadmin,
      canViewSalesData: !isStaff,
      assignedRestaurants: profile.restaurant_access,
      isSuperadmin,
      isStaff,
    };
  }, [profile]);
}
