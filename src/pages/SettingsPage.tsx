import { NavLink, Outlet } from "react-router-dom";
import {
  Settings,
  Target,
  Bell,
  Shield,
  ShoppingBasket,
  HardDrive,
  Landmark,
  Link2,
  Plug,
  Truck,
  LayoutGrid,
  BookOpen,
  Tags,
  Store,
  CalendarClock,
  Briefcase,
  Gauge,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

const settingsSections = [
  { label: "Venues", path: "/admin/settings/venues", icon: Store },
  { label: "Brands", path: "/admin/settings/brands", icon: Tags },
  { label: "Ordering Schedule", path: "/admin/settings/ordering-schedule", icon: CalendarClock },
  { label: "Positions", path: "/admin/settings/positions", icon: Briefcase },
  { label: "Staffing", path: "/admin/settings/staffing", icon: Gauge },
  { label: "Roster Checks", path: "/admin/settings/roster-checks", icon: ShieldAlert },
  { label: "Targets", path: "/admin/settings/targets", icon: Target },
  { label: "Alerts", path: "/admin/settings/alerts", icon: Bell },
  { label: "WHS Templates", path: "/admin/settings/whs-templates", icon: Shield },
  { label: "Food Cost", path: "/admin/settings/food-cost", icon: Truck },
  { label: "Food Cost Items", path: "/admin/settings/food-cost-items", icon: ShoppingBasket },
  { label: "Stock Counts", path: "/admin/settings/stock-counts", icon: LayoutGrid },
  { label: "Recipes", path: "/admin/settings/recipes", icon: BookOpen },
  { label: "Asset Register", path: "/admin/settings/asset-register", icon: HardDrive },
  { label: "Bank Accounts", path: "/admin/settings/bank-accounts", icon: Landmark },
  { label: "Quick Links", path: "/admin/settings/quick-links", icon: Link2 },
  { label: "Integrations", path: "/admin/settings/integrations", icon: Plug },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar navigation */}
        <nav className="w-full lg:w-56 shrink-0">
          <div className="rounded-xl border border-border bg-card p-2 space-y-0.5">
            {settingsSections.map((section) => {
              const Icon = section.icon;
              return (
                <NavLink
                  key={section.path}
                  to={section.path}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {section.label}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
