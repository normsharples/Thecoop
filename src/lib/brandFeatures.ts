import { REPORT_SIDEBAR_LINKS } from "./reportNav";
import type { Brand } from "@/types";

// ============================================================================
// PER-BRAND REPORTS & MODULES
// ----------------------------------------------------------------------------
// Each brand can switch reports and modules off (Settings → Brands). Brands
// store what's OFF, so anything new is on by default everywhere.
//
// Gating is by URL: nav lists and the route guard all ask
// `isPathEnabled(path)`, so one rule hides the link and blocks the page.
// Paths that aren't a report or a module (Dashboard, Team, Settings, "My …"
// pages) are never gated.
// ============================================================================

export interface ModuleDef {
  key: string;
  label: string;
  /** URL prefixes that belong to this module. */
  paths: string[];
}

export const MODULES: ModuleDef[] = [
  { key: "pulse",           label: "Daily Activity Report", paths: ["/pulse"] },
  { key: "tasks",           label: "Tasks",            paths: ["/tasks"] },
  { key: "prep",            label: "Prep list",        paths: ["/prep"] },
  { key: "recipes",         label: "Recipes",          paths: ["/recipes"] },
  { key: "rostering",       label: "Rostering",        paths: ["/rostering", "/roster-view"] },
  { key: "calendar",        label: "Calendar",         paths: ["/calendar"] },
  { key: "ordering",        label: "Ordering",         paths: ["/ordering", "/admin/purchase-orders", "/admin/food/purchase-orders"] },
  { key: "banking",         label: "Banking & cash ups", paths: ["/admin/cash"] },
  {
    key: "food",
    label: "Food & inventory",
    paths: [
      "/admin/food", "/admin/invoices", "/admin/inventory",
      "/admin/transfers", "/admin/waste", "/admin/stock-counts",
    ],
  },
  { key: "expenses",        label: "Expenses",         paths: ["/admin/expenses"] },
  { key: "data_management", label: "Data management",  paths: ["/admin/data-management"] },
  { key: "maintenance",     label: "Maintenance",      paths: ["/admin/maintenance"] },
  { key: "incidents",       label: "Incidents",        paths: ["/admin/incidents"] },
  { key: "whs",             label: "WHS audits",       paths: ["/admin/whs-audits"] },
  { key: "drive",           label: "Drive",            paths: ["/admin/drive"] },
  { key: "projections",     label: "Projections",      paths: ["/admin/projections"] },
  { key: "store_profiles",  label: "Store profiles",   paths: ["/admin/store-profiles"] },
];

/** Every report, flat — Sales sub-reports included. Keyed by path. */
export const REPORTS = REPORT_SIDEBAR_LINKS.map((r) => ({ key: r.path, label: r.label }));

const startsWithPath = (path: string, prefix: string) =>
  path === prefix || path.startsWith(prefix + "/");

/** What a path belongs to, or null if it's never gated. */
export function classifyPath(path: string): { kind: "report" | "module"; key: string } | null {
  if (startsWithPath(path, "/reports")) {
    // Longest match wins, so /reports/sales/by-hour is "By Hour", not "Sales".
    const match = REPORTS
      .filter((r) => startsWithPath(path, r.key))
      .sort((a, b) => b.key.length - a.key.length)[0];
    return match ? { kind: "report", key: match.key } : null;
  }
  const mod = MODULES.find((m) => m.paths.some((p) => startsWithPath(path, p)));
  return mod ? { kind: "module", key: mod.key } : null;
}

function disabledSet(brand: Brand, kind: "report" | "module"): Set<string> {
  const f = brand.features ?? {};
  return new Set((kind === "report" ? f.disabled_reports : f.disabled_modules) ?? []);
}

/**
 * Is this path switched on?
 *   - One brand in view → that brand's settings.
 *   - All brands (no brand in view) → on if ANY brand has it on.
 *   - No brands configured → everything on.
 */
export function isPathEnabledFor(path: string, activeBrand: Brand | null, allBrands: Brand[]): boolean {
  const c = classifyPath(path);
  if (!c) return true;
  const pool = activeBrand ? [activeBrand] : allBrands;
  if (pool.length === 0) return true;
  return pool.some((b) => !disabledSet(b, c.kind).has(c.key));
}
