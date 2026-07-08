-- ============================================================================
-- The Coop - Pollo Rotisserie Operations Dashboard
-- Initial Schema Migration
-- ============================================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ============================================================================
-- TRIGGER FUNCTION (no table deps)
-- ============================================================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- 1. RESTAURANTS  (table only — policies added after profiles + helpers)
-- ============================================================================

create table public.restaurants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  lightspeed_id text,
  deputy_id text,
  google_place_id text,
  status text not null default 'active'
    check (status in ('active', 'grace_period', 'inactive')),
  created_at timestamptz not null default now()
);

alter table public.restaurants enable row level security;

-- ============================================================================
-- 2. PROFILES  (table + trigger — must exist before helper functions)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'manager'
    check (role in ('superadmin', 'area_manager', 'manager')),
  restaurant_access uuid[] not null default '{}',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS  (defined here because they query public.profiles)
-- ============================================================================

-- Check if the current user is a superadmin
create or replace function public.is_superadmin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin'
  );
$$ language sql security definer stable;

-- Check if the current user has access to a specific restaurant
create or replace function public.has_restaurant_access(rid uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'superadmin' or rid = any(restaurant_access))
  );
$$ language sql security definer stable;

-- ============================================================================
-- RLS POLICIES: RESTAURANTS  (now that helpers exist)
-- ============================================================================

create policy "restaurants_select" on public.restaurants
  for select using (public.has_restaurant_access(id));

create policy "restaurants_insert" on public.restaurants
  for insert with check (public.is_superadmin());

create policy "restaurants_update" on public.restaurants
  for update using (public.is_superadmin());

create policy "restaurants_delete" on public.restaurants
  for delete using (public.is_superadmin());

-- ============================================================================
-- RLS POLICIES: PROFILES  (helpers now available)
-- ============================================================================

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid() or public.is_superadmin());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid() or public.is_superadmin());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid() or public.is_superadmin());

create policy "profiles_delete" on public.profiles
  for delete using (public.is_superadmin());

-- ============================================================================
-- 3. STORE PROFILES
-- ============================================================================

create table public.store_profiles (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  phone text,
  email text,
  trading_hours jsonb,
  key_contacts jsonb,
  wifi_network text,
  wifi_password text,
  alarm_code text,
  council_details text,
  insurance_details text,
  suppliers jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id)
);

create index idx_store_profiles_restaurant on public.store_profiles(restaurant_id);

alter table public.store_profiles enable row level security;

create policy "store_profiles_select" on public.store_profiles
  for select using (public.has_restaurant_access(restaurant_id));

create policy "store_profiles_insert" on public.store_profiles
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "store_profiles_update" on public.store_profiles
  for update using (public.has_restaurant_access(restaurant_id));

create policy "store_profiles_delete" on public.store_profiles
  for delete using (public.is_superadmin());

create trigger store_profiles_updated_at
  before update on public.store_profiles
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 4. SALES DAILY
-- ============================================================================

create table public.sales_daily (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  date date not null,
  total_sales numeric not null default 0,
  transaction_count integer not null default 0,
  average_transaction numeric not null default 0,
  source text,
  created_at timestamptz not null default now()
);

create index idx_sales_daily_restaurant on public.sales_daily(restaurant_id);
create index idx_sales_daily_date on public.sales_daily(date);
create unique index idx_sales_daily_restaurant_date on public.sales_daily(restaurant_id, date);

alter table public.sales_daily enable row level security;

create policy "sales_daily_select" on public.sales_daily
  for select using (public.has_restaurant_access(restaurant_id));

create policy "sales_daily_insert" on public.sales_daily
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "sales_daily_update" on public.sales_daily
  for update using (public.has_restaurant_access(restaurant_id));

create policy "sales_daily_delete" on public.sales_daily
  for delete using (public.is_superadmin());

-- ============================================================================
-- 5. LABOUR DAILY
-- ============================================================================

create table public.labour_daily (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  date date not null,
  total_hours numeric not null default 0,
  total_cost numeric not null default 0,
  labour_percent numeric not null default 0,
  source text,
  created_at timestamptz not null default now()
);

create index idx_labour_daily_restaurant on public.labour_daily(restaurant_id);
create index idx_labour_daily_date on public.labour_daily(date);
create unique index idx_labour_daily_restaurant_date on public.labour_daily(restaurant_id, date);

alter table public.labour_daily enable row level security;

create policy "labour_daily_select" on public.labour_daily
  for select using (public.has_restaurant_access(restaurant_id));

create policy "labour_daily_insert" on public.labour_daily
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "labour_daily_update" on public.labour_daily
  for update using (public.has_restaurant_access(restaurant_id));

create policy "labour_daily_delete" on public.labour_daily
  for delete using (public.is_superadmin());

-- ============================================================================
-- 6. GOOGLE REVIEWS
-- ============================================================================

create table public.google_reviews (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  reviewer_name text,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  review_date timestamptz,
  reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_google_reviews_restaurant on public.google_reviews(restaurant_id);
create index idx_google_reviews_date on public.google_reviews(review_date);

alter table public.google_reviews enable row level security;

create policy "google_reviews_select" on public.google_reviews
  for select using (public.has_restaurant_access(restaurant_id));

create policy "google_reviews_insert" on public.google_reviews
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "google_reviews_update" on public.google_reviews
  for update using (public.has_restaurant_access(restaurant_id));

create policy "google_reviews_delete" on public.google_reviews
  for delete using (public.is_superadmin());

-- ============================================================================
-- 7. TARGETS
-- ============================================================================

create table public.targets (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  metric text not null,
  period text not null check (period in ('daily', 'weekly', 'monthly')),
  target_value numeric not null,
  amber_threshold numeric,
  red_threshold numeric,
  created_at timestamptz not null default now()
);

create index idx_targets_restaurant on public.targets(restaurant_id);

alter table public.targets enable row level security;

create policy "targets_select" on public.targets
  for select using (public.has_restaurant_access(restaurant_id));

create policy "targets_insert" on public.targets
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "targets_update" on public.targets
  for update using (public.has_restaurant_access(restaurant_id));

create policy "targets_delete" on public.targets
  for delete using (public.is_superadmin());

-- ============================================================================
-- 8. ALERT CONFIGS
-- ============================================================================

create table public.alert_configs (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid references public.restaurants on delete cascade,
  metric text not null,
  condition text not null,
  threshold numeric not null,
  notify_roles text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_alert_configs_restaurant on public.alert_configs(restaurant_id);

alter table public.alert_configs enable row level security;

create policy "alert_configs_select" on public.alert_configs
  for select using (
    (restaurant_id is null and public.is_superadmin())
    or (restaurant_id is not null and public.has_restaurant_access(restaurant_id))
  );

create policy "alert_configs_insert" on public.alert_configs
  for insert with check (public.is_superadmin());

create policy "alert_configs_update" on public.alert_configs
  for update using (public.is_superadmin());

create policy "alert_configs_delete" on public.alert_configs
  for delete using (public.is_superadmin());

-- ============================================================================
-- 9. CALENDAR EVENTS
-- ============================================================================

create table public.calendar_events (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid references public.restaurants on delete cascade,
  title text not null,
  description text,
  start_date timestamptz not null,
  end_date timestamptz,
  all_day boolean not null default false,
  event_type text,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create index idx_calendar_events_restaurant on public.calendar_events(restaurant_id);
create index idx_calendar_events_start on public.calendar_events(start_date);

alter table public.calendar_events enable row level security;

create policy "calendar_events_select" on public.calendar_events
  for select using (
    restaurant_id is null
    or public.has_restaurant_access(restaurant_id)
  );

create policy "calendar_events_insert" on public.calendar_events
  for insert with check (
    (restaurant_id is null and public.is_superadmin())
    or (restaurant_id is not null and public.has_restaurant_access(restaurant_id))
  );

create policy "calendar_events_update" on public.calendar_events
  for update using (
    (restaurant_id is null and public.is_superadmin())
    or (restaurant_id is not null and public.has_restaurant_access(restaurant_id))
  );

create policy "calendar_events_delete" on public.calendar_events
  for delete using (public.is_superadmin() or created_by = auth.uid());

-- ============================================================================
-- 10. FOOD COST ITEMS (global)
-- ============================================================================

create table public.food_cost_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text,
  unit text,
  cost_per_unit numeric not null default 0,
  supplier text,
  created_at timestamptz not null default now()
);

alter table public.food_cost_items enable row level security;

create policy "food_cost_items_select" on public.food_cost_items
  for select using (auth.uid() is not null);

create policy "food_cost_items_insert" on public.food_cost_items
  for insert with check (public.is_superadmin());

create policy "food_cost_items_update" on public.food_cost_items
  for update using (public.is_superadmin());

create policy "food_cost_items_delete" on public.food_cost_items
  for delete using (public.is_superadmin());

-- ============================================================================
-- 11. STOCK COUNTS
-- ============================================================================

create table public.stock_counts (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  counted_by uuid references public.profiles on delete set null,
  count_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved')),
  notes text,
  created_at timestamptz not null default now()
);

create index idx_stock_counts_restaurant on public.stock_counts(restaurant_id);
create index idx_stock_counts_date on public.stock_counts(count_date);

alter table public.stock_counts enable row level security;

create policy "stock_counts_select" on public.stock_counts
  for select using (public.has_restaurant_access(restaurant_id));

create policy "stock_counts_insert" on public.stock_counts
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "stock_counts_update" on public.stock_counts
  for update using (public.has_restaurant_access(restaurant_id));

create policy "stock_counts_delete" on public.stock_counts
  for delete using (public.is_superadmin());

-- ============================================================================
-- 12. STOCK COUNT LINES
-- ============================================================================

create table public.stock_count_lines (
  id uuid primary key default uuid_generate_v4(),
  stock_count_id uuid not null references public.stock_counts on delete cascade,
  food_cost_item_id uuid not null references public.food_cost_items on delete cascade,
  quantity numeric not null default 0,
  total_value numeric not null default 0
);

create index idx_stock_count_lines_count on public.stock_count_lines(stock_count_id);

alter table public.stock_count_lines enable row level security;

create policy "stock_count_lines_select" on public.stock_count_lines
  for select using (
    exists (
      select 1 from public.stock_counts sc
      where sc.id = stock_count_lines.stock_count_id
        and public.has_restaurant_access(sc.restaurant_id)
    )
  );

create policy "stock_count_lines_insert" on public.stock_count_lines
  for insert with check (
    exists (
      select 1 from public.stock_counts sc
      where sc.id = stock_count_lines.stock_count_id
        and public.has_restaurant_access(sc.restaurant_id)
    )
  );

create policy "stock_count_lines_update" on public.stock_count_lines
  for update using (
    exists (
      select 1 from public.stock_counts sc
      where sc.id = stock_count_lines.stock_count_id
        and public.has_restaurant_access(sc.restaurant_id)
    )
  );

create policy "stock_count_lines_delete" on public.stock_count_lines
  for delete using (public.is_superadmin());

-- ============================================================================
-- 13. SUPPLIER INVOICES
-- ============================================================================

create table public.supplier_invoices (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  supplier_name text not null,
  invoice_number text,
  invoice_date date not null,
  amount numeric not null default 0,
  category text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid')),
  created_at timestamptz not null default now()
);

create index idx_supplier_invoices_restaurant on public.supplier_invoices(restaurant_id);
create index idx_supplier_invoices_date on public.supplier_invoices(invoice_date);

alter table public.supplier_invoices enable row level security;

create policy "supplier_invoices_select" on public.supplier_invoices
  for select using (public.has_restaurant_access(restaurant_id));

create policy "supplier_invoices_insert" on public.supplier_invoices
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "supplier_invoices_update" on public.supplier_invoices
  for update using (public.has_restaurant_access(restaurant_id));

create policy "supplier_invoices_delete" on public.supplier_invoices
  for delete using (public.is_superadmin());

-- ============================================================================
-- 14. CHECKLIST TEMPLATES (global)
-- ============================================================================

create table public.checklist_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  checklist_type text not null
    check (checklist_type in ('opening', 'closing', 'custom')),
  items jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

alter table public.checklist_templates enable row level security;

create policy "checklist_templates_select" on public.checklist_templates
  for select using (auth.uid() is not null);

create policy "checklist_templates_insert" on public.checklist_templates
  for insert with check (public.is_superadmin());

create policy "checklist_templates_update" on public.checklist_templates
  for update using (public.is_superadmin());

create policy "checklist_templates_delete" on public.checklist_templates
  for delete using (public.is_superadmin());

-- ============================================================================
-- 15. CHECKLIST COMPLETIONS
-- ============================================================================

create table public.checklist_completions (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.checklist_templates on delete cascade,
  restaurant_id uuid not null references public.restaurants on delete cascade,
  completed_by uuid references public.profiles on delete set null,
  completed_at timestamptz not null default now(),
  responses jsonb not null default '{}'::jsonb,
  notes text
);

create index idx_checklist_completions_restaurant on public.checklist_completions(restaurant_id);
create index idx_checklist_completions_date on public.checklist_completions(completed_at);

alter table public.checklist_completions enable row level security;

create policy "checklist_completions_select" on public.checklist_completions
  for select using (public.has_restaurant_access(restaurant_id));

create policy "checklist_completions_insert" on public.checklist_completions
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "checklist_completions_update" on public.checklist_completions
  for update using (public.has_restaurant_access(restaurant_id));

create policy "checklist_completions_delete" on public.checklist_completions
  for delete using (public.is_superadmin());

-- ============================================================================
-- 16. ASSETS
-- ============================================================================

create table public.assets (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  name text not null,
  category text,
  make text,
  model text,
  serial_number text,
  purchase_date date,
  warranty_expiry date,
  status text not null default 'operational'
    check (status in ('operational', 'needs_repair', 'out_of_service', 'retired')),
  notes text,
  created_at timestamptz not null default now()
);

create index idx_assets_restaurant on public.assets(restaurant_id);

alter table public.assets enable row level security;

create policy "assets_select" on public.assets
  for select using (public.has_restaurant_access(restaurant_id));

create policy "assets_insert" on public.assets
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "assets_update" on public.assets
  for update using (public.has_restaurant_access(restaurant_id));

create policy "assets_delete" on public.assets
  for delete using (public.is_superadmin());

-- ============================================================================
-- 17. MAINTENANCE REQUESTS
-- ============================================================================

create table public.maintenance_requests (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  asset_id uuid references public.assets on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_parts', 'completed', 'cancelled')),
  requested_by uuid references public.profiles on delete set null,
  assigned_to uuid references public.profiles on delete set null,
  completed_at timestamptz,
  cost numeric,
  created_at timestamptz not null default now()
);

create index idx_maintenance_requests_restaurant on public.maintenance_requests(restaurant_id);
create index idx_maintenance_requests_status on public.maintenance_requests(status);

alter table public.maintenance_requests enable row level security;

create policy "maintenance_requests_select" on public.maintenance_requests
  for select using (public.has_restaurant_access(restaurant_id));

create policy "maintenance_requests_insert" on public.maintenance_requests
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "maintenance_requests_update" on public.maintenance_requests
  for update using (public.has_restaurant_access(restaurant_id));

create policy "maintenance_requests_delete" on public.maintenance_requests
  for delete using (public.is_superadmin());

-- ============================================================================
-- 18. SCHEDULED MAINTENANCE
-- ============================================================================

create table public.scheduled_maintenance (
  id uuid primary key default uuid_generate_v4(),
  asset_id uuid not null references public.assets on delete cascade,
  description text,
  frequency_days integer not null,
  last_completed date,
  next_due date,
  created_at timestamptz not null default now()
);

create index idx_scheduled_maintenance_asset on public.scheduled_maintenance(asset_id);
create index idx_scheduled_maintenance_next_due on public.scheduled_maintenance(next_due);

alter table public.scheduled_maintenance enable row level security;

create policy "scheduled_maintenance_select" on public.scheduled_maintenance
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = scheduled_maintenance.asset_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "scheduled_maintenance_insert" on public.scheduled_maintenance
  for insert with check (
    exists (
      select 1 from public.assets a
      where a.id = scheduled_maintenance.asset_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "scheduled_maintenance_update" on public.scheduled_maintenance
  for update using (
    exists (
      select 1 from public.assets a
      where a.id = scheduled_maintenance.asset_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "scheduled_maintenance_delete" on public.scheduled_maintenance
  for delete using (public.is_superadmin());

-- ============================================================================
-- 19. WASTE LOGS
-- ============================================================================

create table public.waste_logs (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  date date not null,
  item_name text not null,
  quantity numeric not null default 0,
  unit text,
  estimated_cost numeric not null default 0,
  reason text,
  logged_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create index idx_waste_logs_restaurant on public.waste_logs(restaurant_id);
create index idx_waste_logs_date on public.waste_logs(date);

alter table public.waste_logs enable row level security;

create policy "waste_logs_select" on public.waste_logs
  for select using (public.has_restaurant_access(restaurant_id));

create policy "waste_logs_insert" on public.waste_logs
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "waste_logs_update" on public.waste_logs
  for update using (public.has_restaurant_access(restaurant_id));

create policy "waste_logs_delete" on public.waste_logs
  for delete using (public.is_superadmin());

-- ============================================================================
-- 20. BANK ACCOUNTS  (before cash_deposits due to FK)
-- ============================================================================

create table public.bank_accounts (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  bank_name text not null,
  account_name text not null,
  bsb text not null,
  account_number text not null,
  created_at timestamptz not null default now()
);

create index idx_bank_accounts_restaurant on public.bank_accounts(restaurant_id);

alter table public.bank_accounts enable row level security;

create policy "bank_accounts_select" on public.bank_accounts
  for select using (public.has_restaurant_access(restaurant_id));

create policy "bank_accounts_insert" on public.bank_accounts
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "bank_accounts_update" on public.bank_accounts
  for update using (public.has_restaurant_access(restaurant_id));

create policy "bank_accounts_delete" on public.bank_accounts
  for delete using (public.is_superadmin());

-- ============================================================================
-- 21. CASH DEPOSITS
-- ============================================================================

create table public.cash_deposits (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  deposit_date date not null,
  amount numeric not null default 0,
  bank_account_id uuid references public.bank_accounts on delete set null,
  reference text,
  deposited_by uuid references public.profiles on delete set null,
  verified boolean not null default false,
  verified_by uuid references public.profiles on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_cash_deposits_restaurant on public.cash_deposits(restaurant_id);
create index idx_cash_deposits_date on public.cash_deposits(deposit_date);

alter table public.cash_deposits enable row level security;

create policy "cash_deposits_select" on public.cash_deposits
  for select using (public.has_restaurant_access(restaurant_id));

create policy "cash_deposits_insert" on public.cash_deposits
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "cash_deposits_update" on public.cash_deposits
  for update using (public.has_restaurant_access(restaurant_id));

create policy "cash_deposits_delete" on public.cash_deposits
  for delete using (public.is_superadmin());

-- ============================================================================
-- 22. CATERING ORDERS
-- ============================================================================

create table public.catering_orders (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  event_date date not null,
  event_time time,
  delivery_address text,
  is_delivery boolean not null default false,
  guest_count integer,
  items jsonb not null default '[]'::jsonb,
  total_amount numeric not null default 0,
  deposit_paid numeric not null default 0,
  status text not null default 'enquiry'
    check (status in ('enquiry', 'confirmed', 'preparing', 'delivered', 'completed', 'cancelled')),
  notes text,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create index idx_catering_orders_restaurant on public.catering_orders(restaurant_id);
create index idx_catering_orders_event_date on public.catering_orders(event_date);

alter table public.catering_orders enable row level security;

create policy "catering_orders_select" on public.catering_orders
  for select using (public.has_restaurant_access(restaurant_id));

create policy "catering_orders_insert" on public.catering_orders
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "catering_orders_update" on public.catering_orders
  for update using (public.has_restaurant_access(restaurant_id));

create policy "catering_orders_delete" on public.catering_orders
  for delete using (public.is_superadmin());

-- ============================================================================
-- 23. INCIDENTS
-- ============================================================================

create table public.incidents (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  title text not null,
  description text,
  incident_type text not null
    check (incident_type in ('injury', 'food_safety', 'equipment', 'customer_complaint', 'theft', 'other')),
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  incident_date timestamptz not null,
  reported_by uuid references public.profiles on delete set null,
  status text not null default 'open'
    check (status in ('open', 'investigating', 'resolved', 'closed')),
  resolution text,
  created_at timestamptz not null default now()
);

create index idx_incidents_restaurant on public.incidents(restaurant_id);
create index idx_incidents_date on public.incidents(incident_date);

alter table public.incidents enable row level security;

create policy "incidents_select" on public.incidents
  for select using (public.has_restaurant_access(restaurant_id));

create policy "incidents_insert" on public.incidents
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "incidents_update" on public.incidents
  for update using (public.has_restaurant_access(restaurant_id));

create policy "incidents_delete" on public.incidents
  for delete using (public.is_superadmin());

-- ============================================================================
-- 24. INCIDENT CORRECTIVE ACTIONS
-- ============================================================================

create table public.incident_corrective_actions (
  id uuid primary key default uuid_generate_v4(),
  incident_id uuid not null references public.incidents on delete cascade,
  action text not null,
  assigned_to uuid references public.profiles on delete set null,
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz
);

create index idx_incident_corrective_actions_incident on public.incident_corrective_actions(incident_id);

alter table public.incident_corrective_actions enable row level security;

create policy "incident_corrective_actions_select" on public.incident_corrective_actions
  for select using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_corrective_actions.incident_id
        and public.has_restaurant_access(i.restaurant_id)
    )
  );

create policy "incident_corrective_actions_insert" on public.incident_corrective_actions
  for insert with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_corrective_actions.incident_id
        and public.has_restaurant_access(i.restaurant_id)
    )
  );

create policy "incident_corrective_actions_update" on public.incident_corrective_actions
  for update using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_corrective_actions.incident_id
        and public.has_restaurant_access(i.restaurant_id)
    )
  );

create policy "incident_corrective_actions_delete" on public.incident_corrective_actions
  for delete using (public.is_superadmin());

-- ============================================================================
-- 25. WHS AUDIT TEMPLATES (global)
-- ============================================================================

create table public.whs_audit_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  sections jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

alter table public.whs_audit_templates enable row level security;

create policy "whs_audit_templates_select" on public.whs_audit_templates
  for select using (auth.uid() is not null);

create policy "whs_audit_templates_insert" on public.whs_audit_templates
  for insert with check (public.is_superadmin());

create policy "whs_audit_templates_update" on public.whs_audit_templates
  for update using (public.is_superadmin());

create policy "whs_audit_templates_delete" on public.whs_audit_templates
  for delete using (public.is_superadmin());

-- ============================================================================
-- 26. WHS AUDITS
-- ============================================================================

create table public.whs_audits (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.whs_audit_templates on delete cascade,
  restaurant_id uuid not null references public.restaurants on delete cascade,
  audited_by uuid references public.profiles on delete set null,
  audit_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'reviewed')),
  overall_score numeric,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_whs_audits_restaurant on public.whs_audits(restaurant_id);
create index idx_whs_audits_date on public.whs_audits(audit_date);

alter table public.whs_audits enable row level security;

create policy "whs_audits_select" on public.whs_audits
  for select using (public.has_restaurant_access(restaurant_id));

create policy "whs_audits_insert" on public.whs_audits
  for insert with check (public.has_restaurant_access(restaurant_id));

create policy "whs_audits_update" on public.whs_audits
  for update using (public.has_restaurant_access(restaurant_id));

create policy "whs_audits_delete" on public.whs_audits
  for delete using (public.is_superadmin());

-- ============================================================================
-- 27. WHS AUDIT RESPONSES
-- ============================================================================

create table public.whs_audit_responses (
  id uuid primary key default uuid_generate_v4(),
  audit_id uuid not null references public.whs_audits on delete cascade,
  question_id text not null,
  response text,
  notes text,
  photo_url text
);

create index idx_whs_audit_responses_audit on public.whs_audit_responses(audit_id);

alter table public.whs_audit_responses enable row level security;

create policy "whs_audit_responses_select" on public.whs_audit_responses
  for select using (
    exists (
      select 1 from public.whs_audits a
      where a.id = whs_audit_responses.audit_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "whs_audit_responses_insert" on public.whs_audit_responses
  for insert with check (
    exists (
      select 1 from public.whs_audits a
      where a.id = whs_audit_responses.audit_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "whs_audit_responses_update" on public.whs_audit_responses
  for update using (
    exists (
      select 1 from public.whs_audits a
      where a.id = whs_audit_responses.audit_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "whs_audit_responses_delete" on public.whs_audit_responses
  for delete using (public.is_superadmin());

-- ============================================================================
-- 28. WHS CORRECTIVE ACTIONS
-- ============================================================================

create table public.whs_corrective_actions (
  id uuid primary key default uuid_generate_v4(),
  audit_id uuid not null references public.whs_audits on delete cascade,
  question_id text,
  action text not null,
  assigned_to uuid references public.profiles on delete set null,
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz
);

create index idx_whs_corrective_actions_audit on public.whs_corrective_actions(audit_id);

alter table public.whs_corrective_actions enable row level security;

create policy "whs_corrective_actions_select" on public.whs_corrective_actions
  for select using (
    exists (
      select 1 from public.whs_audits a
      where a.id = whs_corrective_actions.audit_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "whs_corrective_actions_insert" on public.whs_corrective_actions
  for insert with check (
    exists (
      select 1 from public.whs_audits a
      where a.id = whs_corrective_actions.audit_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "whs_corrective_actions_update" on public.whs_corrective_actions
  for update using (
    exists (
      select 1 from public.whs_audits a
      where a.id = whs_corrective_actions.audit_id
        and public.has_restaurant_access(a.restaurant_id)
    )
  );

create policy "whs_corrective_actions_delete" on public.whs_corrective_actions
  for delete using (public.is_superadmin());

-- ============================================================================
-- 29. APP SETTINGS (global)
-- ============================================================================

create table public.app_settings (
  id uuid primary key default uuid_generate_v4(),
  key text unique not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "app_settings_select" on public.app_settings
  for select using (auth.uid() is not null);

create policy "app_settings_insert" on public.app_settings
  for insert with check (public.is_superadmin());

create policy "app_settings_update" on public.app_settings
  for update using (public.is_superadmin());

create policy "app_settings_delete" on public.app_settings
  for delete using (public.is_superadmin());

create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
