-- Google Rating Daily Snapshots
-- Tracks the overall Google rating and review count for each restaurant over time.
-- Populated by the google-reviews-sync scraper at 3 AM daily.

CREATE TABLE IF NOT EXISTS google_rating_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  rating NUMERIC(2,1) NOT NULL,
  review_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(restaurant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_google_rating_daily_restaurant_date
  ON google_rating_daily(restaurant_id, date DESC);

ALTER TABLE google_rating_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read google_rating_daily"
  ON google_rating_daily FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can insert/update google_rating_daily"
  ON google_rating_daily FOR ALL
  USING (auth.role() = 'service_role');
