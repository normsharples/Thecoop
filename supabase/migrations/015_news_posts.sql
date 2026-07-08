-- Migration 015 — News feed posts

CREATE TABLE IF NOT EXISTS public.news_posts (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         text        NOT NULL,
  body          text        NOT NULL,
  post_type     text        NOT NULL DEFAULT 'update'
    CHECK (post_type IN ('announcement', 'update', 'promotion', 'recognition', 'training', 'tip')),
  restaurant_id uuid        REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pinned        boolean     NOT NULL DEFAULT false,
  created_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_posts_restaurant ON public.news_posts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_news_posts_created_at ON public.news_posts(created_at DESC);

ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;

-- Any authenticated user who has access to the restaurant can read
CREATE POLICY "news_posts_select" ON public.news_posts
  FOR SELECT USING (
    auth.uid() IS NOT NULL AND (
      restaurant_id IS NULL OR public.has_restaurant_access(restaurant_id)
    )
  );

-- Global posts: superadmin only. Restaurant posts: has_restaurant_access
CREATE POLICY "news_posts_insert" ON public.news_posts
  FOR INSERT WITH CHECK (
    (restaurant_id IS NULL AND public.is_superadmin())
    OR (restaurant_id IS NOT NULL AND public.has_restaurant_access(restaurant_id))
  );

-- Superadmin or post author can edit
CREATE POLICY "news_posts_update" ON public.news_posts
  FOR UPDATE USING (public.is_superadmin() OR created_by = auth.uid());

-- Superadmin or post author can delete
CREATE POLICY "news_posts_delete" ON public.news_posts
  FOR DELETE USING (public.is_superadmin() OR created_by = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_news_posts_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER news_posts_updated_at
  BEFORE UPDATE ON public.news_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_news_posts_updated_at();
