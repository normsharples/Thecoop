import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";
import { usePermissions } from "./usePermissions";
import { useActiveBrand } from "./useActiveBrand";
import { builtInLayout, sanitiseLayout, type DashboardLayout } from "@/lib/dashboardWidgets";

/** Where the layout on screen came from. */
export type LayoutSource = "personal" | "brand" | "global" | "built_in";

/** Which layout an edit writes to. */
export type LayoutTarget = "personal" | "default";

interface Row {
  id: string;
  user_id: string | null;
  brand_id: string | null;
  layout: unknown;
}

const CUSTOMISER_ROLES = ["superadmin", "area_manager", "manager"] as const;

/**
 * Loads and saves dashboard layouts for the brand currently in view.
 *
 * Resolution order: the person's own layout for this brand → the brand's
 * default → the global default → the built-in dashboard.
 *
 * "Default" writes go to the brand default when a brand is in view, or the
 * global default when looking at all brands. Only superadmins can write them
 * (enforced by RLS in migration 083, mirrored here for the UI).
 */
export function useDashboardLayout() {
  const { user } = useAuth();
  const { role, isSuperadmin } = usePermissions();
  const { brand } = useActiveBrand();
  const qc = useQueryClient();

  const userId = user?.id ?? null;
  const brandId = brand?.id ?? null;
  const canCustomise = !!role && (CUSTOMISER_ROLES as readonly string[]).includes(role);
  const canEditDefault = isSuperadmin;

  const queryKey = ["dashboard-layouts", userId, brandId];

  const { data: rows, isLoading, isError } = useQuery({
    queryKey,
    enabled: !!userId,
    retry: false,
    queryFn: async () => {
      // RLS already limits rows to defaults + my own; narrow to this brand.
      let q = supabase.from("dashboard_layouts").select("id, user_id, brand_id, layout");
      q = brandId ? q.or(`brand_id.is.null,brand_id.eq.${brandId}`) : q.is("brand_id", null);
      const { data, error } = await q;
      // Table missing (migration 083 not applied) → behave as built-in only.
      if (error) return [] as Row[];
      return (data ?? []) as Row[];
    },
  });

  const find = (uid: string | null, bid: string | null) =>
    rows?.find((r) => r.user_id === uid && r.brand_id === bid);

  const personalRow = userId ? find(userId, brandId) : undefined;
  const defaultRow = find(null, brandId);
  const globalRow = brandId ? find(null, null) : undefined;

  const personal = personalRow ? sanitiseLayout(personalRow.layout) : null;
  const brandDefault = defaultRow ? sanitiseLayout(defaultRow.layout) : null;
  const globalDefault = globalRow ? sanitiseLayout(globalRow.layout) : null;

  // What a manager falls back to when they have no layout of their own. With
  // no brand in view, the "default" row *is* the global default.
  const inheritedLayout: DashboardLayout = brandDefault ?? globalDefault ?? builtInLayout();
  const inheritedSource: LayoutSource = brandDefault
    ? brandId ? "brand" : "global"
    : globalDefault ? "global" : "built_in";

  const layout = personal ?? inheritedLayout;
  const source: LayoutSource = personal ? "personal" : inheritedSource;

  /** The layout an editor should start from for a given target. */
  const layoutFor = (target: LayoutTarget): DashboardLayout =>
    target === "personal" ? layout : inheritedLayout;

  const save = useMutation({
    mutationFn: async ({ target, layout }: { target: LayoutTarget; layout: DashboardLayout }) => {
      const owner = target === "personal" ? userId : null;
      if (target === "personal" && !owner) throw new Error("Not signed in");
      const { error } = await supabase
        .from("dashboard_layouts")
        .upsert(
          { user_id: owner, brand_id: brandId, layout },
          { onConflict: "user_id,brand_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-layouts"] }),
  });

  /** Drop my own layout so I see the brand default again. */
  const resetPersonal = useMutation({
    mutationFn: async () => {
      if (!personalRow) return;
      const { error } = await supabase.from("dashboard_layouts").delete().eq("id", personalRow.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-layouts"] }),
  });

  /** Superadmin: remove this brand's default so it inherits again. */
  const resetDefault = useMutation({
    mutationFn: async () => {
      if (!defaultRow) return;
      const { error } = await supabase.from("dashboard_layouts").delete().eq("id", defaultRow.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-layouts"] }),
  });

  return {
    layout,
    source,
    layoutFor,
    isLoading: isLoading && !!userId,
    isError,
    brand,
    brandId,
    canCustomise,
    canEditDefault,
    hasPersonal: !!personalRow,
    hasDefault: !!defaultRow,
    save,
    resetPersonal,
    resetDefault,
  };
}
