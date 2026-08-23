/**
 * The one list of reports.
 *
 * The Reports tab bar and the sidebar's Reports submenu both read this, so a
 * new report shows up in both places from a single edit. They used to be two
 * hand-kept lists and had already drifted — the sidebar was missing Roster and
 * pointed at a "Wastage" report that has no route.
 *
 * Adding a report: add it here AND add its route in `App.tsx`.
 */

export interface ReportSubLink {
  label: string;
  path: string;
  /** Match this path exactly (needed for a parent whose children nest under it). */
  end?: boolean;
}

export interface ReportNavItem {
  label: string;
  path: string;
  /** Sub-reports that live inside this one's own tab bar. */
  children?: ReportSubLink[];
}

export const REPORT_NAV: ReportNavItem[] = [
  {
    label: "Sales",
    path: "/reports/sales",
    children: [
      { label: "Overview", path: "/reports/sales", end: true },
      { label: "By Hour", path: "/reports/sales/by-hour" },
    ],
  },
  { label: "Labour", path: "/reports/labour" },
  { label: "Roster", path: "/reports/roster" },
  { label: "Reviews", path: "/reports/reviews" },
  { label: "Food Cost", path: "/reports/food-cost" },
  { label: "Food Usage", path: "/reports/food-usage" },
  { label: "Transfers", path: "/reports/transfers" },
  { label: "P&L", path: "/reports/pnl" },
  { label: "Records", path: "/reports/records" },
  { label: "Cash Ups", path: "/reports/cash-ups" },
  { label: "Payouts", path: "/reports/payouts" },
  { label: "Contacts", path: "/reports/contacts" },
];

/**
 * Every report as a flat list of links, for the sidebar — sub-reports included,
 * since the sidebar has no second tab bar to reveal them. "Sales → Overview"
 * keeps the parent's plain name; other children read "Sales · By Hour".
 */
export const REPORT_SIDEBAR_LINKS: ReportSubLink[] = REPORT_NAV.flatMap((report) =>
  report.children
    ? report.children.map((child) => ({
        label: child.path === report.path ? report.label : `${report.label} · ${child.label}`,
        path: child.path,
        end: child.end,
      }))
    : [{ label: report.label, path: report.path }]
);
