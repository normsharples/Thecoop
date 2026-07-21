// ============================================================================
// Canonical P&L chart of accounts
//
// One source of truth for:
//   • the category options forced on invoice / expense entry, and
//   • how those categories roll up into the structured P&L report.
//
// Revenue rows are NOT entry categories — they are derived from sales syncs
// (sales_daily + channel_payouts) and so are defined only in the report.
// Labour sub-rows are NOT entry categories either — they come from the weekly
// payroll entry on Admin → Data Management.
// ============================================================================

// ── Canonical leaf category names (exact strings stored in the DB) ───────────

export const CAT = {
  FOOD: "Food Cost",
  PAPER: "Paper Cost",
  MAINTENANCE: "Maintenance & Repairs",
  OFFICE: "Office Expenses",
  OPS_SUPPLIES: "Ops Supplies",
  UTILITIES: "Utilities",
  OCCUPANCY: "Occupancy Costs",
  EQUIPMENT: "Equipment Leases",
  MKT_DIGITAL: "Marketing – Digital",
  MKT_PRINT: "Marketing – Print",
  MKT_SPONSOR: "Marketing – Sponsorships",
  UNCATEGORISED: "Uncategorised",
} as const;

export type CategoryValue = (typeof CAT)[keyof typeof CAT];

// ── Grouped options for the entry <Select> (invoices + expenses) ─────────────
// Same full list on both screens, as requested.

export interface CategoryGroup {
  label: string;
  options: string[];
}

export const ENTRY_CATEGORY_GROUPS: CategoryGroup[] = [
  { label: "Cost of Goods (COGS)", options: [CAT.FOOD, CAT.PAPER] },
  {
    label: "Operating Overheads",
    options: [
      CAT.MAINTENANCE,
      CAT.OFFICE,
      CAT.OPS_SUPPLIES,
      CAT.UTILITIES,
      CAT.OCCUPANCY,
      CAT.EQUIPMENT,
    ],
  },
  {
    label: "Marketing / Advertising",
    options: [CAT.MKT_DIGITAL, CAT.MKT_PRINT, CAT.MKT_SPONSOR],
  },
];

export const ENTRY_CATEGORIES: string[] = ENTRY_CATEGORY_GROUPS.flatMap((g) => g.options);

// ── Map any raw/legacy category string onto a canonical leaf ─────────────────
// Mirrors the SQL remap in migration 028 so the report is robust even if a row
// slips through with an old value.

const LOOKUP: Record<string, CategoryValue> = {};
function add(target: CategoryValue, ...aliases: string[]) {
  LOOKUP[target.toLowerCase()] = target;
  aliases.forEach((a) => (LOOKUP[a.toLowerCase()] = target));
}
add(CAT.FOOD, "food", "food cost");
add(CAT.PAPER, "paper", "paper cost", "packaging");
add(CAT.MAINTENANCE, "repairs & maintenance", "repairs and maintenance", "repairs", "maintenance");
add(CAT.OFFICE, "software", "admin", "office", "bank fees", "subscriptions", "accounting");
add(CAT.OPS_SUPPLIES, "operational supplies", "supplies", "consumables");
add(CAT.UTILITIES, "utility", "power", "electricity", "gas", "water", "internet");
add(CAT.OCCUPANCY, "rent", "occupancy", "insurance", "rates", "property");
add(CAT.EQUIPMENT, "equipment lease", "lease", "leases", "equipment");
add(CAT.MKT_DIGITAL, "marketing", "advertising", "marketing/advertising", "digital");
add(CAT.MKT_PRINT, "print");
add(CAT.MKT_SPONSOR, "sponsorship", "sponsorships");

export function canonicalCategory(raw: string | null | undefined): CategoryValue {
  if (!raw) return CAT.UNCATEGORISED;
  return LOOKUP[raw.trim().toLowerCase()] ?? CAT.UNCATEGORISED;
}

// ── Structured P&L layout (rows + which categories roll into each) ───────────
// `children` with a `cats` array = the report sums matching expense/invoice
// categories into that child. Leaf overheads carry a single-element `cats`.

export interface PnlNode {
  key: string;
  label: string;
  /** Canonical categories whose amounts roll into this node (expense side). */
  cats?: CategoryValue[];
  children?: PnlNode[];
}

// Expense side of the tree (COGS + Labour handled specially; overheads by cat).
export const OVERHEAD_NODES: PnlNode[] = [
  { key: "maintenance", label: "Maintenance & Repairs", cats: [CAT.MAINTENANCE] },
  { key: "office", label: "Office Expenses", cats: [CAT.OFFICE] },
  { key: "ops", label: "Ops Supplies", cats: [CAT.OPS_SUPPLIES] },
  { key: "utilities", label: "Utilities", cats: [CAT.UTILITIES] },
  { key: "occupancy", label: "Occupancy Costs", cats: [CAT.OCCUPANCY] },
  { key: "equipment", label: "Equipment Leases", cats: [CAT.EQUIPMENT] },
  {
    key: "marketing",
    label: "Marketing / Advertising",
    children: [
      { key: "mkt-digital", label: "Digital", cats: [CAT.MKT_DIGITAL] },
      { key: "mkt-print", label: "Print", cats: [CAT.MKT_PRINT] },
      { key: "mkt-sponsor", label: "Sponsorships", cats: [CAT.MKT_SPONSOR] },
    ],
  },
];
