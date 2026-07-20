-- 026: Channel Payouts table
-- Tracks daily payout amounts from delivery/online channels (Uber Eats, DoorDash, Bite)

CREATE TABLE IF NOT EXISTS channel_payouts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  venue text NOT NULL,
  channel text NOT NULL,
  date date NOT NULL,
  payout_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_payouts_venue_channel_date_key UNIQUE (venue, channel, date)
);

-- RLS: allow authenticated users to read
ALTER TABLE channel_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read channel_payouts"
  ON channel_payouts FOR SELECT
  TO authenticated
  USING (true);

-- Service role can insert/update (used by the scheduled scraper)
CREATE POLICY "Service role can manage channel_payouts"
  ON channel_payouts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
