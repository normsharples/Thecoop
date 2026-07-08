export const APP_NAME = "The Coop";

export const ROLES = {
  SUPERADMIN:   "superadmin",
  AREA_MANAGER: "area_manager",
  MANAGER:      "manager",
  STAFF:        "staff",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin:   "Superadmin",
  area_manager: "Area Manager",
  manager:      "Restaurant Manager",
  staff:        "Restaurant Staff",
};

export const NAV_ITEMS = [
  { label: "Dashboard", path: "/", icon: "LayoutDashboard" },
  { label: "Pulse Report", path: "/pulse", icon: "Activity" },
  {
    label: "Reports",
    path: "/reports",
    icon: "BarChart3",
    children: [
      { label: "Sales", path: "/reports/sales" },
      { label: "Labour", path: "/reports/labour" },
      { label: "Reviews", path: "/reports/reviews" },
      { label: "Food Cost", path: "/reports/food-cost" },
    ],
  },
  { label: "Leaderboard", path: "/leaderboard", icon: "Trophy" },
  { label: "WHS Audits", path: "/whs-audits", icon: "Shield" },
  { label: "Cash & Deposits", path: "/admin/cash", icon: "Banknote" },
  { label: "Stock Counts", path: "/admin/stock-counts", icon: "ClipboardList" },
  { label: "Maintenance", path: "/admin/maintenance", icon: "Wrench" },
  { label: "Catering Orders", path: "/catering", icon: "UtensilsCrossed" },
  { label: "Incidents", path: "/admin/incidents", icon: "AlertTriangle" },
  { label: "Calendar", path: "/admin/calendar", icon: "CalendarDays" },
  { label: "Drive", path: "/admin/drive", icon: "FolderOpen" },
  { label: "Store Profiles", path: "/admin/store-profiles", icon: "Store" },
  {
    label: "Settings",
    path: "/admin/settings",
    icon: "Settings",
    superadminOnly: true,
    children: [
      { label: "Team", path: "/admin/settings/team" },
      { label: "Targets", path: "/admin/settings/targets" },
      { label: "Alerts", path: "/admin/settings/alerts" },
      { label: "WHS Templates", path: "/admin/settings/whs-templates" },
      { label: "Food Cost Items", path: "/admin/settings/food-cost-items" },
      { label: "Asset Register", path: "/admin/settings/asset-register" },
      { label: "Bank Accounts", path: "/admin/settings/bank-accounts" },
      { label: "Quick Links", path: "/admin/settings/quick-links" },
      { label: "Integrations", path: "/admin/settings/integrations" },
    ],
  },
] as const;

export const MOBILE_NAV_ITEMS = [
  { label: "Dashboard", path: "/", icon: "LayoutDashboard" },
  { label: "Pulse", path: "/pulse", icon: "Activity" },
  { label: "Reports", path: "/reports", icon: "BarChart3" },
  { label: "Leaderboard", path: "/leaderboard", icon: "Trophy" },
  { label: "Calendar", path: "/admin/calendar", icon: "CalendarDays" },
  { label: "More", path: "/more", icon: "Menu" },
] as const;
