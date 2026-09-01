export interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  lightspeed_id: string | null;
  deputy_id: string | null;
  google_place_id: string | null;
  status: "active" | "grace_period" | "inactive";
  state?: "NSW" | "VIC" | "QLD" | "SA" | "WA" | "TAS" | "NT" | "ACT" | null; // drives public-holiday calendar (payroll)
  pnl_cogs_basis?: "purchases" | "usage";
  brand_id?: string | null;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  color: string;
  icon: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: "superadmin" | "area_manager" | "manager" | "shift_supervisor" | "staff" | "team_member";
  restaurant_access: string[];
  avatar_url: string | null;
  // Rostering fields (migration 042)
  home_restaurant_id?: string | null;
  display_colour?: string | null;
  is_rosterable?: boolean;
  contact_email?: string | null;
  phone?: string | null;
  base_pay_rate?: number | null; // manual OVERRIDE of the award-derived rate
  award_level?: "1" | "2" | "3" | "3+" | null; // MA000003 classification level
  pay_type?: "hourly" | "salary";
  employment_type?: "casual" | "part_time" | "full_time" | null;
  salary_annual?: number | null;
  contracted_hours?: number | null;
  date_of_birth?: string | null; // for junior award rates (payroll)
  // Onboarding detail fields (migration 063)
  legal_first_name?: string | null;
  legal_middle_name?: string | null;
  legal_last_name?: string | null;
  preferred_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  suburb?: string | null;
  address_state?: string | null;
  postcode?: string | null;
  emergency_name?: string | null;
  emergency_relationship?: string | null;
  emergency_phone?: string | null;
  emergency_phone_alt?: string | null;
  medical_notes?: string | null;
  work_eligibility?: "citizen" | "permanent_resident" | "visa" | null;
  visa_subclass?: string | null;
  visa_expiry?: string | null;
  position_title?: string | null;
  start_date?: string | null;
  probation_weeks?: number | null;
  requires_onboarding?: boolean | null;
  // Set when this person authorises someone else's contract (migration 065)
  signatory_title?: string | null;
  signature_image?: string | null;
  notification_prefs?: { email?: boolean; push?: boolean } | null;
  // pin_hash exists in DB but is never selected to the client
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Rostering (migration 042)
// ============================================================================

export interface Position {
  id: string;
  name: string;
  colour: string | null;
  sort_order: number;
  active: boolean;
  parent_id: string | null; // null = top-level Area; set = Sub-area of that Area
  restaurant_id: string | null; // null = All locations (global); set = venue-specific
  created_at: string;
}

// Station training / proficiency (migration 058). A "station" is a Position
// (Area or Sub-area). A missing row = the person is not trained on that station.
export type ProficiencyLevel = "basic" | "intermediate" | "advanced";

export interface StationTraining {
  id: string;
  employee_id: string;
  position_id: string;
  level: ProficiencyLevel;
  created_at: string;
  updated_at: string;
}

// Staffing matrix (migration 059): "sales vs required staff". One row per
// required slot; the slot is needed for an hour once that hour's projected
// sales reach threshold_sales.
export interface StaffingMatrixRow {
  id: string;
  restaurant_id: string;
  station_name: string;
  position_id: string | null; // mapped roster position (for training/assign); null = unmapped
  threshold_sales: number;
  slot_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// Per-venue config for the projection engine + sales-driven shift generation.
export interface StaffingConfig {
  restaurant_id: string;
  ly_weight: number;
  lw_weight: number;
  growth_pct: number;
  growth_auto: boolean;
  open_hour: number;
  close_hour: number;
  min_shift_hours: number;
  break_threshold_hours: number;
  break_minutes: number;
  created_at: string;
  updated_at: string;
}

export type RosterWeekStatus = "draft" | "published";

export interface RosterWeek {
  id: string;
  restaurant_id: string;
  week_start: string; // Monday, YYYY-MM-DD
  status: RosterWeekStatus;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shift {
  id: string;
  restaurant_id: string;
  employee_id: string | null; // null = open / unassigned shift
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM[:SS]
  end_time: string;
  unpaid_break_minutes: number;
  break_start: string | null; // HH:MM start of the unpaid break; null = auto-centre
  position_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Convenience joins (populated client-side where needed)
  employee?: Profile;
  position?: Position;
}

export interface ShiftTemplate {
  id: string;
  restaurant_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface ShiftTemplateLine {
  id: string;
  template_id: string;
  employee_id: string | null;
  day_of_week: number; // 0 = Monday
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  position_id: string | null;
  note: string | null;
}

export interface AvailabilityRule {
  id: string;
  employee_id: string;
  day_of_week: number; // 0 = Monday
  is_available: boolean;
  start_time: string | null; // set = available only within this window (part-day)
  end_time: string | null;
  effective_from: string | null; // rule applies only on/after this date (null = always)
  effective_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityException {
  id: string;
  employee_id: string;
  date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
}

export type LeaveType = "annual" | "sick" | "unpaid" | "other";
export type LeaveStatus = "pending" | "approved" | "declined";

export interface LeaveRequest {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  leave_type: LeaveType;
  note: string | null;
  status: LeaveStatus;
  notify_user_id: string | null; // who the requester sent it to (migration 067)
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  employee?: Profile;
  notify_user?: { full_name: string } | null;
}

export type ShiftSwapStatus =
  | "offered"
  | "claimed"
  | "approved"
  | "declined"
  | "cancelled";

export interface ShiftSwap {
  id: string;
  shift_id: string;
  offered_by: string;
  claimed_by: string | null;
  status: ShiftSwapStatus;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  shift?: Shift;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

// ============================================================================
// Time & attendance (migration 052 — payroll T1)
// ============================================================================

export type TimeEntryApproval =
  | "pending"       // still clocked in / not yet finalised
  | "auto_approved" // within tolerance of the rostered shift
  | "flagged"       // variance or no rostered shift — needs a manager
  | "approved"      // manager approved
  | "rejected";     // manager rejected

export interface TimeEntry {
  id: string;
  restaurant_id: string;
  employee_id: string;
  shift_id: string | null;
  work_date: string;            // yyyy-MM-dd (venue-local roster date)
  clock_in: string;             // ISO timestamptz
  clock_out: string | null;
  break_start: string | null;
  break_end: string | null;
  source: "kiosk" | "app" | "manual";
  worked_minutes: number | null;
  approval_status: TimeEntryApproval;
  flag_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  employee?: Profile;
}

export interface StoreProfile {
  id: string;
  restaurant_id: string;
  phone: string | null;
  email: string | null;
  trading_hours: Record<string, string> | null;
  key_contacts: KeyContact[] | null;
  wifi_network: string | null;
  wifi_password: string | null;
  alarm_code: string | null;
  council_details: string | null;
  insurance_details: string | null;
  suppliers: SupplierContact[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  restaurant?: Restaurant;
}

export interface KeyContact {
  name: string;
  role: string;
  phone: string;
  email?: string;
}

export interface SupplierContact {
  name: string;
  category: string;
  phone: string;
  email?: string;
  account_number?: string;
}

export interface SalesByCategory {
  name: string;
  amount: number;
}

export interface SalesByProduct {
  name: string;
  amount: number;
}

export interface SalesByHour {
  hour: number;
  amount: number;
}

export interface SalesDaily {
  id: string;
  restaurant_id: string;
  date: string;
  total_sales: number;
  net_sales: number | null;
  transaction_count: number;
  average_transaction: number;
  sales_by_category: SalesByCategory[] | null;
  sales_by_product:  SalesByProduct[]  | null;
  sales_by_hour: SalesByHour[] | null;
  source: "lightspeed" | "manual" | "override";
  manual_notes: string | null;
  entered_by: string | null;
  discounts_amount: number;
  discounts_count: number;
  refunds_amount: number;
  refunds_count: number;
  online_sales: number | null;
  online_transaction_count: number | null;
  online_average_transaction: number | null;
  delivery_sales: number | null;
  delivery_transaction_count: number | null;
  delivery_average_transaction: number | null;
  created_at: string;
}

export interface HoursByRole {
  role: string;
  hours: number;
}

export interface LabourDaily {
  id: string;
  restaurant_id: string;
  date: string;
  total_hours: number;
  scheduled_hours: number | null;
  overtime_hours: number | null;
  total_cost: number;
  labour_percent: number;
  hours_by_role: HoursByRole[] | null;
  source: "deputy" | "manual" | "override";
  manual_notes: string | null;
  entered_by: string | null;
  created_at: string;
}

export interface IntegrationCredential {
  id: string;
  restaurant_id: string | null;
  provider: string;
  credentials: Record<string, unknown>;
  is_manual_only: boolean;
  last_sync_at: string | null;
  sync_status: "never" | "success" | "error" | "syncing";
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationSetting {
  id: string;
  provider: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  last_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  provider: string;
  restaurant_id: string | null;
  status: "success" | "error" | "skipped";
  records_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface GoogleReview {
  id: string;
  restaurant_id: string;
  reviewer_name: string;
  rating: number;
  comment: string | null;
  review_date: string;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface GoogleRatingDaily {
  id: string;
  restaurant_id: string;
  date: string;
  rating: number;
  review_count: number;
  created_at: string;
}

export interface Target {
  id: string;
  restaurant_id: string;
  metric: string;
  period: string;
  day_of_week: number | null;
  value: number;
  created_at: string;
  updated_at: string;
}

export interface Projection {
  id: string;
  restaurant_id: string;
  period_month: string;
  sales_projection: number;
  labour_projection: number;
  food_cost_projection: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Per-day projected sales used by the Roster dashboard to compute Required hours.
export interface DailyProjection {
  id: string;
  restaurant_id: string;
  date: string; // yyyy-MM-dd
  projected_sales: number;
  created_at: string;
  updated_at: string;
}

// One free-text note per roster week, per store.
export interface RosterNote {
  id: string;
  restaurant_id: string;
  week_start_date: string; // Monday of the roster week, yyyy-MM-dd
  note: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// On-demand roster refresh queue polled by the local Deputy scraper.
export interface RosterRefreshRequest {
  id: string;
  restaurant_id: string;
  week_start: string; // Monday of the week to refresh, yyyy-MM-dd
  status: "pending" | "running" | "done" | "error";
  error_message: string | null;
  requested_by: string | null;
  requested_at: string;
  completed_at: string | null;
}

export interface RefreshRequest {
  id: string;
  source: string; // 'lightspeed' | 'sales-mix' | 'deputy' | 'google' | 'bite' | 'uber' | 'payouts' | 'all'
  status: "pending" | "running" | "done" | "error";
  error_message: string | null;
  requested_by: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CashOutItem {
  description: string;
  amount: number;
}

export interface CashUp {
  id: string;
  restaurant_id: string;
  cash_up_date: string;
  till_count: number;
  float_amount: number;
  amount_deposited: number;
  cash_outs: CashOutItem[];
  denomination_counts: Record<string, number>; // key = cents value, e.g. "10000" for $100 note
  pos_expected_deposit: number;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertConfig {
  id: string;
  alert_type: string;
  enabled: boolean;
  global_threshold: Record<string, unknown>;
  restaurant_overrides: Record<string, Record<string, unknown>>;
  recipients: string[];
  created_at: string;
  updated_at: string;
}

export interface AlertHistory {
  id: string;
  alert_type: string;
  restaurant_id: string;
  severity: "warning" | "urgent" | "critical";
  title: string;
  message: string;
  metric_value: number | null;
  threshold_value: number | null;
  triggered_at: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  email_sent: boolean;
  email_sent_at: string | null;
}

export interface CalendarEvent {
  id: string;
  restaurant_id: string | null;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  all_day: boolean;
  event_type: string;
  created_by: string;
  created_at: string;
}


// ── Assets & Maintenance ──────────────────────────────────────────────────────

export interface Asset {
  id: string;
  restaurant_id: string;
  name: string;
  category: string;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  warranty_expiry: string | null;
  status: "operational" | "needs_repair" | "out_of_service" | "retired";
  notes: string | null;
  photo_url: string | null;
  created_at: string;
}

export type MaintenancePriority = "low" | "medium" | "high" | "urgent";
export type MaintenanceStatus = "open" | "in_progress" | "waiting_parts" | "completed" | "cancelled";

export interface MaintenanceRequest {
  id: string;
  restaurant_id: string;
  asset_id: string | null;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  requested_by: string;
  assigned_to: string | null;
  completed_at: string | null;
  cost: number | null;
  resolution_notes: string | null;
  created_at: string;
  asset?: Asset;
  requester?: Profile;
}

export interface ScheduledMaintenance {
  id: string;
  asset_id: string;
  description: string | null;
  frequency_days: number;
  last_completed: string | null;
  next_due: string | null;
  created_at: string;
  asset?: Asset;
}

// ── Food Cost ─────────────────────────────────────────────────────────────────

export interface FoodCostItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  cost_per_unit: number;
  supplier: string | null;
  location: string | null;
  /** Allergen tags. Recipe allergens are derived from these — never typed on a recipe. */
  allergens: string[];
  /** Kilograms per "each", so a recipe can call for 180 g of an each-stocked item. */
  weight_per_each: number | null;
  created_at: string;
}

export interface StockCountLocation {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  active: boolean;
  created_at: string;
}

// ── Recipe book (migration 073) ───────────────────────────────────────────────
// One table, two types. A prep recipe is a batch made in-house; a menu recipe is
// what the POS sells. Recipes are global — one spec for every venue.

export type RecipeType = "prep" | "menu";
export type RecipeComponentType = "item" | "recipe";

export interface Recipe {
  id: string;
  name: string;
  type: RecipeType;
  category: string | null;
  description: string | null;
  method_intro: string | null;
  /** Net usable output, already net of trim and cook loss. */
  yield_qty: number;
  yield_unit: string;
  portions: number | null;
  /** Expected loss vs raw input. Display + production variance only — not in the cost maths. */
  yield_loss_pct: number | null;
  /** true = production-logged stocked batch (R2); false = explode at sale. */
  is_stocked: boolean;
  output_food_cost_item_id: string | null;
  shelf_life_hours: number | null;
  prep_time_mins: number | null;
  equipment: string | null;
  station_id: string | null;
  hero_image_path: string | null;
  /** Allergens from the process, not an ingredient (shared fryer). */
  extra_allergens: string[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeLine {
  id: string;
  recipe_id: string;
  component_type: RecipeComponentType;
  food_cost_item_id: string | null;
  sub_recipe_id: string | null;
  qty_entered: number;
  unit_entered: string | null;
  /** Converted to the component's own base unit by trigger. null = not convertible. */
  qty_stock_units: number | null;
  note: string | null;
  optional: boolean;
  sort_order: number;
  created_at: string;
  food_cost_item?: FoodCostItem | null;
  sub_recipe?: Recipe | null;
}

export interface RecipeStep {
  id: string;
  recipe_id: string;
  step_no: number;
  body: string;
  image_path: string | null;
  created_at: string;
}

export interface RecipeVenueSetting {
  recipe_id: string;
  restaurant_id: string;
  available: boolean;
  par_qty: number | null;
  par_unit: string | null;
  updated_at: string;
}

export interface RecipeWithDetail extends Recipe {
  lines: RecipeLine[];
  steps: RecipeStep[];
  venue_settings: RecipeVenueSetting[];
}

/** recipe_cost() — manager tier only; staff never receive these figures. */
export interface RecipeCost {
  total_cost: number;
  cost_per_yield_unit: number | null;
  cost_per_portion: number | null;
  missing_cost_items: number;
  incomplete: boolean;
}

export interface RecipeCostRow extends RecipeCost {
  recipe_id: string;
}

export type RecipeCostBasis = "live" | "standard";

export interface RecipeIssue {
  kind: "no_lines" | "unit" | "stocked_without_output" | "missing_cost" | "cycle";
  detail: string;
}

export interface RecipeCoverage {
  total_sales: number;
  mapped_sales: number;
  coverage_pct: number;
  unmapped_products: number;
}

export interface UnmappedProduct {
  item_name: string;
  category_name: string | null;
  sales_amount: number;
  quantity: number;
}

// ── Label printing (migration 076) ───────────────────────────────────────────

export type PrinterKind = "lan_escpos" | "sunmi_cloud";

export interface Printer {
  id: string;
  restaurant_id: string;
  name: string;
  kind: PrinterKind;
  /** LAN IP. Give it a DHCP reservation — a moved address stalls the queue. */
  host: string | null;
  port: number;
  columns: number;
  sn: string | null;
  active: boolean;
  is_default: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type PrintJobStatus = "queued" | "printing" | "done" | "error" | "cancelled";

export interface PrintJob {
  id: string;
  restaurant_id: string;
  printer_id: string | null;
  job_type: "prep_label" | "test";
  payload: Record<string, unknown>;
  status: PrintJobStatus;
  attempts: number;
  last_error: string | null;
  source_type: string | null;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

// ── Production + prep list (migration 074) ───────────────────────────────────

export interface ProductionRun {
  id: string;
  restaurant_id: string;
  recipe_id: string;
  batches: number;
  /** batches × yield at the time it was made. */
  expected_qty: number | null;
  produced_qty: number | null;
  produced_unit: string | null;
  business_date: string;
  made_at: string;
  made_by: string | null;
  made_by_name: string | null;
  notes: string | null;
  /** false = deliberately not posted (non-stocked recipe), never a silent failure. */
  posted: boolean;
  batch_cost: number | null;
  use_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  created_at: string;
  recipe?: Recipe | null;
}

export interface PrepCheck {
  id: string;
  restaurant_id: string;
  recipe_id: string;
  business_date: string;
  on_hand_qty: number;
  unit: string | null;
  checked_by: string | null;
  checked_at: string;
}

export type OnHandSource = "stock" | "checked" | "unknown";

export interface PrepPlanItem {
  id: string;
  restaurant_id: string;
  recipe_id: string;
  business_date: string;
  target_qty: number;
  unit: string | null;
  note: string | null;
  sort_order: number;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * prep_board() (migration 075) — EVERY prep recipe at the venue, whether or not
 * it is on today's plan. Par is a suggestion, not the decision: the manager sets
 * target_qty and the team works the list down. No cost, so it is safe for staff
 * and for the tablet.
 */
export interface PrepBoardRow {
  recipe_id: string;
  name: string;
  category: string | null;
  yield_qty: number;
  yield_unit: string;
  is_stocked: boolean;
  hero_image_path: string | null;
  prep_time_mins: number | null;
  shelf_life_hours: number | null;

  planned: boolean;
  target_qty: number | null;
  plan_note: string | null;
  plan_item_id: string | null;
  completed_at: string | null;

  par_qty: number | null;
  on_hand: number | null;
  on_hand_source: OnHandSource;
  /** par − on hand, when both are known. A starting number for the plan. */
  suggested_qty: number | null;
  made_today: number;
  /** target − made today, floored at zero. null when not planned. */
  remaining: number | null;
  last_made_at: string | null;
}

/** @deprecated superseded by PrepBoardRow (migration 075). */
export interface PrepListRow {
  recipe_id: string;
  name: string;
  category: string | null;
  yield_qty: number;
  yield_unit: string;
  is_stocked: boolean;
  par_qty: number;
  on_hand: number | null;
  on_hand_source: OnHandSource;
  to_make: number | null;
  batches_to_make: number | null;
  prep_time_mins: number | null;
  shelf_life_hours: number | null;
  hero_image_path: string | null;
  made_today: number;
  last_made_at: string | null;
}

export interface StockCount {
  id: string;
  restaurant_id: string;
  counted_by: string;
  count_date: string;
  status: "draft" | "submitted" | "approved";
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  opening_stock_count_id: string | null;
  created_at: string;
  counter?: Profile;
  approver?: Profile;
}

export interface StockCountLine {
  id: string;
  stock_count_id: string;
  food_cost_item_id: string;
  opening_quantity: number;
  purchase_quantity: number;
  quantity: number;
  usage_quantity: number | null;
  total_value: number;
  food_cost_item?: FoodCostItem;
}

// ── Wastage ───────────────────────────────────────────────────────────────────

export type WasteReason =
  | "Overproduction"
  | "Expired"
  | "Dropped"
  | "Customer Return"
  | "Quality Issue";

export const WASTE_REASONS: WasteReason[] = [
  "Overproduction",
  "Expired",
  "Dropped",
  "Customer Return",
  "Quality Issue",
];

export interface WasteLog {
  id: string;
  restaurant_id: string;
  date: string;
  item_name: string;
  quantity: number;
  unit: string;
  estimated_cost: number;
  reason: string;
  logged_by: string;
  photo_url: string | null;
  food_cost_item_id: string | null;
  created_at: string;
  logger?: Profile;
}

// ── Cash ──────────────────────────────────────────────────────────────────────

export interface CashDeposit {
  id: string;
  restaurant_id: string;
  deposit_date: string;
  amount: number;
  bank_account_id: string;
  reference: string | null;
  deposited_by: string;
  verified: boolean;
  verified_by: string | null;
  notes: string | null;
  photo_url: string | null;
  flagged: boolean;
  flag_reason: string | null;
  created_at: string;
  bank_account?: BankAccount;
  depositor?: Profile;
}

export interface BankAccount {
  id: string;
  restaurant_id: string;
  bank_name: string;
  account_name: string;
  bsb: string;
  account_number: string;
  created_at: string;
}

// ── Catering ──────────────────────────────────────────────────────────────────

export interface CateringItem {
  name: string;
  quantity: number;
  unit_price: number;
}

export type CateringStatus =
  | "enquiry"
  | "confirmed"
  | "preparing"
  | "delivered"
  | "completed"
  | "cancelled";

export interface CateringOrder {
  id: string;
  restaurant_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  event_date: string;
  event_time: string | null;
  delivery_address: string | null;
  is_delivery: boolean;
  guest_count: number;
  items: CateringItem[];
  total_amount: number;
  deposit_paid: number;
  status: CateringStatus;
  notes: string | null;
  created_by: string;
  calendar_event_id: string | null;
  prep_event_id: string | null;
  created_at: string;
  creator?: Profile;
}

// ── Incidents ─────────────────────────────────────────────────────────────────

export interface Incident {
  id: string;
  restaurant_id: string;
  title: string;
  description: string;
  incident_type: "injury" | "food_safety" | "equipment" | "customer_complaint" | "theft" | "other";
  severity: "low" | "medium" | "high" | "critical";
  incident_date: string;
  reported_by: string;
  status: "open" | "investigating" | "resolved" | "closed";
  resolution: string | null;
  created_at: string;
}

export interface IncidentCorrectiveAction {
  id: string;
  incident_id: string;
  action: string;
  assigned_to: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
}

// ── WHS ───────────────────────────────────────────────────────────────────────

export interface WHSAuditTemplate {
  id: string;
  name: string;
  description: string | null;
  sections: WHSAuditSection[];
  created_by: string;
  created_at: string;
}

export interface WHSAuditSection {
  id: string;
  title: string;
  questions: WHSAuditQuestion[];
}

export interface WHSAuditQuestion {
  id: string;
  question: string;
  type: "yes_no" | "rating" | "text";
}

export interface WHSAudit {
  id: string;
  template_id: string;
  restaurant_id: string;
  audited_by: string;
  audit_date: string;
  status: "draft" | "submitted" | "reviewed";
  overall_score: number | null;
  notes: string | null;
  created_at: string;
}

export interface WHSAuditResponse {
  id: string;
  audit_id: string;
  question_id: string;
  response: string;
  notes: string | null;
  photo_url: string | null;
}

export interface WHSCorrectiveAction {
  id: string;
  audit_id: string;
  question_id: string;
  action: string;
  assigned_to: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
}

// ── App Config ────────────────────────────────────────────────────────────────

export interface AppSettings {
  id: string;
  key: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  icon: string;
  role_visibility: "all" | "superadmin" | string;
  order: number;
}

export interface WeeklyLabour {
  id: string;
  restaurant_id: string;
  week_start: string; // Monday, yyyy-MM-dd
  actual_labour: number;
  payroll_tax: number;
  overtime: number;
  penalty_rates: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierInvoice {
  id: string;
  restaurant_id: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  amount: number;
  category: string;
  status: "pending" | "approved" | "paid";
  created_at: string;
}

// ── Perpetual inventory (Phase A) ─────────────────────────────────────────────

export type InventoryMovementType =
  | "opening"
  | "purchase"
  | "sale_depletion"
  | "waste"
  | "count_adjustment"
  | "production_in"
  | "production_out"
  | "transfer_out"
  | "transfer_in"
  | "in_transit_loss";

export interface InventoryMovement {
  id: string;
  restaurant_id: string;
  food_cost_item_id: string;
  movement_type: InventoryMovementType;
  qty_delta: number;
  unit_cost: number;
  value_delta: number;
  movement_date: string;
  source_type: string | null;
  source_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  food_cost_item?: FoodCostItem;
}

export interface InventoryLevel {
  restaurant_id: string;
  food_cost_item_id: string;
  qty_on_hand: number;
  avg_cost: number;
  total_value: number;
  updated_at: string;
  food_cost_item?: FoodCostItem;
}

export interface ItemPurchaseUnit {
  id: string;
  food_cost_item_id: string;
  name: string;
  factor_to_stock_unit: number;
  is_default: boolean;
  created_at: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  food_cost_item_id: string | null;
  description: string;
  purchase_unit: string | null;
  quantity: number;
  unit_cost: number;
  qty_stock_units: number;
  line_total: number;
  created_at: string;
}

export type StockTransferStatus = "in_transit" | "received" | "cancelled";

export interface StockTransferLine {
  id: string;
  transfer_id: string;
  food_cost_item_id: string;
  qty_sent: number;
  qty_received: number | null;
  unit_cost: number;
  created_at: string;
  food_cost_item?: Pick<FoodCostItem, "id" | "name" | "unit">;
}

export interface StockTransfer {
  id: string;
  from_restaurant_id: string;
  to_restaurant_id: string;
  status: StockTransferStatus;
  notes: string | null;
  sent_by: string | null;
  sent_at: string;
  received_by: string | null;
  received_at: string | null;
  created_at: string;
  from_restaurant?: Pick<Restaurant, "id" | "name">;
  to_restaurant?: Pick<Restaurant, "id" | "name">;
  lines?: StockTransferLine[];
}

// ============================================================================
// Onboarding & employment contracts (migration 063)
// ============================================================================

export type OnboardingStatus = "legacy" | "pending" | "in_progress" | "complete" | "exempt";

export interface EmployeeOnboarding {
  employee_id: string;
  status: OnboardingStatus;
  collect_details: boolean;
  issue_contract: boolean;
  details_complete: boolean;
  sensitive_complete: boolean;
  contract_signed: boolean;
  auto_issue: boolean;
  current_step: number;
  skip_allowed: boolean;
  requested_by: string | null;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeSensitive {
  employee_id: string;
  tfn: string | null;
  tfn_exemption: "none" | "applied" | "under_18" | "pensioner" | "not_provided" | null;
  tax_free_threshold: boolean;
  help_debt: boolean;
  tax_residency: "resident" | "foreign" | "working_holiday" | null;
  super_choice: "employer_default" | "own_fund" | null;
  super_fund_name: string | null;
  super_usi: string | null;
  super_member_number: string | null;
  bank_account_name: string | null;
  bank_bsb: string | null;
  bank_account_number: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeDocumentKind = "rsa" | "food_handler" | "visa" | "id" | "qualification" | "other";

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  kind: EmployeeDocumentKind;
  label: string | null;
  file_path: string | null;
  issued_on: string | null;
  expires_on: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface ContractTemplate {
  id: string;
  name: string;
  kind: "contract" | "variation";
  employment_type: "casual" | "part_time" | "full_time" | null;
  restaurant_id: string | null;
  body_html: string;
  version: number;
  active: boolean;
  is_seed_draft: boolean;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractTemplateVersion {
  id: string;
  template_id: string;
  version: number;
  name: string | null;
  body_html: string;
  created_by: string | null;
  created_at: string;
}

export type ContractStatus = "draft" | "issued" | "viewed" | "signed" | "declined" | "superseded";

export interface EmployeeContract {
  id: string;
  employee_id: string;
  template_id: string | null;
  template_version: number | null;
  template_name: string | null;
  kind: "contract" | "variation";
  status: ContractStatus;
  body_html: string;
  tokens: Record<string, string>;
  content_hash: string | null;
  issued_by: string | null;
  authorised_by: string | null;
  auto_issued: boolean;
  issued_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  signature_name: string | null;
  signature_image: string | null;
  signature_ip: string | null;
  signature_user_agent: string | null;
  employer_signatory_name: string | null;
  employer_signatory_title: string | null;
  employer_signature_image: string | null;
  employer_signed_at: string | null;
  decline_reason: string | null;
  storage_path: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingChecklistItem {
  id: string;
  label: string;
  description: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface EmployeeChecklistRow {
  id: string;
  employee_id: string;
  item_id: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
}

export interface ProfileChangeRequest {
  id: string;
  employee_id: string;
  scope: "profile" | "sensitive";
  payload: Record<string, string | null>;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface CompanySettings {
  legal_name: string;
  trading_name: string;
  abn: string;
  address: string;
  signatory_name: string;
  signatory_title: string;
  signature_image: string;
}
