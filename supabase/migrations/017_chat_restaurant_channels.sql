-- Migration 017 — Seed one chat channel per existing restaurant
--               + trigger to auto-create for new restaurants

-- Drop the partial index created in 016 and replace with a proper unique constraint
-- (partial indexes don't work with ON CONFLICT)
DROP INDEX IF EXISTS public.idx_chat_channels_restaurant;
ALTER TABLE public.chat_channels
  ADD CONSTRAINT IF NOT EXISTS chat_channels_restaurant_id_key UNIQUE (restaurant_id);

-- Seed channels for all existing restaurants
INSERT INTO public.chat_channels (name, restaurant_id, channel_type)
SELECT name, id, 'restaurant'
FROM public.restaurants
ON CONFLICT (restaurant_id) DO NOTHING;

-- Function: create a channel whenever a restaurant is inserted
CREATE OR REPLACE FUNCTION public.create_restaurant_chat_channel()
  RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.chat_channels (name, restaurant_id, channel_type)
  VALUES (NEW.name, NEW.id, 'restaurant')
  ON CONFLICT (restaurant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger: fires after every new restaurant row
DROP TRIGGER IF EXISTS trg_restaurant_chat_channel ON public.restaurants;
CREATE TRIGGER trg_restaurant_chat_channel
  AFTER INSERT ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.create_restaurant_chat_channel();

-- Also keep channel name in sync when a restaurant is renamed
CREATE OR REPLACE FUNCTION public.sync_restaurant_chat_channel_name()
  RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.chat_channels
    SET name = NEW.name
    WHERE restaurant_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restaurant_channel_rename ON public.restaurants;
CREATE TRIGGER trg_restaurant_channel_rename
  AFTER UPDATE ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.sync_restaurant_chat_channel_name();
