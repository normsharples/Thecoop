import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { EyeOff } from "lucide-react";
import { useBrandFeatures } from "@/hooks/useBrandFeatures";
import { usePermissions } from "@/hooks/usePermissions";
import { REPORTS } from "@/lib/brandFeatures";

/**
 * Blocks pages the brand in view has switched off (Settings → Brands), so a
 * bookmark or old link can't reach a hidden module. A switched-off report
 * bounces to the brand's first report that's on.
 */
export function BrandFeatureGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { isPathEnabled, classifyPath, brand } = useBrandFeatures();
  const { isSuperadmin } = usePermissions();

  if (isPathEnabled(pathname)) return <>{children}</>;

  const kind = classifyPath(pathname)?.kind;
  if (kind === "report") {
    const next = REPORTS.find((r) => isPathEnabled(r.key));
    if (next) return <Navigate to={next.key} replace />;
  }

  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-8 text-center">
      <EyeOff className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-semibold text-foreground">
        Not switched on{brand ? ` for ${brand.name}` : ""}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This {kind === "report" ? "report" : "section"} is turned off for the brand you're viewing.
        Switch brand in the top bar, or turn it on in brand settings.
      </p>
      {isSuperadmin && (
        <Link
          to="/admin/settings/brands"
          className="mt-4 inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Brand settings
        </Link>
      )}
    </div>
  );
}
