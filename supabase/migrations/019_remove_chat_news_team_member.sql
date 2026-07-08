-- Migration 019 — Remove Chat, News Feed, and the team_member role
-- The Chat and News Feed sections have been removed from the app, and
-- team_member was the only role restricted to those two sections.

-- ── Drop chat & news tables ───────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.chat_messages;

DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_channels CASCADE;
DROP TABLE IF EXISTS public.news_posts CASCADE;

DROP FUNCTION IF EXISTS public.create_restaurant_chat_channel() CASCADE;
DROP FUNCTION IF EXISTS public.sync_restaurant_chat_channel_name() CASCADE;
DROP FUNCTION IF EXISTS public.set_news_posts_updated_at() CASCADE;

-- ── Remove the team_member role ───────────────────────────────────────────────
-- No remaining section of the app is scoped to team_member, so downgrade any
-- existing team_member profiles to the lowest remaining role before dropping
-- the value from the check constraint.

UPDATE public.profiles
SET role = 'manager'
WHERE role = 'team_member';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('superadmin', 'area_manager', 'manager'));
