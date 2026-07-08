-- ============================================================================
-- The Coop - Phase 4: Operational Modules
-- Migration 006 — Checklists, Food Cost, Wastage, Maintenance, Cash, Catering
-- ============================================================================

-- ============================================================================
-- 1. EXTEND MAINTENANCE REQUESTS
--    Add resolution_notes column required on resolve
-- ============================================================================

alter table public.maintenance_requests
  add column if not exists resolution_notes text;

-- ============================================================================
-- 2. EXTEND CASH DEPOSITS
--    Add photo_url (required deposit slip photo)
--    Add flagged / flag_reason for superadmin flagging
-- ============================================================================

alter table public.cash_deposits
  add column if not exists photo_url text,
  add column if not exists flagged boolean not null default false,
  add column if not exists flag_reason text;

-- ============================================================================
-- 3. EXTEND STOCK COUNTS
--    Add approved_by / approved_at for approval flow
-- ============================================================================

alter table public.stock_counts
  add column if not exists approved_by uuid references public.profiles on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists opening_stock_count_id uuid references public.stock_counts on delete set null;

-- ============================================================================
-- 4. EXTEND STOCK COUNT LINES
--    Add opening_quantity (auto-filled from previous count's closing stock)
--    and purchase_quantity for usage calc
-- ============================================================================

alter table public.stock_count_lines
  add column if not exists opening_quantity numeric not null default 0,
  add column if not exists purchase_quantity numeric not null default 0,
  add column if not exists usage_quantity numeric generated always as
    (opening_quantity + purchase_quantity - quantity) stored;

-- ============================================================================
-- 5. EXTEND WASTE LOGS
--    Add photo_url (optional)
--    Add food_cost_item_id for auto-cost calculation
-- ============================================================================

alter table public.waste_logs
  add column if not exists photo_url text,
  add column if not exists food_cost_item_id uuid references public.food_cost_items on delete set null;

-- ============================================================================
-- 6. EXTEND CHECKLIST COMPLETIONS
--    Add completed_on_time for compliance calculations
-- ============================================================================

alter table public.checklist_completions
  add column if not exists completed_on_time boolean not null default true;

-- ============================================================================
-- 7. EXTEND CATERING ORDERS
--    Add calendar_event_id for back-linking to created calendar event
-- ============================================================================

alter table public.catering_orders
  add column if not exists calendar_event_id uuid references public.calendar_events on delete set null,
  add column if not exists prep_event_id uuid references public.calendar_events on delete set null;

-- ============================================================================
-- 8. EXTEND ASSETS
--    Add photo_url for asset photo
-- ============================================================================

alter table public.assets
  add column if not exists photo_url text;

-- ============================================================================
-- 9. SEED FOOD COST ITEMS (chicken shop items)
-- ============================================================================

insert into public.food_cost_items (name, category, unit, cost_per_unit, supplier) values
  -- Proteins
  ('Whole Chicken', 'Proteins', 'kg', 6.50, 'Ingham''s'),
  ('Chicken Thigh Fillet', 'Proteins', 'kg', 8.20, 'Ingham''s'),
  ('Chicken Breast', 'Proteins', 'kg', 9.80, 'Ingham''s'),
  ('Chicken Wings', 'Proteins', 'kg', 5.40, 'Ingham''s'),
  ('Chicken Tenders', 'Proteins', 'kg', 10.50, 'Ingham''s'),
  ('Chicken Drumsticks', 'Proteins', 'kg', 4.90, 'Ingham''s'),
  -- Sides
  ('Potatoes (Chips)', 'Sides', 'kg', 1.20, 'Fresh State Produce'),
  ('Coleslaw Mix', 'Sides', 'kg', 2.80, 'Fresh State Produce'),
  ('Corn Cobs', 'Sides', 'each', 0.85, 'Fresh State Produce'),
  ('Dinner Rolls', 'Bakery', 'each', 0.45, 'Tip Top Bakeries'),
  ('Burger Buns', 'Bakery', 'each', 0.55, 'Tip Top Bakeries'),
  ('Pita Bread', 'Bakery', 'each', 0.40, 'Tip Top Bakeries'),
  -- Sauces & Condiments
  ('Gravy Mix', 'Sauces', 'kg', 4.20, 'Riviana'),
  ('Garlic Sauce', 'Sauces', 'litre', 5.50, 'Riviana'),
  ('Sweet Chilli Sauce', 'Sauces', 'litre', 4.80, 'Riviana'),
  ('BBQ Sauce', 'Sauces', 'litre', 3.90, 'Riviana'),
  ('Aioli', 'Sauces', 'litre', 6.20, 'Riviana'),
  ('Lemon Pepper Seasoning', 'Seasonings', 'kg', 12.50, 'Masterfoods'),
  ('Portuguese Seasoning', 'Seasonings', 'kg', 14.80, 'Masterfoods'),
  ('Salt', 'Seasonings', 'kg', 1.10, 'Coles Wholesale'),
  -- Packaging
  ('Chicken Boxes (Large)', 'Packaging', 'each', 0.32, 'Detpak'),
  ('Chicken Boxes (Small)', 'Packaging', 'each', 0.22, 'Detpak'),
  ('Chips Containers', 'Packaging', 'each', 0.18, 'Detpak'),
  ('Paper Bags', 'Packaging', 'each', 0.08, 'Detpak'),
  ('Foil Wrap', 'Packaging', 'sqm', 0.12, 'Detpak'),
  -- Beverages
  ('Soft Drink Cups (L)', 'Beverages', 'each', 0.15, 'Coca-Cola Amatil'),
  ('Soft Drink Cups (M)', 'Beverages', 'each', 0.12, 'Coca-Cola Amatil'),
  ('Juice Bottles', 'Beverages', 'each', 1.80, 'Nudie Foods'),
  -- Dairy
  ('Butter', 'Dairy', 'kg', 8.50, 'Mainland'),
  ('Sour Cream', 'Dairy', 'kg', 7.20, 'Bulla'),
  -- Produce
  ('Lettuce', 'Produce', 'each', 2.20, 'Fresh State Produce'),
  ('Tomatoes', 'Produce', 'kg', 4.50, 'Fresh State Produce'),
  ('Onions', 'Produce', 'kg', 1.80, 'Fresh State Produce'),
  ('Lemon', 'Produce', 'each', 0.60, 'Fresh State Produce'),
  -- Cleaning
  ('Cooking Oil', 'Oils', 'litre', 3.20, 'Sunola')
on conflict do nothing;


-- ============================================================================
-- 10. SEED DEFAULT CHECKLIST TEMPLATES
--     5 templates: Morning Opening, Night Closing, Food Safety, Equipment Check, End of Week
-- ============================================================================

-- We need a superadmin profile ID for created_by.
-- Use a placeholder DO block that inserts only if no templates exist.
do $$
declare
  v_admin_id uuid;
begin
  -- Get first superadmin profile
  select id into v_admin_id from public.profiles where role = 'superadmin' limit 1;

  if not exists (select 1 from public.checklist_templates limit 1) then

    insert into public.checklist_templates (name, description, checklist_type, items, created_by) values

    -- Template 1: Morning Opening
    ('Morning Opening', 'Complete before opening to customers', 'opening',
    '[
      {"id":"mo1","label":"Unlock doors and disable alarm","type":"checkbox","required":true},
      {"id":"mo2","label":"Turn on all cooking equipment","type":"checkbox","required":true},
      {"id":"mo3","label":"Check fridge temperatures (must be ≤4°C)","type":"temperature","required":true,"min_temp":0,"max_temp":4},
      {"id":"mo4","label":"Check freezer temperature (must be ≤-18°C)","type":"temperature","required":true,"min_temp":-25,"max_temp":-18},
      {"id":"mo5","label":"Date-label all prep items","type":"checkbox","required":true},
      {"id":"mo6","label":"Check and replenish sauces/condiments","type":"checkbox","required":true},
      {"id":"mo7","label":"Clean and sanitise all food prep surfaces","type":"checkbox","required":true},
      {"id":"mo8","label":"Photograph clean prep area","type":"photo_required","required":false},
      {"id":"mo9","label":"Check oil level and quality in fryer","type":"checkbox","required":true},
      {"id":"mo10","label":"Note any items needed for today","type":"text_note","required":false}
    ]'::jsonb, v_admin_id),

    -- Template 2: Night Closing
    ('Night Closing', 'Complete after last customer and before locking up', 'closing',
    '[
      {"id":"nc1","label":"Clean and sanitise all cooking surfaces and equipment","type":"checkbox","required":true},
      {"id":"nc2","label":"Empty and clean fryer baskets","type":"checkbox","required":true},
      {"id":"nc3","label":"Store all food items properly labelled with date","type":"checkbox","required":true},
      {"id":"nc4","label":"Check fridge seals and temperatures","type":"temperature","required":true,"min_temp":0,"max_temp":4},
      {"id":"nc5","label":"Clean floors, counters, and all public areas","type":"checkbox","required":true},
      {"id":"nc6","label":"Empty all bins and replace liners","type":"checkbox","required":true},
      {"id":"nc7","label":"Turn off all non-essential equipment","type":"checkbox","required":true},
      {"id":"nc8","label":"Photograph clean kitchen close","type":"photo_required","required":false},
      {"id":"nc9","label":"Lock cash and secure safe","type":"checkbox","required":true},
      {"id":"nc10","label":"Set alarm and lock doors","type":"checkbox","required":true},
      {"id":"nc11","label":"End of night notes","type":"text_note","required":false}
    ]'::jsonb, v_admin_id),

    -- Template 3: Food Safety Check
    ('Food Safety Check', 'Daily food safety compliance check', 'custom',
    '[
      {"id":"fs1","label":"Walk-in fridge temperature (≤4°C)","type":"temperature","required":true,"min_temp":0,"max_temp":4},
      {"id":"fs2","label":"Freezer temperature (≤-18°C)","type":"temperature","required":true,"min_temp":-25,"max_temp":-18},
      {"id":"fs3","label":"Hot holding temperature (≥60°C)","type":"temperature","required":true,"min_temp":60,"max_temp":100},
      {"id":"fs4","label":"All food items within use-by dates","type":"checkbox","required":true},
      {"id":"fs5","label":"FIFO (First In First Out) being observed","type":"checkbox","required":true},
      {"id":"fs6","label":"No cross-contamination risks","type":"checkbox","required":true},
      {"id":"fs7","label":"Handwashing station stocked","type":"checkbox","required":true},
      {"id":"fs8","label":"Food safety log photo","type":"photo_required","required":false},
      {"id":"fs9","label":"Any food safety issues to note","type":"text_note","required":false}
    ]'::jsonb, v_admin_id),

    -- Template 4: Equipment Check
    ('Equipment Check', 'Weekly equipment status and maintenance check', 'custom',
    '[
      {"id":"eq1","label":"Rotisserie oven operating correctly","type":"checkbox","required":true},
      {"id":"eq2","label":"Fryer oil condition acceptable","type":"checkbox","required":true},
      {"id":"eq3","label":"Refrigeration units running properly","type":"checkbox","required":true},
      {"id":"eq4","label":"POS system functioning","type":"checkbox","required":true},
      {"id":"eq5","label":"All lights and signage working","type":"checkbox","required":true},
      {"id":"eq6","label":"Exhaust fans and ventilation clear","type":"checkbox","required":true},
      {"id":"eq7","label":"Fire extinguisher accessible and in date","type":"checkbox","required":true},
      {"id":"eq8","label":"Equipment condition photo","type":"photo_required","required":false},
      {"id":"eq9","label":"Maintenance issues to report","type":"text_note","required":false}
    ]'::jsonb, v_admin_id),

    -- Template 5: End of Week
    ('End of Week', 'Weekly deep clean and compliance review', 'closing',
    '[
      {"id":"ew1","label":"Deep clean all cooking equipment","type":"checkbox","required":true},
      {"id":"ew2","label":"Clean and degrease range hood filters","type":"checkbox","required":true},
      {"id":"ew3","label":"Clean fridge coils and seals","type":"checkbox","required":true},
      {"id":"ew4","label":"Defrost and clean freezer (if required)","type":"checkbox","required":false},
      {"id":"ew5","label":"Deep clean floors including under equipment","type":"checkbox","required":true},
      {"id":"ew6","label":"Restock all supplies for next week","type":"checkbox","required":true},
      {"id":"ew7","label":"Review and dispose of expired items","type":"checkbox","required":true},
      {"id":"ew8","label":"Test fire safety equipment","type":"checkbox","required":true},
      {"id":"ew9","label":"Kitchen deep clean photo","type":"photo_required","required":false},
      {"id":"ew10","label":"Weekly notes / issues to report","type":"text_note","required":false}
    ]'::jsonb, v_admin_id);

  end if;
end $$;


-- ============================================================================
-- 11. SEED ASSETS PER RESTAURANT
--     Seed realistic assets for each active restaurant
-- ============================================================================

do $$
declare
  r record;
begin
  for r in select id from public.restaurants where status in ('active', 'grace_period') loop
    if not exists (select 1 from public.assets where restaurant_id = r.id limit 1) then

      insert into public.assets (restaurant_id, name, category, make, model, serial_number, purchase_date, warranty_expiry, status, notes) values
        (r.id, 'Rotisserie Oven #1', 'Cooking Equipment', 'Houno', 'PassTwo', 'HO-2021-001', '2021-03-15', '2024-03-15', 'operational', 'Main production oven'),
        (r.id, 'Rotisserie Oven #2', 'Cooking Equipment', 'Houno', 'PassTwo', 'HO-2021-002', '2021-03-15', '2024-03-15', 'operational', 'Backup / overflow oven'),
        (r.id, 'Commercial Fryer #1', 'Cooking Equipment', 'Frymaster', 'MJ35', 'FM-2020-001', '2020-06-01', '2023-06-01', 'operational', null),
        (r.id, 'Commercial Fryer #2', 'Cooking Equipment', 'Frymaster', 'MJ35', 'FM-2020-002', '2020-06-01', '2023-06-01', 'operational', null),
        (r.id, 'Walk-in Refrigerator', 'Refrigeration', 'Skope', 'ActiveCore', 'SK-2019-001', '2019-08-20', '2022-08-20', 'operational', 'Set to 2°C'),
        (r.id, 'Chest Freezer', 'Refrigeration', 'Hoshizaki', 'F-300B', 'HO-2020-001', '2020-01-10', '2023-01-10', 'operational', 'Set to -20°C'),
        (r.id, 'Under-counter Fridge', 'Refrigeration', 'Skope', 'TB Series', 'SK-2021-002', '2021-05-01', '2024-05-01', 'operational', 'Prep station'),
        (r.id, 'POS Terminal #1', 'IT Equipment', 'Lightspeed', 'K Series', 'LS-2022-001', '2022-02-15', '2025-02-15', 'operational', 'Counter 1'),
        (r.id, 'POS Terminal #2', 'IT Equipment', 'Lightspeed', 'K Series', 'LS-2022-002', '2022-02-15', '2025-02-15', 'operational', 'Counter 2'),
        (r.id, 'EFTPOS Terminal #1', 'IT Equipment', 'Tyro', 'T2', 'TY-2022-001', '2022-02-15', '2025-02-15', 'operational', null),
        (r.id, 'EFTPOS Terminal #2', 'IT Equipment', 'Tyro', 'T2', 'TY-2022-002', '2022-02-15', '2025-02-15', 'operational', null),
        (r.id, 'Commercial Exhaust Fan', 'Ventilation', 'Fantech', 'SP150', 'FT-2019-001', '2019-08-20', '2022-08-20', 'operational', null),
        (r.id, 'Grease Trap', 'Plumbing', null, null, null, '2019-08-20', null, 'operational', 'Clean every 3 months'),
        (r.id, 'CCTV System', 'Security', 'Hikvision', '8CH NVR', 'HK-2021-001', '2021-01-15', '2024-01-15', 'operational', '8 cameras, 30 day retention'),
        (r.id, 'Fire Suppression System', 'Safety', 'Kidde', 'Xtinguish', 'KD-2020-001', '2020-08-20', '2023-08-20', 'operational', 'Service annually - last: Aug 2023'),
        (r.id, 'Bain Marie / Hot Hold', 'Cooking Equipment', 'Roband', 'HC1800ST', 'RB-2021-001', '2021-03-15', '2024-03-15', 'operational', null),
        (r.id, 'Food Prep Table', 'Furniture', 'Stoddart', 'Custom SS', null, '2019-08-20', null, 'operational', 'Stainless steel 2400mm'),
        (r.id, 'Commercial Dishwasher', 'Equipment', 'Hobart', 'AM15', 'HB-2020-001', '2020-06-01', '2023-06-01', 'operational', null);

    end if;
  end loop;
end $$;


-- ============================================================================
-- 12. UPDATE APP SETTINGS — activate Phase 4 leaderboard metrics
--     Set food_cost=10, checklists=5, waste=5, reduce others proportionally
--     New weights: Sales 28.75%, Labour 22.5%, Rating 22.5%, Tx 16.75%, FC 10%, CL 5%, WC 5%
-- ============================================================================

-- NOTE: This update is intentionally NOT run automatically —
-- the admin activates metrics manually from Leaderboard settings.
-- Keeping Phase 3 weights until explicitly changed.

-- ============================================================================
-- 13. SEED ALERT CONFIGS for Phase 4
-- ============================================================================

insert into public.alert_configs (alert_type, enabled, global_threshold, recipients) values
  ('missing_checklist',   false, '{"hours_after": 2}',        '{}'),
  ('high_waste',          false, '{"pct_of_sales": 5}',       '{}'),
  ('food_cost_spike',     false, '{"pct_threshold": 35}',     '{}')
on conflict (alert_type) do nothing;
