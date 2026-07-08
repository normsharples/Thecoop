import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  CalendarDays,
  Menu,
  X,
  ClipboardList,
  Wrench,
  Banknote,
  AlertTriangle,
  Shield,
  FolderOpen,
  Store,
  Settings,
  Bird,
  Wallet,
  TrendingUp,
  Receipt,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

const mobileTabItems = [
  { label: "Home",     path: "/",              icon: LayoutDashboard },
  { label: "Reports",  path: "/reports",       icon: BarChart3       },
  { label: "Calendar", path: "/calendar",      icon: CalendarDays    },
];

// Staff can only ever reach these three pages — shown directly in the tab
// bar since there's no "More" sheet needed for just three destinations.
const staffTabItems = [
  { label: "Incidents",   path: "/admin/incidents", icon: AlertTriangle },
  { label: "Cash",        path: "/admin/cash",      icon: Banknote },
  { label: "Invoices",    path: "/admin/invoices",  icon: Receipt },
];

const moreItems = [
  { label: "WHS Audits",      path: "/admin/whs-audits",       icon: Shield },
  { label: "Cash & Deposits", path: "/admin/cash",             icon: Banknote },
  { label: "Purchase Orders", path: "/admin/purchase-orders",  icon: ClipboardList },
  { label: "Expenses",        path: "/admin/expenses",         icon: Wallet },
  { label: "Stock Counts",    path: "/admin/stock-counts",     icon: ClipboardList },
  { label: "Maintenance",     path: "/admin/maintenance",      icon: Wrench },
  { label: "Incidents",       path: "/admin/incidents",        icon: AlertTriangle },
  { label: "Drive",           path: "/admin/drive",            icon: FolderOpen },
  { label: "Projections",     path: "/admin/projections",      icon: TrendingUp },
  { label: "Store Profiles",  path: "/admin/store-profiles",   icon: Store },
  { label: "Settings",        path: "/admin/settings/team",    icon: Settings, superadminOnly: true },
];

export function MobileNav() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();
  const { isSuperadmin, isStaff } = usePermissions();

  const filteredTabItems = isStaff ? staffTabItems : mobileTabItems;

  const filteredMoreItems = moreItems.filter(
    (item) => !item.superadminOnly || isSuperadmin
  );

  return (
    <>
      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden border-t border-border bg-card/95 backdrop-blur">
        {filteredTabItems.map((item) => {
          const isActive =
            item.path === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          );
        })}
        {!isStaff && (
          <button
            onClick={() => setSheetOpen(true)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              sheetOpen ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Menu className="h-5 w-5" />
            More
          </button>
        )}
      </nav>

      {/* Slide-up sheet */}
      {!isStaff && sheetOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 lg:hidden"
            onClick={() => setSheetOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden rounded-t-2xl border-t border-border bg-card max-h-[70vh] overflow-y-auto animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Bird className="h-5 w-5 text-primary" />
                <span className="font-semibold text-foreground">More</span>
              </div>
              <button
                onClick={() => setSheetOpen(false)}
                className="rounded-lg p-1.5 hover:bg-accent transition-colors"
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              {filteredMoreItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setSheetOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl p-3 text-xs font-medium transition-colors",
                    location.pathname.startsWith(item.path)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <item.icon className="h-6 w-6" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
