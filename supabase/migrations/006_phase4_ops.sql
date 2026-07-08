-- ============================================================================
-- The Coop - Phase 4: Operational Modules
-- Migration 006 — Add updated_at to food_cost_items & assets
--                 Seed default checklist templates
-- ============================================================================

-- ============================================================================
-- 1. ADD updated_at TO food_cost_items
-- ============================================================================

alter table public.food_cost_items
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists food_cost_items_updated_at on public.food_cost_items;

create trigger food_cost_items_updated_at
  before update on public.food_cost_items
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 2. ADD updated_at TO assets
-- ============================================================================

alter table public.assets
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists assets_updated_at on public.assets;

create trigger assets_updated_at
  before update on public.assets
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 3. ADD updated_at TO maintenance_requests
-- ============================================================================

alter table public.maintenance_requests
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists maintenance_requests_updated_at on public.maintenance_requests;

create trigger maintenance_requests_updated_at
  before update on public.maintenance_requests
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 4. ADD updated_at TO waste_logs
-- ============================================================================

alter table public.waste_logs
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists waste_logs_updated_at on public.waste_logs;

create trigger waste_logs_updated_at
  before update on public.waste_logs
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 5. ADD updated_at TO catering_orders
-- ============================================================================

alter table public.catering_orders
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists catering_orders_updated_at on public.catering_orders;

create trigger catering_orders_updated_at
  before update on public.catering_orders
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 6. ADD updated_at TO cash_deposits
-- ============================================================================

alter table public.cash_deposits
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists cash_deposits_updated_at on public.cash_deposits;

create trigger cash_deposits_updated_at
  before update on public.cash_deposits
  for each row execute function public.handle_updated_at();


-- ============================================================================
-- 7. SEED DEFAULT CHECKLIST TEMPLATES
-- ============================================================================

insert into public.checklist_templates (name, description, checklist_type, items) values
(
  'Daily Opening',
  'Standard opening procedure checklist for all stores',
  'opening',
  '[
    {"id": "o1", "label": "Unlock front door and disable alarm", "required": true},
    {"id": "o2", "label": "Check walk-in fridge and freezer temperatures", "required": true},
    {"id": "o3", "label": "Inspect food storage for expiry dates and proper labelling", "required": true},
    {"id": "o4", "label": "Check cook temperatures for overnight proofing items", "required": true},
    {"id": "o5", "label": "Turn on all cooking equipment and check operation", "required": true},
    {"id": "o6", "label": "Check stock levels and note low items", "required": true},
    {"id": "o7", "label": "Clean and sanitise food prep surfaces", "required": true},
    {"id": "o8", "label": "Check and replenish paper goods (bags, napkins, receipt paper)", "required": false},
    {"id": "o9", "label": "Test POS system and open till float", "required": true},
    {"id": "o10", "label": "Check bathrooms are clean and stocked", "required": false},
    {"id": "o11", "label": "Review staff roster and confirm team for the day", "required": false},
    {"id": "o12", "label": "Check for overnight messages or manager notes", "required": false}
  ]'::jsonb
),
(
  'Daily Closing',
  'Standard closing procedure checklist for all stores',
  'closing',
  '[
    {"id": "c1", "label": "Record daily sales and complete end-of-day POS close", "required": true},
    {"id": "c2", "label": "Count cash float and prepare bank deposit", "required": true},
    {"id": "c3", "label": "Clean and sanitise all food prep surfaces", "required": true},
    {"id": "c4", "label": "Clean rotisserie and cooking equipment", "required": true},
    {"id": "c5", "label": "Store all food correctly — label and date", "required": true},
    {"id": "c6", "label": "Check fridge/freezer temperatures and log", "required": true},
    {"id": "c7", "label": "Empty and clean fryers", "required": false},
    {"id": "c8", "label": "Mop floors and empty bins", "required": true},
    {"id": "c9", "label": "Check all equipment is turned off correctly", "required": true},
    {"id": "c10", "label": "Lock all windows and back door", "required": true},
    {"id": "c11", "label": "Set alarm and lock front door", "required": true},
    {"id": "c12", "label": "Complete manager notes / handover log", "required": false}
  ]'::jsonb
)
on conflict do nothing;


-- ============================================================================
-- 8. SEED DEFAULT FOOD COST ITEMS
-- ============================================================================

insert into public.food_cost_items (name, category, unit, cost_per_unit, supplier) values
  ('Whole Chicken (1.4–1.6kg)',  'Protein',   'each',  7.50,  'Ingham''s'),
  ('Whole Chicken (1.6–1.8kg)',  'Protein',   'each',  8.50,  'Ingham''s'),
  ('Chicken Portions (kg)',       'Protein',   'kg',    9.00,  'Ingham''s'),
  ('Rotisserie Seasoning (kg)',   'Dry Goods', 'kg',    12.00, 'Custom Blend'),
  ('Cooking Oil (L)',             'Oil',       'L',     2.80,  'Local'),
  ('Chips (frozen, kg)',          'Potato',    'kg',    3.50,  'Simplot'),
  ('Coleslaw Mix (kg)',           'Produce',   'kg',    2.20,  'Market'),
  ('Dinner Rolls (dozen)',        'Bakery',    'dozen', 4.50,  'Local Bakery'),
  ('Gravy Powder (kg)',           'Dry Goods', 'kg',    8.00,  'Edlyn'),
  ('Packaging — Whole Chicken',  'Packaging', 'each',  0.35,  'Pactiv'),
  ('Packaging — Half Chicken',   'Packaging', 'each',  0.25,  'Pactiv'),
  ('Paper Bags (pack 250)',       'Packaging', 'pack',  18.00, 'Pactiv')
on conflict do nothing;
