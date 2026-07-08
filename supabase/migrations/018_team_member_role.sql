-- Migration 018 — Add team_member role
-- Team members can only access Chat and News Feed.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('superadmin', 'area_manager', 'manager', 'team_member'));
