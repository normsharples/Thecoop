-- 027: Add fees column to channel_payouts
-- Stores the channel/processor fees charged for each (venue, channel, date),
-- alongside the existing payout_amount (net amount deposited).
-- Currently populated for Uber Eats (Uber Fees) and Lightspeed (payout processing fees).

ALTER TABLE channel_payouts
  ADD COLUMN IF NOT EXISTS fees numeric NOT NULL DEFAULT 0;
