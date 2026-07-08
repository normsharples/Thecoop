-- Migration 016 — Internal chat

-- ── Channels ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_channels (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text        NOT NULL,
  description   text,
  restaurant_id uuid        REFERENCES public.restaurants(id) ON DELETE CASCADE,
  channel_type  text        NOT NULL DEFAULT 'restaurant'
    CHECK (channel_type IN ('restaurant', 'global')),
  created_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One channel per restaurant max (NULL values are treated as distinct, so multiple global channels are fine)
ALTER TABLE public.chat_channels
  ADD CONSTRAINT chat_channels_restaurant_id_key UNIQUE (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_chat_channels_type
  ON public.chat_channels(channel_type);

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_channels_select" ON public.chat_channels
  FOR SELECT USING (
    auth.uid() IS NOT NULL AND (
      restaurant_id IS NULL OR public.has_restaurant_access(restaurant_id)
    )
  );

CREATE POLICY "chat_channels_insert" ON public.chat_channels
  FOR INSERT WITH CHECK (
    (restaurant_id IS NULL AND public.is_superadmin())
    OR (restaurant_id IS NOT NULL AND public.has_restaurant_access(restaurant_id))
  );

CREATE POLICY "chat_channels_update" ON public.chat_channels
  FOR UPDATE USING (public.is_superadmin());

CREATE POLICY "chat_channels_delete" ON public.chat_channels
  FOR DELETE USING (public.is_superadmin());

-- ── Messages ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id uuid        NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
  ON public.chat_messages(channel_id, created_at DESC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_select" ON public.chat_messages
  FOR SELECT USING (
    auth.uid() IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.chat_channels c
      WHERE c.id = channel_id
        AND (c.restaurant_id IS NULL OR public.has_restaurant_access(c.restaurant_id))
    )
  );

CREATE POLICY "chat_messages_insert" ON public.chat_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.chat_channels c
      WHERE c.id = channel_id
        AND (c.restaurant_id IS NULL OR public.has_restaurant_access(c.restaurant_id))
    )
  );

CREATE POLICY "chat_messages_delete" ON public.chat_messages
  FOR DELETE USING (public.is_superadmin() OR sender_id = auth.uid());

-- ── Enable Realtime ───────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- ── Seed: General channel ─────────────────────────────────────────────────────

INSERT INTO public.chat_channels (name, description, channel_type, restaurant_id)
VALUES ('General', 'Company-wide updates and discussions', 'global', NULL)
ON CONFLICT DO NOTHING;
