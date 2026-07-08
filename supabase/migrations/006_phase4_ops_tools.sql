-- ============================================================================
-- The Coop - Phase 4: Ops Tools
-- Migration 006 — Schema extensions + seeds for Phase 4 modules
-- ============================================================================

-- ============================================================================
-- 1. CHECKLIST TEMPLATES — extend type check + add frequency + assigned_restaurants
-- ============================================================================

-- Drop existing type check constraint and recreate with more types
alter table public.checklist_templates
  drop constraint if exists checklist_templates_checklist_type_check;

alter table public.checklist_templates
  add constraint checklist_templates_checklist_type_check
    check (checklist_type in ('opening', 'closing', 'food_safety', 'cleaning', 'weekly', 'custom'));

alter table public.checklist_templates
  add column if not exists frequency text not null default 'daily'
    check (frequency in ('daily', 'twice_daily', 'weekly'));

alter table public.checklist_templates
  add column if not exists assigned_restaurants uuid[] not null default '{}';

-- ============================================================================
-- 2. CHECKLIST COMPLETIONS — add score + completed_date + start_time
-- ============================================================================

alter table public.checklist_completions
  add column if not exists score numeric,
  add column if not exists completed_date date,
  add column if not exists start_time timestamptz;

-- ============================================================================
-- 3. FOOD COST ITEMS — add active flag
-- ============================================================================

alter table public.food_cost_items
  add column if not exists active boolean not null default true;

-- ============================================================================
-- 4. STOCK COUNTS — add week_ending, approval fields, food_cost_pct
-- ============================================================================

alter table public.stock_counts
  add column if not exists week_ending date,
  add column if not exists approved_by uuid references public.profiles on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists food_cost_pct numeric,
  add column if not exists total_cost numeric,
  add column if not exists updated_at timestamptz not null default now();

create trigger stock_counts_updated_at
  before update on public.stock_counts
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 5. STOCK COUNT LINES — add opening_stock, purchases, closing_stock, usage, cost
-- ============================================================================

alter table public.stock_count_lines
  add column if not exists opening_stock numeric not null default 0,
  add column if not exists purchases numeric not null default 0,
  add column if not exists closing_stock numeric not null default 0,
  add column if not exists usage_qty numeric not null default 0,
  add column if not exists cost numeric not null default 0;

-- Rename quantity → quantity_on_hand (keep old col for compat, just add new ones)

-- ============================================================================
-- 6. ASSETS — add install_date, service_interval_days, photo_url
-- ============================================================================

alter table public.assets
  add column if not exists install_date date,
  add column if not exists service_interval_days integer,
  add column if not exists photo_url text,
  add column if not exists updated_at timestamptz not null default now();

create trigger assets_updated_at
  before update on public.assets
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 7. MAINTENANCE REQUESTS — add resolution_notes, photo_url, updated_at
-- ============================================================================

alter table public.maintenance_requests
  add column if not exists resolution_notes text,
  add column if not exists photo_url text,
  add column if not exists updated_at timestamptz not null default now();

create trigger maintenance_requests_updated_at
  before update on public.maintenance_requests
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 8. SCHEDULED MAINTENANCE — add restaurant_id for easier querying
-- ============================================================================

alter table public.scheduled_maintenance
  add column if not exists restaurant_id uuid references public.restaurants on delete cascade,
  add column if not exists title text,
  add column if not exists completed_by uuid references public.profiles on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create trigger scheduled_maintenance_updated_at
  before update on public.scheduled_maintenance
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 9. WASTE LOGS — add photo_url, food_cost_item_id
-- ============================================================================

alter table public.waste_logs
  add column if not exists photo_url text,
  add column if not exists food_cost_item_id uuid references public.food_cost_items on delete set null;

-- ============================================================================
-- 10. BANK ACCOUNTS — add active + assigned_restaurants
-- ============================================================================

alter table public.bank_accounts
  add column if not exists active boolean not null default true,
  add column if not exists assigned_restaurants uuid[] not null default '{}';

-- ============================================================================
-- 11. CASH DEPOSITS — add deposit_slip_url, flagged, flag_notes, flag_set_by
-- ============================================================================

alter table public.cash_deposits
  add column if not exists deposit_slip_url text,
  add column if not exists flagged boolean not null default false,
  add column if not exists flag_notes text,
  add column if not exists flag_set_by uuid references public.profiles on delete set null;

-- ============================================================================
-- 12. CATERING ORDERS — add calendar_event_id, prep_event_id, payment_status,
--     cancellation_reason, internal_notes
-- ============================================================================

alter table public.catering_orders
  add column if not exists calendar_event_id uuid,
  add column if not exists prep_event_id uuid,
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'deposit_paid', 'paid')),
  add column if not exists cancellation_reason text,
  add column if not exists internal_notes text,
  add column if not exists updated_at timestamptz not null default now();

create trigger catering_orders_updated_at
  before update on public.catering_orders
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 13. CALENDAR EVENTS — update type check to include catering/maintenance types
-- ============================================================================

alter table public.calendar_events
  drop constraint if exists calendar_events_type_check;

alter table public.calendar_events
  add constraint calendar_events_type_check
    check (event_type in (
      'store_event', 'deadline', 'milestone', 'meeting',
      'catering', 'catering_prep', 'maintenance'
    ));


-- ============================================================================
-- 14. SEED: FOOD COST ITEMS
-- ============================================================================

insert into public.food_cost_items (name, category, unit, cost_per_unit, active) values
  -- Protein
  ('Whole Chicken', 'Protein', 'kg', 6.50, true),
  ('Chicken Wings', 'Protein', 'kg', 8.20, true),
  ('Chicken Tenders', 'Protein', 'kg', 11.80, true),
  ('Marinated Chicken', 'Protein', 'kg', 7.90, true),
  -- Sides
  ('Frozen Chips', 'Sides', 'kg', 2.10, true),
  ('Coleslaw Mix', 'Sides', 'kg', 3.40, true),
  ('Gravy Powder', 'Sides', 'kg', 5.60, true),
  ('Sauce Portions', 'Sides', 'units', 0.18, true),
  -- Packaging
  ('Meal Boxes', 'Packaging', 'units', 0.45, true),
  ('Paper Bags', 'Packaging', 'units', 0.12, true),
  ('Chip Scoops', 'Packaging', 'units', 0.08, true),
  ('Drink Cups', 'Packaging', 'units', 0.22, true),
  ('Napkins', 'Packaging', 'units', 0.03, true),
  -- Beverages
  ('Canned Drinks', 'Beverages', 'units', 0.95, true),
  ('Bottled Water', 'Beverages', 'units', 0.60, true)
on conflict do nothing;

-- ============================================================================
-- 15. SEED: CHECKLIST TEMPLATES
-- ============================================================================

-- Template 1: Opening Checklist (daily)
insert into public.checklist_templates (name, description, checklist_type, frequency, assigned_restaurants, items)
values (
  'Opening Checklist',
  'Daily opening procedures for all stations',
  'opening',
  'daily',
  '{}',
  '[
    {"id":"oc-01","section":"Kitchen","text":"Turn on ovens and rotisseries","type":"checkbox","order":1},
    {"id":"oc-02","section":"Kitchen","text":"Cool room temperature","type":"temperature","threshold":{"min":0,"max":5,"unit":"°C"},"order":2},
    {"id":"oc-03","section":"Kitchen","text":"Freezer temperature","type":"temperature","threshold":{"min":-25,"max":-18,"unit":"°C"},"order":3},
    {"id":"oc-04","section":"Kitchen","text":"Prep station set up and clean","type":"checkbox","order":4},
    {"id":"oc-05","section":"Kitchen","text":"Chicken stock levels adequate","type":"checkbox","order":5},
    {"id":"oc-06","section":"Kitchen","text":"Oil levels checked and topped up","type":"checkbox","order":6},
    {"id":"oc-07","section":"Kitchen","text":"Handwash stations stocked","type":"checkbox","order":7},
    {"id":"oc-08","section":"FOH","text":"POS system booted and ready","type":"checkbox","order":8},
    {"id":"oc-09","section":"FOH","text":"Display counter clean and stocked","type":"checkbox","order":9},
    {"id":"oc-10","section":"FOH","text":"Signage and specials boards updated","type":"checkbox","order":10},
    {"id":"oc-11","section":"FOH","text":"Floors swept and mopped","type":"checkbox","order":11},
    {"id":"oc-12","section":"FOH","text":"Bathrooms checked and stocked","type":"checkbox","order":12},
    {"id":"oc-13","section":"Safety","text":"First aid kit checked and accessible","type":"checkbox","order":13},
    {"id":"oc-14","section":"Safety","text":"Fire exits clear and unobstructed","type":"checkbox","order":14},
    {"id":"oc-15","section":"Safety","text":"Wet floor signs available","type":"checkbox","order":15}
  ]'::jsonb
) on conflict do nothing;

-- Template 2: Closing Checklist (daily)
insert into public.checklist_templates (name, description, checklist_type, frequency, assigned_restaurants, items)
values (
  'Closing Checklist',
  'Daily closing procedures and shutdown',
  'closing',
  'daily',
  '{}',
  '[
    {"id":"cc-01","section":"Kitchen","text":"All ovens and fryers turned off","type":"checkbox","order":1},
    {"id":"cc-02","section":"Kitchen","text":"Cool room temperature","type":"temperature","threshold":{"min":0,"max":5,"unit":"°C"},"order":2},
    {"id":"cc-03","section":"Kitchen","text":"All food wrapped, labelled and stored","type":"checkbox","order":3},
    {"id":"cc-04","section":"Kitchen","text":"All surfaces cleaned and sanitised","type":"checkbox","order":4},
    {"id":"cc-05","section":"Kitchen","text":"Floors swept, mopped and clean","type":"checkbox","order":5},
    {"id":"cc-06","section":"Kitchen","text":"Grease traps checked and cleaned","type":"checkbox","order":6},
    {"id":"cc-07","section":"Kitchen","text":"Bins emptied and relined","type":"checkbox","order":7},
    {"id":"cc-08","section":"FOH","text":"POS closed and daily report printed","type":"checkbox","order":8},
    {"id":"cc-09","section":"FOH","text":"Cash counted and secured","type":"checkbox","order":9},
    {"id":"cc-10","section":"FOH","text":"Display counter emptied and cleaned","type":"checkbox","order":10},
    {"id":"cc-11","section":"FOH","text":"Tables wiped and chairs stacked","type":"checkbox","order":11},
    {"id":"cc-12","section":"FOH","text":"Floors swept and mopped","type":"checkbox","order":12},
    {"id":"cc-13","section":"FOH","text":"All doors locked","type":"checkbox","order":13},
    {"id":"cc-14","section":"FOH","text":"Alarm set","type":"checkbox","order":14},
    {"id":"cc-15","section":"Externals","text":"Outdoor signage secured","type":"checkbox","order":15},
    {"id":"cc-16","section":"Externals","text":"Outdoor area clean","type":"checkbox","order":16},
    {"id":"cc-17","section":"Externals","text":"External bins emptied","type":"checkbox","order":17}
  ]'::jsonb
) on conflict do nothing;

-- Template 3: Food Safety Temp Log (twice_daily)
insert into public.checklist_templates (name, description, checklist_type, frequency, assigned_restaurants, items)
values (
  'Food Safety Temp Log',
  'Temperature recording for all refrigeration and cooking equipment',
  'food_safety',
  'twice_daily',
  '{}',
  '[
    {"id":"fs-01","section":"Refrigeration","text":"Cool Room 1","type":"temperature","threshold":{"min":0,"max":5,"unit":"°C"},"order":1},
    {"id":"fs-02","section":"Refrigeration","text":"Cool Room 2","type":"temperature","threshold":{"min":0,"max":5,"unit":"°C"},"order":2},
    {"id":"fs-03","section":"Refrigeration","text":"Freezer","type":"temperature","threshold":{"min":-25,"max":-18,"unit":"°C"},"order":3},
    {"id":"fs-04","section":"Hot Holding","text":"Bain-marie temperature (min 60°C)","type":"temperature","threshold":{"min":60,"max":100,"unit":"°C"},"order":4},
    {"id":"fs-05","section":"Hot Holding","text":"Cooked chicken temperature (min 75°C)","type":"temperature","threshold":{"min":75,"max":100,"unit":"°C"},"order":5},
    {"id":"fs-06","section":"Hot Holding","text":"Cooked chicken photo evidence","type":"photo_required","order":6},
    {"id":"fs-07","section":"Display","text":"Display cabinet temperature","type":"temperature","threshold":{"min":60,"max":100,"unit":"°C"},"order":7}
  ]'::jsonb
) on conflict do nothing;

-- Template 4: Cleaning Schedule (daily)
insert into public.checklist_templates (name, description, checklist_type, frequency, assigned_restaurants, items)
values (
  'Cleaning Schedule',
  'Daily and weekly cleaning tasks',
  'cleaning',
  'daily',
  '{}',
  '[
    {"id":"cs-01","section":"Daily","text":"Floors swept and mopped (all areas)","type":"checkbox","order":1},
    {"id":"cs-02","section":"Daily","text":"All food prep surfaces cleaned and sanitised","type":"checkbox","order":2},
    {"id":"cs-03","section":"Daily","text":"Bathrooms cleaned and restocked","type":"checkbox","order":3},
    {"id":"cs-04","section":"Daily","text":"Display glass wiped down","type":"checkbox","order":4},
    {"id":"cs-05","section":"Daily","text":"POS terminals wiped","type":"checkbox","order":5},
    {"id":"cs-06","section":"Daily","text":"Door handles sanitised","type":"checkbox","order":6},
    {"id":"cs-07","section":"Weekly","text":"Deep fryers drained and cleaned","type":"checkbox","order":7},
    {"id":"cs-08","section":"Weekly","text":"Oven interior descaled","type":"checkbox","order":8},
    {"id":"cs-09","section":"Weekly","text":"Exhaust filters cleaned","type":"checkbox","order":9},
    {"id":"cs-10","section":"Weekly","text":"Grease trap cleaned","type":"checkbox","order":10},
    {"id":"cs-11","section":"Weekly","text":"Cool room shelves wiped down","type":"checkbox","order":11},
    {"id":"cs-12","section":"Weekly","text":"Storage areas organised and checked","type":"checkbox","order":12}
  ]'::jsonb
) on conflict do nothing;

-- Template 5: Weekly Manager Review (weekly)
insert into public.checklist_templates (name, description, checklist_type, frequency, assigned_restaurants, items)
values (
  'Weekly Manager Review',
  'Weekly management tasks and review items',
  'weekly',
  'weekly',
  '{}',
  '[
    {"id":"wm-01","section":"Operations","text":"Stock order placed for next week","type":"checkbox","order":1},
    {"id":"wm-02","section":"Operations","text":"Roster published for next week","type":"checkbox","order":2},
    {"id":"wm-03","section":"Operations","text":"Any maintenance issues logged","type":"checkbox","order":3},
    {"id":"wm-04","section":"Team","text":"Team briefing completed","type":"checkbox","order":4},
    {"id":"wm-05","section":"Finance","text":"Waste log reviewed","type":"checkbox","order":5},
    {"id":"wm-06","section":"Finance","text":"Cash deposits all up to date","type":"checkbox","order":6},
    {"id":"wm-07","section":"Customer","text":"Google reviews checked and actioned","type":"checkbox","order":7},
    {"id":"wm-08","section":"Operations","text":"Notes","type":"text_note","order":8}
  ]'::jsonb
) on conflict do nothing;

-- ============================================================================
-- 16. SEED: ASSETS (8 per restaurant, 3 restaurants = 24 rows)
-- ============================================================================

-- Geelong West assets
insert into public.assets (restaurant_id, name, category, make, model, serial_number, install_date, warranty_expiry, service_interval_days, status)
values
  ('aaa00000-0000-0000-0000-000000000001', 'Rotisserie Oven 1', 'Rotisserie', 'Rotisol', 'Grand Star GS 1503 E', 'RS-GW-001', '2021-03-15', '2026-03-15', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'Backup Oven', 'Oven', 'Miele', 'H6860BP', 'OV-GW-002', '2021-03-15', '2026-03-15', 180, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'Deep Fryer 1', 'Fryer', 'Pitco', 'SG14S', 'FR-GW-003', '2021-03-15', '2025-03-15', 60, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'Deep Fryer 2', 'Fryer', 'Pitco', 'SG14S', 'FR-GW-004', '2021-03-15', '2025-03-15', 60, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'Cool Room', 'Cool Room', 'Skope', 'TCF1500N-A', 'CR-GW-005', '2021-03-15', '2026-03-15', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'Freezer', 'Freezer', 'Skope', 'TMF1500N-A', 'FZ-GW-006', '2021-03-15', '2026-03-15', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'POS Terminal', 'POS Terminal', 'Lightspeed', 'iPad POS', 'POS-GW-007', '2021-06-01', '2024-06-01', 365, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'HVAC Unit', 'HVAC', 'Daikin', 'FTXS50LVMA', 'HV-GW-008', '2021-03-15', '2026-03-15', 180, 'operational'),
  ('aaa00000-0000-0000-0000-000000000001', 'Exhaust Hood', 'Exhaust', 'Stoddart', 'MEH-1500', 'EX-GW-009', '2021-03-15', null, 60, 'operational')
on conflict do nothing;

-- Torquay assets
insert into public.assets (restaurant_id, name, category, make, model, serial_number, install_date, warranty_expiry, service_interval_days, status)
values
  ('aaa00000-0000-0000-0000-000000000002', 'Rotisserie Oven 1', 'Rotisserie', 'Rotisol', 'Grand Star GS 1503 E', 'RS-TQ-001', '2022-05-10', '2027-05-10', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'Backup Oven', 'Oven', 'Miele', 'H6860BP', 'OV-TQ-002', '2022-05-10', '2027-05-10', 180, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'Deep Fryer 1', 'Fryer', 'Pitco', 'SG14S', 'FR-TQ-003', '2022-05-10', '2026-05-10', 60, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'Deep Fryer 2', 'Fryer', 'Pitco', 'SG14S', 'FR-TQ-004', '2022-05-10', '2026-05-10', 60, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'Cool Room', 'Cool Room', 'Skope', 'TCF1500N-A', 'CR-TQ-005', '2022-05-10', '2027-05-10', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'Freezer', 'Freezer', 'Skope', 'TMF1500N-A', 'FZ-TQ-006', '2022-05-10', '2027-05-10', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'POS Terminal', 'POS Terminal', 'Lightspeed', 'iPad POS', 'POS-TQ-007', '2022-08-01', '2025-08-01', 365, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'HVAC Unit', 'HVAC', 'Daikin', 'FTXS50LVMA', 'HV-TQ-008', '2022-05-10', '2027-05-10', 180, 'operational'),
  ('aaa00000-0000-0000-0000-000000000002', 'Exhaust Hood', 'Exhaust', 'Stoddart', 'MEH-1500', 'EX-TQ-009', '2022-05-10', null, 60, 'operational')
on conflict do nothing;

-- GMHBA assets
insert into public.assets (restaurant_id, name, category, make, model, serial_number, install_date, warranty_expiry, service_interval_days, status)
values
  ('aaa00000-0000-0000-0000-000000000003', 'Rotisserie Oven 1', 'Rotisserie', 'Rotisol', 'Grand Star GS 1503 E', 'RS-GM-001', '2023-01-20', '2028-01-20', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'Backup Oven', 'Oven', 'Miele', 'H6860BP', 'OV-GM-002', '2023-01-20', '2028-01-20', 180, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'Deep Fryer 1', 'Fryer', 'Pitco', 'SG14S', 'FR-GM-003', '2023-01-20', '2027-01-20', 60, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'Deep Fryer 2', 'Fryer', 'Pitco', 'SG14S', 'FR-GM-004', '2023-01-20', '2027-01-20', 60, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'Cool Room', 'Cool Room', 'Skope', 'TCF1500N-A', 'CR-GM-005', '2023-01-20', '2028-01-20', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'Freezer', 'Freezer', 'Skope', 'TMF1500N-A', 'FZ-GM-006', '2023-01-20', '2028-01-20', 90, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'POS Terminal', 'POS Terminal', 'Square', 'Square Terminal', 'POS-GM-007', '2023-04-01', '2026-04-01', 365, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'HVAC Unit', 'HVAC', 'Daikin', 'FTXS50LVMA', 'HV-GM-008', '2023-01-20', '2028-01-20', 180, 'operational'),
  ('aaa00000-0000-0000-0000-000000000003', 'Exhaust Hood', 'Exhaust', 'Stoddart', 'MEH-1500', 'EX-GM-009', '2023-01-20', null, 60, 'operational')
on conflict do nothing;


-- ============================================================================
-- END OF MIGRATION 006
-- ============================================================================
