ALTER TABLE app_public.schedule_channels
  ADD COLUMN IF NOT EXISTS display_title TEXT;
