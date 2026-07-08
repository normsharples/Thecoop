-- ============================================================================
-- The Coop - Phase 4: Operations Layer
-- Migration 006 — Storage buckets, seeds for checklists/food-cost/assets,
--                 food_cost_pct + waste_cost_pct target metrics
-- ============================================================================


-- ============================================================================
-- 1. STORAGE BUCKETS
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('checklist-photos',   'checklist-photos',   false, 5242880,  array['image/jpeg','image/png','image/webp']),
  ('waste-photos',       'waste-photos',       false, 5242880,  array['image/jpeg','image/png','image/webp']),
  ('maintenance-photos', 'maintenance-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('asset-photos',       'asset-photos',       false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('deposit-slips',      'deposit-slips',      false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- Storage RLS: any authenticated user can upload; only superadmins can delete
create policy "checklist_photos_select" on storage.objects
  for select using (bucket_id = 'checklist-photos' and auth.uid() is not null);
create policy "checklist_photos_insert" on storage.objects
  for insert with check (bucket_id = 'checklist-photos' and auth.uid() is not null);
create policy "checklist_photos_delete" on storage.objects
  for delete using (bucket_id = 'checklist-photos' and public.is_superadmin());

create policy "waste_photos_select" on storage.objects
  for select using (bucket_id = 'waste-photos' and auth.uid() is not null);
create policy "waste_photos_insert" on storage.objects
  for insert with check (bucket_id = 'waste-photos' and auth.uid() is not null);
create policy "waste_photos_delete" on storage.objects
  for delete using (bucket_id = 'waste-photos' and public.is_superadmin());

create policy "maintenance_photos_select" on storage.objects
  for select using (bucket_id = 'maintenance-photos' and auth.uid() is not null);
create policy "maintenance_photos_insert" on storage.objects
  for insert with check (bucket_id = 'maintenance-photos' and auth.uid() is not null);
create policy "maintenance_photos_delete" on storage.objects
  for delete using (bucket_id = 'maintenance-photos' and public.is_superadmin());

create policy "asset_photos_select" on storage.objects
  for select using (bucket_id = 'asset-photos' and auth.uid() is not null);
create policy "asset_photos_insert" on storage.objects
  for insert with check (bucket_id = 'asset-photos' and auth.uid() is not null);
create policy "asset_photos_delete" on storage.objects
  for delete using (bucket_id = 'asset-photos' and public.is_superadmin());

create policy "deposit_slips_select" on storage.objects
  for select using (bucket_id = 'deposit-slips' and auth.uid() is not null);
create policy "deposit_slips_insert" on storage.objects
  for insert with check (bucket_id = 'deposit-slips' and auth.uid() is not null);
create policy "deposit_slips_delete" on storage.objects
  for delete using (bucket_id = 'deposit-slips' and public.is_superadmin());


-- ============================================================================
-- 2. SEED CHECKLIST TEMPLATES (5 templates, no restaurant_id — global)
--    created_by uses a placeholder UUID; real user will own edits.
-- ============================================================================

-- Use a sentinel UUID for seeded records (avoids FK constraint issues)
-- These templates are system-level seeds with a null-safe created_by.
-- If your schema requires a real UUID, replace with an actual superadmin ID.

alter table public.checklist_templates
  alter column created_by drop not null;

insert into public.checklist_templates (name, description, checklist_type, items, created_by)
values
  (
    'Opening Checklist — Kitchen',
    'Daily kitchen opening procedure covering equipment, hygiene, and prep readiness.',
    'opening',
    '[
      {"id":"ki-01","label":"Check fridge & freezer temperatures are within safe range (≤4°C fridge, ≤-18°C freezer)","required":true},
      {"id":"ki-02","label":"Verify all equipment powers on correctly (fryers, grills, rotisserie)","required":true},
      {"id":"ki-03","label":"Sanitise all prep benches and cutting boards","required":true},
      {"id":"ki-04","label":"Check stock levels and pull thaw items from freezer as needed","required":true},
      {"id":"ki-05","label":"Replace oil in fryers if required — check colour and smell","required":false},
      {"id":"ki-06","label":"Set up sauces, condiments, and garnishes","required":true},
      {"id":"ki-07","label":"Confirm team briefed on specials and 86d items","required":false}
    ]'::jsonb,
    null
  ),
  (
    'Opening Checklist — Front of House',
    'Daily FOH opening covering cleanliness, layout, POS, and customer readiness.',
    'opening',
    '[
      {"id":"foh-01","label":"Sweep and mop floors — check for spills or hazards","required":true},
      {"id":"foh-02","label":"Wipe tables, chairs, and condiment holders","required":true},
      {"id":"foh-03","label":"Restock napkins, cutlery sets, and takeaway packaging","required":true},
      {"id":"foh-04","label":"Power on POS terminals and verify they are connected","required":true},
      {"id":"foh-05","label":"Count float — verify opening till balance","required":true},
      {"id":"foh-06","label":"Check menu boards and promotional materials are correct","required":false},
      {"id":"foh-07","label":"Unlock doors and confirm trading hours sign is visible","required":true}
    ]'::jsonb,
    null
  ),
  (
    'Closing Checklist — Kitchen',
    'End-of-day kitchen close covering food safety, cleaning, and secure shutdown.',
    'closing',
    '[
      {"id":"kc-01","label":"Break down and clean rotisserie — degrease thoroughly","required":true},
      {"id":"kc-02","label":"Drain, clean, and filter all fryers — top up oil if needed","required":true},
      {"id":"kc-03","label":"Label, cover, and date all remaining food items for cold storage","required":true},
      {"id":"kc-04","label":"Clean and sanitise all prep benches, sinks, and equipment surfaces","required":true},
      {"id":"kc-05","label":"Empty and clean bin — replace liner","required":true},
      {"id":"kc-06","label":"Sweep and mop kitchen floor","required":true},
      {"id":"kc-07","label":"Turn off all equipment and verify gas is shut off","required":true},
      {"id":"kc-08","label":"Check walk-in fridge door is sealed before leaving","required":true}
    ]'::jsonb,
    null
  ),
  (
    'Closing Checklist — Front of House',
    'End-of-day FOH close covering cash reconciliation, cleaning, and lockup.',
    'closing',
    '[
      {"id":"fc-01","label":"Count tills and complete daily cash reconciliation","required":true},
      {"id":"fc-02","label":"Wipe all tables, chairs, and surfaces","required":true},
      {"id":"fc-03","label":"Sweep and mop dining room and entrance","required":true},
      {"id":"fc-04","label":"Clean and wipe all glass and mirrors","required":false},
      {"id":"fc-05","label":"Empty and replace bin liners throughout store","required":true},
      {"id":"fc-06","label":"Power off POS terminals and secure cash drawer","required":true},
      {"id":"fc-07","label":"Prepare next-day float and place in safe","required":true},
      {"id":"fc-08","label":"Arm alarm and lock all doors — check rear exit","required":true}
    ]'::jsonb,
    null
  ),
  (
    'Weekly Deep Clean',
    'Comprehensive weekly clean covering behind equipment, cool rooms, and common areas.',
    'custom',
    '[
      {"id":"wc-01","label":"Pull out and clean behind all cooking equipment","required":true},
      {"id":"wc-02","label":"Clean cool room walls, shelves, and floor — check door seals","required":true},
      {"id":"wc-03","label":"Degrease exhaust canopy and clean filters","required":true},
      {"id":"wc-04","label":"Sanitise ice machine — drain and clean reservoir","required":false},
      {"id":"wc-05","label":"Scrub tile grout on kitchen floor","required":true},
      {"id":"wc-06","label":"Clean staff amenities — bathrooms, change rooms","required":true},
      {"id":"wc-07","label":"Wipe inside of all ovens and microwaves","required":true},
      {"id":"wc-08","label":"Check pest traps and replace if needed","required":false},
      {"id":"wc-09","label":"Record clean in maintenance log","required":true}
    ]'::jsonb,
    null
  )
on conflict do nothing;


-- ============================================================================
-- 3. SEED FOOD COST ITEMS
--    Generic items for a rotisserie chicken restaurant
-- ============================================================================

insert into public.food_cost_items (name, category, unit, cost_per_unit, supplier)
values
  -- Proteins
  ('Whole Chicken (size 14)',        'Protein',     'each',  8.50,  'Inghams'),
  ('Whole Chicken (size 16)',        'Protein',     'each',  9.80,  'Inghams'),
  ('Chicken Breast Fillet',          'Protein',     'kg',   14.00,  'Inghams'),
  ('Chicken Thigh Fillet',           'Protein',     'kg',   10.50,  'Inghams'),
  ('Chicken Wings',                  'Protein',     'kg',    6.20,  'Inghams'),
  -- Produce
  ('Potatoes (washed)',              'Produce',     'kg',    1.80,  'Freshco'),
  ('Sweet Potato',                   'Produce',     'kg',    2.50,  'Freshco'),
  ('Coleslaw Mix (pre-cut)',         'Produce',     'kg',    3.20,  'Freshco'),
  ('Baby Spinach',                   'Produce',     'kg',    6.50,  'Freshco'),
  ('Corn Cob',                       'Produce',     'each',  0.75,  'Freshco'),
  ('Lemon',                          'Produce',     'each',  0.40,  'Freshco'),
  -- Dry Goods
  ('Cooking Oil (canola, 20L)',      'Dry Goods',   'unit', 42.00,  'Bidfoods'),
  ('Chicken Seasoning Rub (5kg)',    'Dry Goods',   'unit', 38.00,  'Bidfoods'),
  ('Salt (1kg)',                     'Dry Goods',   'unit',  1.20,  'Bidfoods'),
  ('Plain Flour (12.5kg)',           'Dry Goods',   'unit', 14.50,  'Bidfoods'),
  ('Breadcrumbs (Panko, 5kg)',       'Dry Goods',   'unit', 22.00,  'Bidfoods'),
  -- Sauces & Condiments
  ('Garlic Aioli (5L)',              'Sauces',      'unit', 18.50,  'Bidfoods'),
  ('Chilli Sauce (5L)',              'Sauces',      'unit', 16.00,  'Bidfoods'),
  ('BBQ Sauce (5L)',                 'Sauces',      'unit', 15.50,  'Bidfoods'),
  ('Gravy Powder (2kg)',             'Sauces',      'unit', 12.00,  'Bidfoods'),
  -- Packaging
  ('Chicken Container (half)',       'Packaging',   'unit',  0.28,  'Detpak'),
  ('Chicken Container (whole)',      'Packaging',   'unit',  0.42,  'Detpak'),
  ('Side Container (small)',         'Packaging',   'unit',  0.15,  'Detpak'),
  ('Side Container (large)',         'Packaging',   'unit',  0.22,  'Detpak'),
  ('Paper Bag',                      'Packaging',   'unit',  0.08,  'Detpak'),
  ('Napkins (pack 500)',             'Packaging',   'unit',  4.50,  'Detpak'),
  -- Beverages
  ('Soft Drink Can (375ml)',         'Beverages',   'each',  0.90,  'Coca-Cola'),
  ('Bottled Water (600ml)',          'Beverages',   'each',  0.55,  'Coca-Cola')
on conflict do nothing;


-- ============================================================================
-- 4. SEED ASSETS (one set per active restaurant using a DO block)
-- ============================================================================

do $$
declare
  r record;
begin
  for r in select id from public.restaurants where status = 'active' loop
    insert into public.assets (restaurant_id, name, category, make, model, status, notes)
    values
      (r.id, 'Rotisserie Oven #1',      'Kitchen Equipment', 'Henny Penny',  'SCR-6',       'operational', 'Primary rotisserie. Service every 6 months.'),
      (r.id, 'Rotisserie Oven #2',      'Kitchen Equipment', 'Henny Penny',  'SCR-6',       'operational', 'Backup rotisserie.'),
      (r.id, 'Commercial Fryer #1',     'Kitchen Equipment', 'Frymaster',    'MH114SD',     'operational', null),
      (r.id, 'Commercial Fryer #2',     'Kitchen Equipment', 'Frymaster',    'MH114SD',     'operational', null),
      (r.id, 'Walk-in Cool Room',       'Refrigeration',     'Skope',        'CL-WI',       'operational', 'Check door seals monthly.'),
      (r.id, 'Upright Fridge',          'Refrigeration',     'Skope',        'ActiveCore 2','operational', null),
      (r.id, 'Chest Freezer',           'Refrigeration',     'Hisense',      'HR6CF201',    'operational', null),
      (r.id, 'POS Terminal #1',         'Technology',        'Lightspeed',   'K-Series',    'operational', 'Main counter register.'),
      (r.id, 'POS Terminal #2',         'Technology',        'Lightspeed',   'K-Series',    'operational', 'Drive-through or secondary counter.'),
      (r.id, 'Exhaust Canopy',          'Ventilation',       null,           null,          'operational', 'Filter clean quarterly.'),
      (r.id, 'Commercial Dishwasher',   'Cleaning',          'Winterhalter', 'UC-L',        'operational', null),
      (r.id, 'Security Camera System',  'Security',          'Hikvision',    '8-Channel NVR','operational', null)
    on conflict do nothing;
  end loop;
end;
$$;


-- ============================================================================
-- 5. SEED BANK ACCOUNT (placeholder — restaurants will add their own)
-- ============================================================================
-- No seed needed; bank accounts are per-restaurant and set up by managers.


-- ============================================================================
-- 6. SEED APP SETTINGS — food_cost_pct and waste_cost_pct targets
--    These are stored in the targets table as metric keys (no schema change).
--    Just document the new keys here for reference.
-- ============================================================================
-- New target metric keys added in Phase 4:
--   'food_cost_pct'  — target food cost as % of net sales (e.g. 28.0)
--   'waste_cost_pct' — target waste cost as % of net sales (e.g. 3.0)
-- These are inserted via the Targets settings UI, not seeded here.


-- ============================================================================
-- 7. UPDATE LEADERBOARD WEIGHTS — activate food_cost, checklists, waste
--    Redistribution: Sales 25%, Labour 20%, Rating 20%, Tx 15%,
--                    FoodCost 10%, Checklists 5%, Waste 5%
-- ============================================================================

insert into public.app_settings (key, value) values
  ('leaderboard_weights', '{
    "sales": 25.0,
    "labour": 20.0,
    "rating": 20.0,
    "transactions": 15.0,
    "food_cost": 10.0,
    "checklists": 5.0,
    "waste": 5.0,
    "whs": 0
  }')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();


-- ============================================================================
-- 8. ADD photo_url TO CHECKLIST_COMPLETIONS (optional photo evidence)
-- ============================================================================

alter table public.checklist_completions
  add column if not exists photo_urls text[] not null default '{}';

-- ============================================================================
-- 9. ADD photo_url TO MAINTENANCE_REQUESTS
-- ============================================================================

alter table public.maintenance_requests
  add column if not exists photo_urls text[] not null default '{}';

-- ============================================================================
-- 10. ADD photo_url TO WASTE_LOGS
-- ============================================================================

alter table public.waste_logs
  add column if not exists photo_url text;

-- ============================================================================
-- 11. ADD receipt_url TO CASH_DEPOSITS
-- ============================================================================

alter table public.cash_deposits
  add column if not exists receipt_url text;
