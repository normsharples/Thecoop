import { NavLink, Outlet } from "react-router-dom";
import { UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Purchase Orders", path: "/admin/food/purchase-orders" },
  { label: "Invoices", path: "/admin/food/invoices" },
  { label: "Transfers", path: "/admin/food/transfers" },
  { label: "Inventory", path: "/admin/food/inventory" },
  { label: "Waste", path: "/admin/food/waste" },
  { label: "Stock Counts", path: "/admin/food/stock-counts" },
];

export default function FoodPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UtensilsCrossed className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Food</h1>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <NavLink
            key={t.path}
            to={t.path}
            className={({ isActive }) =>
              cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
