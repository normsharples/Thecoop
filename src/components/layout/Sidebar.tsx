import { useState, useRef, useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  Trophy,
  ClipboardList,
  Wrench,
  Banknote,
  AlertTriangle,
  Shield,
  CalendarDays,
  FolderOpen,
  Store,
  Settings,
  ShieldCheck,
  Receipt,
  Boxes,
  ListChecks,
  CalendarRange,
  Activity,
  BookOpen,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LogOut,
  User,
  Menu,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useActiveBrand } from "@/hooks/useActiveBrand";
import { useAuth } from "@/hooks/useAuth";
import { cn, getInitials } from "@/lib/utils";
import { REPORT_SIDEBAR_LINKS } from "@/lib/reportNav";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  BarChart3,
  Trophy,
  ClipboardList,
  Wrench,
  Banknote,
  AlertTriangle,
  Shield,
  CalendarDays,
  FolderOpen,
  Store,
  Settings,
  ShieldCheck,
  Receipt,
  Boxes,
  ListChecks,
  CalendarRange,
  Activity,
  BookOpen,
  ChefHat,
  Menu,
};

interface NavChild {
  label: string;
  path: string;
  superadminOnly?: boolean;
  /** Match the path exactly — for a link whose children nest beneath it. */
  end?: boolean;
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
  superadminOnly?: boolean;
  children?: NavChild[];
  /** Heading this item sits under. Repeat it on consecutive items. */
  section?: string;
}

const navItems: NavItem[] = [
  { label: "Dashboard", path: "/", icon: "LayoutDashboard", section: "Today" },
  { label: "Pulse", path: "/pulse", icon: "Activity", section: "Today" },
  { label: "Tasks", path: "/tasks", icon: "ListChecks", section: "Today" },
  {
    label: "Reports",
    path: "/reports",
    icon: "BarChart3",
    section: "Analyse",
    // Every report, from the shared list in lib/reportNav.ts.
    children: REPORT_SIDEBAR_LINKS,
  },
  // { label: "Leaderboard", path: "/leaderboard", icon: "Trophy" },
  { label: "Prep list", path: "/prep", icon: "ChefHat", section: "Operate" },
  { label: "Recipes", path: "/recipes", icon: "BookOpen", section: "Operate" },
  { label: "Rostering", path: "/rostering", icon: "CalendarRange", section: "Operate" },
  { label: "Calendar",  path: "/calendar", icon: "CalendarDays", section: "Operate" },
  {
    label: "Admin",
    path: "/admin",
    icon: "ShieldCheck",
    section: "Operate",
    children: [
      { label: "Banking", path: "/admin/cash" },
      { label: "Food", path: "/admin/food" },
      { label: "Expenses", path: "/admin/expenses" },
      { label: "Data Management", path: "/admin/data-management" },
      { label: "Maintenance", path: "/admin/maintenance" },
      { label: "Incidents", path: "/admin/incidents" },
      { label: "WHS Audits", path: "/admin/whs-audits" },
      { label: "Drive", path: "/admin/drive" },
      { label: "Projections", path: "/admin/projections" },
      { label: "Store Profiles", path: "/admin/store-profiles" },
      { label: "Team", path: "/admin/team", superadminOnly: true },
      { label: "Settings", path: "/admin/settings/food-cost", superadminOnly: true },
    ],
  },
];

// Staff can only ever reach Incidents, the daily Cash Up, and Invoices — no
// Dashboard, Reports, Leaderboard, Calendar, or other Admin/Settings pages.
const staffNavItems: NavItem[] = [
  { label: "Recipes", path: "/recipes", icon: "BookOpen" },
  { label: "Prep list", path: "/prep", icon: "ChefHat" },
  { label: "Incidents", path: "/admin/incidents", icon: "AlertTriangle" },
  { label: "Cash Up", path: "/admin/cash", icon: "Banknote" },
  { label: "Invoices", path: "/admin/invoices", icon: "Receipt" },
  { label: "My Availability", path: "/my-availability", icon: "CalendarDays" },
];

// team_member (roster-only) sees just their own roster.
const teamMemberNavItems: NavItem[] = [
  { label: "My Roster", path: "/my-roster", icon: "CalendarRange" },
];

// shift_supervisor: whole-week roster (read-only) + incidents + banking.
const supervisorNavItems: NavItem[] = [
  { label: "Recipes", path: "/recipes", icon: "BookOpen" },
  { label: "Prep list", path: "/prep", icon: "ChefHat" },
  { label: "Roster", path: "/roster-view", icon: "CalendarRange" },
  { label: "My Roster", path: "/my-roster", icon: "CalendarDays" },
  { label: "Incidents", path: "/admin/incidents", icon: "AlertTriangle" },
  // /admin/cash renders the cash-up form (not deposits) for staff and
  // supervisors — label it for what they actually see.
  { label: "Cash Up", path: "/admin/cash", icon: "Banknote" },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { isSuperadmin, isStaff, isTeamMember, isShiftSupervisor } = usePermissions();
  const { name: brandName, Icon: BrandLogo } = useActiveBrand();
  const location = useLocation();

  const filteredItems = isTeamMember
    ? teamMemberNavItems
    : isShiftSupervisor
    ? supervisorNavItems
    : isStaff
    ? staffNavItems
    : navItems.filter((item) => {
        if (item.superadminOnly && !isSuperadmin) return false;
        return true;
      });

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col bg-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-[248px]"
      )}
    >
      {/* Brand */}
      <div className="flex h-[60px] shrink-0 items-center border-b border-sidebar-border px-[18px]">
        <div className={cn("flex items-center gap-2.5", collapsed && "mx-auto")}>
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-brand-accent text-white">
            <BrandLogo className="h-[15px] w-[15px]" />
          </div>
          {!collapsed && (
            <span className="font-display text-[19px] font-semibold tracking-tight text-white">
              {brandName}
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-3.5">
        {filteredItems.map((item, i) => {
          const prev = filteredItems[i - 1];
          const showHeading =
            !collapsed && !!item.section && item.section !== prev?.section;
          return (
            <div key={item.path}>
              {showHeading && (
                <div
                  className={cn(
                    "px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-heading",
                    i === 0 ? "pt-1.5" : "pt-4"
                  )}
                >
                  {item.section}
                </div>
              )}
              <SidebarItem
                item={item}
                collapsed={collapsed}
                currentPath={location.pathname}
              />
            </div>
          );
        })}
      </nav>

      <SidebarUser collapsed={collapsed} />

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center justify-center rounded-lg p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-active-bg hover:text-sidebar-active"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}

function SidebarItem({
  item,
  collapsed,
  currentPath,
}: {
  item: NavItem;
  collapsed: boolean;
  currentPath: string;
}) {
  const { isSuperadmin } = usePermissions();

  const visibleChildren = item.children?.filter(
    (c) => !c.superadminOnly || isSuperadmin
  );

  const [expanded, setExpanded] = useState(
    visibleChildren?.some((c) => currentPath.startsWith(c.path)) ?? false
  );

  const Icon = iconMap[item.icon] ?? LayoutDashboard;
  const isActive =
    item.path === "/"
      ? currentPath === "/"
      : currentPath.startsWith(item.path);

  // Active state: lighter slab + a 2px teal rail on the leading edge.
  const rowClass = (active: boolean) =>
    cn(
      "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition-colors",
      active
        ? "bg-sidebar-active-bg font-semibold text-sidebar-active"
        : "font-medium text-sidebar-foreground hover:bg-sidebar-active-bg/60 hover:text-sidebar-active"
    );

  const Rail = ({ active }: { active: boolean }) =>
    active ? (
      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-mark" />
    ) : null;

  if (visibleChildren && visibleChildren.length > 0 && !collapsed) {
    return (
      <div>
        <button onClick={() => setExpanded(!expanded)} className={rowClass(isActive)}>
          <Rail active={isActive} />
          <Icon className="h-[17px] w-[17px] shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
          />
        </button>
        {expanded && (
          <div className="ml-7 mt-0.5 space-y-px border-l border-sidebar-border pl-3">
            {visibleChildren.map((child) => (
              <NavLink
                key={child.path}
                to={child.path}
                end={child.end}
                className={({ isActive: active }) =>
                  cn(
                    "block rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                    active
                      ? "font-semibold text-sidebar-active"
                      : "text-sidebar-foreground hover:text-sidebar-active"
                  )
                }
              >
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={visibleChildren && visibleChildren.length > 0 ? visibleChildren[0].path : item.path}
      className={cn(rowClass(isActive), collapsed && "justify-center px-2")}
      title={collapsed ? item.label : undefined}
    >
      <Rail active={isActive && !collapsed} />
      <Icon className="h-[17px] w-[17px] shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

/**
 * Account block pinned to the foot of the sidebar. On viewports below `lg`
 * the sidebar is hidden, so the Topbar keeps its own copy of this menu.
 */
function SidebarUser({ collapsed }: { collapsed: boolean }) {
  const { profile, signOut } = useAuth();
  const { role: effectiveRole } = usePermissions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // The role the app is currently behaving as — in staff mode that is
  // "Team member", so the footer never contradicts the header switch.
  const roleLabel = effectiveRole
    ? effectiveRole.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
    : "";

  return (
    <div className="relative border-t border-sidebar-border p-3" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg p-1 text-left transition-colors hover:bg-sidebar-active-bg",
          collapsed && "justify-center"
        )}
      >
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-sidebar-active-bg text-[11px] font-semibold text-sidebar-active">
          {profile ? getInitials(profile.full_name) : "?"}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-medium text-white">
                {profile?.full_name ?? "User"}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{roleLabel}</div>
            </div>
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-3 right-3 z-50 mb-1 rounded-lg border border-border bg-popover p-1 shadow-popover">
          <div className="mb-1 border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-popover-foreground">
              {profile?.full_name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              navigate("/my-profile");
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
          >
            <User className="h-4 w-4" />
            My profile
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive-soft"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
