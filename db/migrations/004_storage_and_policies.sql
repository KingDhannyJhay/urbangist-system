-- ============================================================
-- UrbanGist — Supplementary SQL
-- Run AFTER schema.sql in Supabase SQL Editor
-- ============================================================

-- ── 1. increment_track_stat RPC ──────────────────────────────────────────
-- Used by /api/track-events to safely increment counters without race conditions
CREATE OR REPLACE FUNCTION increment_track_stat(
  p_track_id UUID,
  p_field    TEXT
) RETURNS VOID AS $$
BEGIN
  IF p_field = 'play_count' THEN
    UPDATE tracks SET play_count  = play_count  + 1 WHERE id = p_track_id;
  ELSIF p_field = 'share_count' THEN
    UPDATE tracks SET share_count = share_count + 1 WHERE id = p_track_id;
  ELSIF p_field = 'like_count' THEN
    UPDATE tracks SET like_count  = like_count  + 1 WHERE id = p_track_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. increment_article_view RPC ────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_article_view(
  p_article_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE articles SET view_count = view_count + 1 WHERE id = p_article_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. Like count sync trigger ───────────────────────────────────────────
-- Keeps tracks.like_count in sync with the likes table
CREATE OR REPLACE FUNCTION sync_like_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tracks SET like_count = like_count + 1 WHERE id = NEW.track_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tracks SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.track_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_like_count ON likes;
CREATE TRIGGER trg_sync_like_count
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION sync_like_count();

-- ── 4. Storage bucket policies ───────────────────────────────────────────
-- Run these manually in Supabase Dashboard → Storage → Policies
-- OR via the CLI: supabase storage policies apply

-- Track covers bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'track-covers', 'track-covers', true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
) ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Track audio bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'track-audio', 'track-audio', true,
  52428800, -- 50 MB
  ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/flac','audio/aac','audio/ogg','audio/webm','audio/mp4']
) ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Article images bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'article-images', 'article-images', true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']
) ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit;

-- Storage RLS policies
CREATE POLICY "Public read: track-covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'track-covers');

CREATE POLICY "Auth upload: track-covers"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'track-covers' AND auth.role() = 'authenticated');

CREATE POLICY "Owner delete: track-covers"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'track-covers' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Public read: track-audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'track-audio');

CREATE POLICY "Auth upload: track-audio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'track-audio' AND auth.role() = 'authenticated');

CREATE POLICY "Owner delete: track-audio"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'track-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Public read: article-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'article-images');

CREATE POLICY "Admin upload: article-images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'article-images' AND
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── 5. Index additions for performance ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tracks_published_at  ON tracks(published_at DESC)  WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_tracks_share_count   ON tracks(share_count  DESC)  WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_promotions_end_active ON promotions(end_date)      WHERE status = 'active';

-- ── 6. Full-text search index ─────────────────────────────────────────────
ALTER TABLE tracks    ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE profiles  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE tracks SET search_vector =
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(genre,'') || ' ' || coalesce(description,''));

UPDATE profiles SET search_vector =
  to_tsvector('english', coalesce(display_name,'') || ' ' || coalesce(username,'') || ' ' || coalesce(bio,''));

CREATE INDEX IF NOT EXISTS idx_tracks_search   ON tracks   USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_profiles_search ON profiles USING GIN(search_vector);

-- Trigger to keep FTS index updated
CREATE OR REPLACE FUNCTION update_track_search_vector() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title,'') || ' ' || coalesce(NEW.genre,'') || ' ' || coalesce(NEW.description,''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_track_search ON tracks;
CREATE TRIGGER trg_track_search
  BEFORE INSERT OR UPDATE OF title, genre, description ON tracks
  FOR EACH ROW EXECUTE FUNCTION update_track_search_vector();
