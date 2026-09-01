import { Suspense } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useMyOnboarding } from "@/hooks/useOnboarding";
import { useMyOpenContract } from "@/hooks/useContracts";
import { OnboardingBanner } from "./OnboardingBanner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNav } from "./MobileNav";
import { BrandTheme } from "./BrandTheme";
import { AskDrawer } from "@/components/ask/AskDrawer";
import { Eye, Loader2 } from "lucide-react";

// The "staff" role can only ever see these sections — everything else
// (Dashboard, Reports, Leaderboard, Calendar, other Admin pages, Settings)
// surfaces sales/labour data or is otherwise out of scope for restaurant-level staff.
const STAFF_ALLOWED_PREFIXES = ["/admin/incidents", "/admin/cash", "/admin/invoices", "/my-availability", "/my-profile"];
const STAFF_HOME = "/admin/incidents";

// team_member (roster-only) can reach their own roster + availability/leave.
const TEAM_MEMBER_ALLOWED_PREFIXES = ["/my-roster", "/my-availability", "/my-profile"];
const TEAM_MEMBER_HOME = "/my-roster";

// shift_supervisor: whole-week roster (read-only) + incidents + banking.
const SUPERVISOR_ALLOWED_PREFIXES = ["/roster-view", "/my-roster", "/my-availability", "/my-profile", "/admin/incidents", "/admin/cash"];
const SUPERVISOR_HOME = "/roster-view";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/my-roster": "My Roster",
  "/roster-view": "Roster",
  "/my-availability": "My Availability",
  "/my-profile": "My Profile",
  "/tasks": "Today's Tasks",
  "/pulse": "Pulse Report",
  "/reports": "Reports",
  "/reports/sales": "Sales Report",
  "/reports/labour": "Labour Report",
  "/reports/reviews": "Reviews Report",
  "/reports/food-cost": "Food Cost Report",
  "/reports/cash-ups": "Daily Cash Ups",
  "/leaderboard": "Leaderboard",
  "/calendar":    "Calendar",
  "/admin/cash": "Banking",
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
  const { isStaff, isTeamMember, isShiftSupervisor, role: effectiveRole, isStaffMode } =
    usePermissions();
  const { data: onboarding, isLoading: onboardingLoading } = useMyOnboarding();
  const { data: openContract } = useMyOpenContract();
  const location = useLocation();

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Require both an auth session AND a profile row — no profile means no access
  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  // ── Onboarding gate ────────────────────────────────────────────────────────
  // Anyone with an outstanding onboarding record is sent to the wizard.
  // team_member / staff / shift_supervisor get a HARD gate — nothing else in
  // the app opens until they are done. manager and above (and anyone a
  // superadmin has granted a temporary skip) get a SOFT gate: the wizard opens
  // on login, but they can dismiss it for the session and carry on, because a
  // store cannot stop trading over paperwork.
  // Clock in/out lives on /clock, outside AppLayout, and is never gated.
  const onboardingOutstanding =
    !!onboarding && !["complete", "legacy", "exempt"].includes(onboarding.status);

  // Their half done, but no contract waiting? Then the hold-up is ours, not
  // theirs — locking someone out of the app over paperwork they cannot action
  // would strand them at a disabled button. They still get the banner, and the
  // gate returns the moment a contract is actually issued to them.
  const employeeSideDone =
    !!onboarding &&
    (onboarding.collect_details === false ||
      (onboarding.details_complete && onboarding.sensitive_complete));
  const waitingOnUs = employeeSideDone && !onboarding?.contract_signed && !openContract;

  // Deliberately profile.role, not the effective role: staff mode is a preview,
  // and a superadmin previewing it must not get hard-gated behind the
  // onboarding wizard with no way back to the switch.
  const canPassGate =
    ["superadmin", "area_manager", "manager"].includes(profile.role) ||
    onboarding?.skip_allowed === true;
  const gateDismissed =
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("coop.onboarding.dismissed") === "1";

  if (
    onboardingOutstanding &&
    !onboardingLoading &&
    !waitingOnUs &&
    !(canPassGate && gateDismissed)
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // Staff are restricted to a small set of operational pages — redirect anything
  // else (including the sales-heavy Dashboard) rather than relying on RLS alone.
  if (isStaff && !STAFF_ALLOWED_PREFIXES.some((p) => location.pathname.startsWith(p))) {
    return <Navigate to={STAFF_HOME} replace />;
  }

  // team_member is locked to their own roster page.
  if (
    isTeamMember &&
    !TEAM_MEMBER_ALLOWED_PREFIXES.some((p) => location.pathname.startsWith(p))
  ) {
    return <Navigate to={TEAM_MEMBER_HOME} replace />;
  }

  // shift_supervisor is limited to the roster view, incidents and banking.
  if (
    isShiftSupervisor &&
    !SUPERVISOR_ALLOWED_PREFIXES.some((p) => location.pathname.startsWith(p))
  ) {
    return <Navigate to={SUPERVISOR_HOME} replace />;
  }

  // Staff and shift supervisors get the cash-up form at /admin/cash, not the
  // banking/deposits view, so the header has to match what is on screen.
  const pageTitle =
    (isStaff || isShiftSupervisor) && location.pathname === "/admin/cash"
      ? "Daily Cash Up"
      : pageTitles[location.pathname] ?? "The Coop";

  // The assistant reads sales and labour, so it sits behind the same line as the
  // rest of that data: manager and above. RLS still scopes every answer to the
  // venues the person can see, so this only decides who gets the button.
  const canAsk = ["superadmin", "area_manager", "manager"].includes(effectiveRole ?? "");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <BrandTheme />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar pageTitle={pageTitle} />
        {isStaffMode && (
          <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warning bg-warning-soft px-4 py-1.5 text-[11px] font-medium text-warning">
            <Eye className="h-3.5 w-3.5" />
            Staff mode — showing only what a team member sees. Your data access is unchanged.
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 lg:pb-6">
          {onboardingOutstanding && onboarding && <OnboardingBanner onboarding={onboarding} />}
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
      {canAsk && <AskDrawer page={pageTitle} />}
    </div>
  );
}
