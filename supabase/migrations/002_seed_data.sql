-- =============================================================
-- SEED DATA — The Coop (Pollo Rotisserie)
-- Run this after 001_initial_schema.sql
-- NOTE: Auth users must be created separately via Supabase Auth
--       admin via the dashboard. This seeds restaurants, store
--       profiles, suppliers, and quick links.
-- =============================================================

-- Using fixed UUIDs so they can be referenced consistently
-- Geelong West : aaa00000-0000-0000-0000-000000000001
-- Torquay      : aaa00000-0000-0000-0000-000000000002
-- GMHBA        : aaa00000-0000-0000-0000-000000000003

-- ---- Restaurants ----
INSERT INTO restaurants (id, name, address, status) VALUES
  ('aaa00000-0000-0000-0000-000000000001', 'Geelong West', '173 Pakington Street, Geelong West VIC 3218', 'active'),
  ('aaa00000-0000-0000-0000-000000000002', 'Torquay',      '15 Bristol Road, Torquay VIC 3228',           'active'),
  ('aaa00000-0000-0000-0000-000000000003', 'GMHBA',        '370 Moorabool Street, South Geelong VIC 3220','active')
ON CONFLICT (id) DO NOTHING;

-- ---- Store Profiles ----
INSERT INTO store_profiles (restaurant_id, phone, trading_hours, suppliers) VALUES
(
  'aaa00000-0000-0000-0000-000000000001',
  '0418 181 834',
  '{"monday":"10:30 AM – 7:45 PM","tuesday":"10:30 AM – 7:45 PM","wednesday":"10:30 AM – 7:45 PM","thursday":"10:30 AM – 7:45 PM","friday":"10:30 AM – 7:45 PM","saturday":"10:30 AM – 7:45 PM","sunday":"10:30 AM – 7:45 PM"}'::jsonb,
  '[
    {"name":"CCA","category":"Beverages","phone":""},
    {"name":"Hepburn Beverages","category":"Beverages","phone":""},
    {"name":"PFD Food Services","category":"Food Delivery","phone":""},
    {"name":"L&H Poultry","category":"Poultry","phone":""}
  ]'::jsonb
),
(
  'aaa00000-0000-0000-0000-000000000002',
  '52 490 595',
  '{"monday":"11:00 AM – 7:45 PM","tuesday":"11:00 AM – 7:45 PM","wednesday":"11:00 AM – 7:45 PM","thursday":"11:00 AM – 7:45 PM","friday":"11:00 AM – 7:45 PM","saturday":"11:00 AM – 7:45 PM","sunday":"11:00 AM – 7:45 PM"}'::jsonb,
  '[
    {"name":"CCA","category":"Beverages","phone":""},
    {"name":"Hepburn Beverages","category":"Beverages","phone":""},
    {"name":"PFD Food Services","category":"Food Delivery","phone":""},
    {"name":"L&H Poultry","category":"Poultry","phone":""}
  ]'::jsonb
),
(
  'aaa00000-0000-0000-0000-000000000003',
  null,
  '{"notes":"Event days only — hours vary by event schedule"}'::jsonb,
  '[
    {"name":"CCA","category":"Beverages","phone":""},
    {"name":"Hepburn Beverages","category":"Beverages","phone":""},
    {"name":"PFD Food Services","category":"Food Delivery","phone":""},
    {"name":"L&H Poultry","category":"Poultry","phone":""}
  ]'::jsonb
)
ON CONFLICT (restaurant_id) DO NOTHING;

-- ---- Quick Links ----
INSERT INTO app_settings (key, value) VALUES (
  'quick_links',
  '[
    {"id":"ql-001","title":"Deputy","url":"https://once.deputy.com","icon":"Clock","role_visibility":"all","order":1},
    {"id":"ql-002","title":"Lightspeed","url":"https://pos.lightspeedhq.com","icon":"BarChart3","role_visibility":"all","order":2}
  ]'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- ---- Sample Sales Data (last 7 days, for dashboard charts) ----
INSERT INTO sales_daily (restaurant_id, date, total_sales, transaction_count, average_transaction, source)
SELECT
  r.id,
  (CURRENT_DATE - (n || ' days')::interval)::date,
  ROUND((RANDOM() * 1500 + 800)::numeric, 2),
  (RANDOM() * 80 + 40)::int,
  ROUND((RANDOM() * 15 + 20)::numeric, 2),
  'manual'
FROM restaurants r
CROSS JOIN generate_series(0, 6) AS n
ON CONFLICT (restaurant_id, date) DO NOTHING;

-- ---- Sample Labour Data (last 7 days, for dashboard charts) ----
INSERT INTO labour_daily (restaurant_id, date, total_hours, total_cost, labour_percent, source)
SELECT
  sd.restaurant_id,
  sd.date,
  ROUND((sd.total_sales * 0.28 / 28)::numeric, 1),
  ROUND((sd.total_sales * 0.28)::numeric, 2),
  ROUND((25 + RANDOM() * 10)::numeric, 1),
  'manual'
FROM sales_daily sd
ON CONFLICT DO NOTHING;
