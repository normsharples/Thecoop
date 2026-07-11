export interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  lightspeed_id: string | null;
  deputy_id: string | null;
  google_place_id: string | null;
  status: "active" | "grace_period" | "inactive";
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: "superadmin" | "area_manager" | "manager" | "staff";
  restaurant_access: string[];
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
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

export interface Recipe {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  yield_unit: string;
  created_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  food_cost_item_id: string;
  quantity: number;
  food_cost_item?: FoodCostItem;
  created_at: string;
}

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
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
