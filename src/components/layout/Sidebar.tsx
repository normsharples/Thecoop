import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Bird,
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

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
  Menu,
};

interface NavChild {
  label: string;
  path: string;
  superadminOnly?: boolean;
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
  superadminOnly?: boolean;
  children?: NavChild[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", path: "/", icon: "LayoutDashboard" },
  {
    label: "Reports",
    path: "/reports",
    icon: "BarChart3",
    children: [
      { label: "Sales", path: "/reports/sales" },
      { label: "Labour", path: "/reports/labour" },
      { label: "Reviews", path: "/reports/reviews" },
      { label: "Food Cost", path: "/reports/food-cost" },
      { label: "P&L", path: "/reports/pnl" },
      { label: "Wastage", path: "/reports/wastage" },
      { label: "Records", path: "/reports/records" },
      { label: "Cash Ups", path: "/reports/cash-ups" },
      { label: "Payouts", path: "/reports/payouts" },
    ],
  },
  // { label: "Leaderboard", path: "/leaderboard", icon: "Trophy" },
  { label: "Calendar",  path: "/calendar", icon: "CalendarDays"   },
  {
    label: "Admin",
    path: "/admin",
    icon: "ShieldCheck",
    children: [
      { label: "Cash & Deposits", path: "/admin/cash" },
      { label: "Purchase Orders", path: "/admin/purchase-orders" },
      { label: "Invoices", path: "/admin/invoices" },
      { label: "Expenses", path: "/admin/expenses" },
      { label: "Stock Counts", path: "/admin/stock-counts" },
      { label: "Maintenance", path: "/admin/maintenance" },
      { label: "Incidents", path: "/admin/incidents" },
      { label: "WHS Audits", path: "/admin/whs-audits" },
      { label: "Drive", path: "/admin/drive" },
      { label: "Projections", path: "/admin/projections" },
      { label: "Store Profiles", path: "/admin/store-profiles" },
      { label: "Settings", path: "/admin/settings/food-cost", superadminOnly: true },
    ],
  },
];

// Staff can only ever reach Incidents, Cash & Deposits, and Invoices — no
// Dashboard, Reports, Leaderboard, Calendar, or other Admin/Settings pages.
const staffNavItems: NavItem[] = [
  { label: "Incidents", path: "/admin/incidents", icon: "AlertTriangle" },
  { label: "Cash & Deposits", path: "/admin/cash", icon: "Banknote" },
  { label: "Invoices", path: "/admin/invoices", icon: "Receipt" },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { isSuperadmin, isStaff } = usePermissions();
  const location = useLocation();

  const filteredItems = isStaff
    ? staffNavItems
    : navItems.filter((item) => {
        if (item.superadminOnly && !isSuperadmin) return false;
        return true;
      });

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r border-border bg-card transition-all duration-200",
        collapsed ? "w-16" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-4">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Bird className="h-7 w-7 text-primary" />
            <span className="text-lg font-bold text-foreground">The Coop</span>
          </div>
        )}
        {collapsed && <Bird className="h-7 w-7 text-primary mx-auto" />}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {filteredItems.map((item) => (
          <SidebarItem
            key={item.path}
            item={item}
            collapsed={collapsed}
            currentPath={location.pathname}
          />
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
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

  if (visibleChildren && visibleChildren.length > 0 && !collapsed) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Icon className="h-4.5 w-4.5 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              expanded && "rotate-180"
            )}
          />
        </button>
        {expanded && (
          <div className="ml-7 mt-1 space-y-0.5 border-l border-border pl-3">
            {visibleChildren.map((child) => (
              <NavLink
                key={child.path}
                to={child.path}
                className={({ isActive: active }) =>
                  cn(
                    "block rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground"
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
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        collapsed && "justify-center px-2"
      )}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-4.5 w-4.5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}
