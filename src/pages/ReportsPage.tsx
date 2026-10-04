import { NavLink, Outlet } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { REPORT_NAV } from "@/lib/reportNav";
import { useBrandFeatures } from "@/hooks/useBrandFeatures";

export default function ReportsPage() {
  const { isPathEnabled } = useBrandFeatures();
  // A report with sub-reports stays while any of them is on.
  const tabs = REPORT_NAV.filter((r) =>
    r.children ? r.children.some((c) => isPathEnabled(c.path)) : isPathEnabled(r.path)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
      </div>

      <nav className="flex gap-1 rounded-xl border border-border bg-card p-1 overflow-x-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
