import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

// Sub-tabs shown inside the Reports → Sales section.
const subTabs = [
  { label: "Overview", path: "/reports/sales", end: true },
  { label: "By Hour", path: "/reports/sales/by-hour", end: false },
  { label: "Sales Mix", path: "/reports/sales/mix", end: false },
];

export default function SalesReportLayout() {
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {subTabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
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
