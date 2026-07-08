import { Suspense } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNav } from "./MobileNav";
import { Loader2 } from "lucide-react";

// The "staff" role can only ever see these sections — everything else
// (Dashboard, Reports, Leaderboard, Calendar, other Admin pages, Settings)
// surfaces sales/labour data or is otherwise out of scope for restaurant-level staff.
const STAFF_ALLOWED_PREFIXES = ["/admin/incidents", "/admin/cash", "/admin/invoices"];
const STAFF_HOME = "/admin/incidents";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/pulse": "Pulse Report",
  "/reports": "Reports",
  "/reports/sales": "Sales Report",
  "/reports/labour": "Labour Report",
  "/reports/reviews": "Reviews Report",
  "/reports/food-cost": "Food Cost Report",
  "/reports/cash-ups": "Daily Cash Ups",
  "/leaderboard": "Leaderboard",
  "/calendar":    "Calendar",
  "/admin/cash": "Cash & Deposits",
  "/admin/invoices": "Invoices",
  "/admin/stock-counts": "Stock Counts",
  "/admin/maintenance": "Maintenance",
  "/admin/incidents": "Incidents",
  "/admin/whs-audits": "WHS Audits",
  "/admin/calendar": "Calendar",
  "/admin/drive": "Drive",
  "/admin/projections": "Projections",
  "/admin/store-profiles": "Store Profiles",
  "/admin/settings": "Settings",
  "/admin/settings/food-cost": "Food Cost Settings",
  "/admin/settings/team": "Team Management",
  "/admin/settings/targets": "Targets",
  "/admin/settings/alerts": "Alerts",
  "/admin/settings/whs-templates": "WHS Templates",
  "/admin/settings/food-cost-items": "Food Cost Items",
  "/admin/settings/asset-register": "Asset Register",
  "/admin/settings/bank-accounts": "Bank Accounts",
  "/admin/settings/quick-links": "Quick Links",
  "/admin/settings/integrations": "Integrations",
};

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { user, profile, isLoading } = useAuth();
  const { isStaff } = usePermissions();
  const location = useLocation();

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Require both an auth session AND a profile row — no profile means no access
  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  // Staff are restricted to a small set of operational pages — redirect anything
  // else (including the sales-heavy Dashboard) rather than relying on RLS alone.
  if (isStaff && !STAFF_ALLOWED_PREFIXES.some((p) => location.pathname.startsWith(p))) {
    return <Navigate to={STAFF_HOME} replace />;
  }

  const pageTitle =
    isStaff && location.pathname === "/admin/cash"
      ? "Daily Cash Up"
      : pageTitles[location.pathname] ?? "The Coop";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar pageTitle={pageTitle} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 lg:pb-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}
