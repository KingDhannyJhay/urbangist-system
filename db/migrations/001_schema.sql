-- ============================================================
-- UrbanGist — Production Database Schema
-- Supabase Postgres (pg 15+)
-- Run migrations in order: 001 → 002 → 003
-- ============================================================

-- ============================================================
-- MIGRATION 001 — Core tables
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for trigram text search

-- ─── PROFILES ────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users. One row per registered user.
CREATE TABLE profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT        NOT NULL UNIQUE,
  display_name  TEXT,
  bio           TEXT,
  avatar_url    TEXT,
  slug          TEXT        NOT NULL UNIQUE,
  role          TEXT        NOT NULL DEFAULT 'artist'
                            CHECK (role IN ('artist', 'admin', 'listener')),
  social_links  JSONB       NOT NULL DEFAULT '{}',
  verified      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_slug     ON profiles (slug);
CREATE INDEX idx_profiles_role     ON profiles (role);
CREATE INDEX idx_profiles_username ON profiles (username);

-- ─── TRACKS ──────────────────────────────────────────────────────────────────
-- Core music entity. status transitions:
--   pending → processing → approved | rejected
--   processing is set by worker when FFmpeg job starts
CREATE TABLE tracks (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  artist_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Metadata
  title           TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  slug            TEXT        NOT NULL UNIQUE,
  genre           TEXT        NOT NULL,
  subgenre        TEXT,
  description     TEXT        CHECK (length(description) <= 2000),
  lyrics          TEXT,
  release_date    DATE,

  -- Storage paths (Supabase Storage)
  raw_audio_path  TEXT,           -- original upload, e.g. uploads/{artist_id}/{uuid}/raw.mp3
  audio_path      TEXT,           -- processed 128kbps MP3
  preview_path    TEXT,           -- 30-second preview clip
  cover_path      TEXT,           -- cover art
  waveform_path   TEXT,           -- waveform JSON

  -- Public URLs (populated after processing)
  audio_url       TEXT,
  preview_url     TEXT,
  cover_url       TEXT,
  waveform_url    TEXT,

  -- Audio metadata (populated by worker)
  duration_sec    INTEGER         CHECK (duration_sec > 0),
  file_size_bytes BIGINT,
  audio_format    TEXT,           -- 'mp3', 'wav', 'flac', etc.
  sample_rate     INTEGER,
  bit_rate        INTEGER,

  -- Status workflow
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processing','approved','rejected','takedown')),
  rejection_note  TEXT,
  approved_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,

  -- SEO
  seo_title       TEXT,
  seo_description TEXT,

  -- Denormalised counters (updated by trigger on interactions table)
  play_count      BIGINT      NOT NULL DEFAULT 0 CHECK (play_count >= 0),
  like_count      BIGINT      NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  share_count     BIGINT      NOT NULL DEFAULT 0 CHECK (share_count >= 0),

  -- Boost state (updated when boost activates/expires)
  boost_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.00 CHECK (boost_multiplier >= 1.00),
  is_featured      BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tracks_artist_id   ON tracks (artist_id);
CREATE INDEX idx_tracks_status      ON tracks (status);
CREATE INDEX idx_tracks_genre       ON tracks (genre);
CREATE INDEX idx_tracks_published   ON tracks (published_at DESC NULLS LAST) WHERE status = 'approved';
CREATE INDEX idx_tracks_slug        ON tracks (slug);
-- Full-text search index
CREATE INDEX idx_tracks_fts ON tracks
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(genre,'') || ' ' || coalesce(description,'')));

-- ─── INTERACTIONS ─────────────────────────────────────────────────────────────
-- One row per event. Drives ranking + analytics.
-- event_type: play | like | unlike | share | download
CREATE TABLE interactions (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  track_id     UUID        NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES profiles(id) ON DELETE SET NULL,

  event_type   TEXT        NOT NULL
               CHECK (event_type IN ('play','like','unlike','share','download')),

  -- Attribution
  source       TEXT        NOT NULL DEFAULT 'direct'
               CHECK (source IN ('direct','whatsapp','instagram','tiktok','twitter','qr','embed','other')),
  ip_hash      TEXT,        -- SHA-256 of IP+salt, for dedup without storing PII
  session_id   TEXT,

  -- Play-specific
  progress_pct SMALLINT    CHECK (progress_pct BETWEEN 0 AND 100),
  completed    BOOLEAN,

  country_code CHAR(2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial indexes for common queries
CREATE INDEX idx_interactions_track_id    ON interactions (track_id);
CREATE INDEX idx_interactions_user_id     ON interactions (user_id)    WHERE user_id IS NOT NULL;
CREATE INDEX idx_interactions_event_type  ON interactions (event_type);
CREATE INDEX idx_interactions_created_at  ON interactions (created_at DESC);
CREATE INDEX idx_interactions_source      ON interactions (source);

-- Composite for analytics queries
CREATE INDEX idx_interactions_track_event ON interactions (track_id, event_type, created_at DESC);

-- ─── BOOSTS ──────────────────────────────────────────────────────────────────
-- Paid promotion records, always tied to a Paystack transaction.
CREATE TABLE boosts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  track_id         UUID        NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id        UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Plan config (denormalised from plan at time of purchase)
  plan             TEXT        NOT NULL CHECK (plan IN ('basic','standard','premium')),
  multiplier       NUMERIC(5,2) NOT NULL CHECK (multiplier >= 1.00),
  duration_hours   INTEGER     NOT NULL CHECK (duration_hours > 0),
  amount_ngn       INTEGER     NOT NULL CHECK (amount_ngn > 0),

  -- Lifecycle
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','active','expired','cancelled','refunded')),
  start_at         TIMESTAMPTZ,
  end_at           TIMESTAMPTZ,

  -- Paystack payment
  paystack_ref     TEXT        UNIQUE NOT NULL,
  paystack_txn_id  TEXT,
  paid_at          TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_boosts_track_id  ON boosts (track_id);
CREATE INDEX idx_boosts_artist_id ON boosts (artist_id);
CREATE INDEX idx_boosts_status    ON boosts (status);
CREATE INDEX idx_boosts_end_at    ON boosts (end_at) WHERE status = 'active';

-- ─── RANKING CACHE ───────────────────────────────────────────────────────────
-- Pre-computed scores. Never calculated on-request.
-- Rebuilt by ranking worker every N minutes.
CREATE TABLE ranking_cache (
  track_id        UUID        PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,

  -- Component scores (stored for debugging/transparency)
  play_score      NUMERIC(12,4) NOT NULL DEFAULT 0,
  like_score      NUMERIC(12,4) NOT NULL DEFAULT 0,
  share_score     NUMERIC(12,4) NOT NULL DEFAULT 0,
  decay_factor    NUMERIC(8,6)  NOT NULL DEFAULT 1,
  boost_factor    NUMERIC(5,2)  NOT NULL DEFAULT 1,

  -- Final score used for ordering
  final_score     NUMERIC(16,4) NOT NULL DEFAULT 0,

  -- Time windows (used for "rising" feed)
  score_24h       NUMERIC(16,4) NOT NULL DEFAULT 0,  -- activity in last 24h
  score_7d        NUMERIC(16,4) NOT NULL DEFAULT 0,  -- activity in last 7d

  -- Metadata
  computed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  rank_position   INTEGER,                            -- global rank (1 = top)
  rank_24h        INTEGER,                            -- rank by 24h score
  rank_7d         INTEGER
);

CREATE INDEX idx_ranking_cache_final   ON ranking_cache (final_score   DESC);
CREATE INDEX idx_ranking_cache_24h     ON ranking_cache (score_24h     DESC);
CREATE INDEX idx_ranking_cache_7d      ON ranking_cache (score_7d      DESC);
CREATE INDEX idx_ranking_cache_computed ON ranking_cache (computed_at  DESC);

-- ─── JOB QUEUE ───────────────────────────────────────────────────────────────
-- DB-backed job queue. Worker polls this table.
-- No Redis required for the volumes UrbanGist handles.
CREATE TABLE job_queue (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type     TEXT        NOT NULL
               CHECK (job_type IN ('process_audio','recalc_rankings','expire_boosts','cleanup_failed')),
  payload      JSONB       NOT NULL DEFAULT '{}',

  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','done','failed','dead')),

  -- Retry tracking
  attempts     SMALLINT    NOT NULL DEFAULT 0,
  max_attempts SMALLINT    NOT NULL DEFAULT 3,
  last_error   TEXT,

  -- Scheduling
  run_after    TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- delayed execution support
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_queue_pending  ON job_queue (run_after ASC) WHERE status = 'pending';
CREATE INDEX idx_job_queue_running  ON job_queue (started_at)    WHERE status = 'running';
CREATE INDEX idx_job_queue_type     ON job_queue (job_type, status);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  body       TEXT,
  link       TEXT,
  read       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read, created_at DESC);

-- ─── ARTICLES ────────────────────────────────────────────────────────────────
CREATE TABLE articles (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  slug            TEXT        NOT NULL UNIQUE,
  excerpt         TEXT,
  content         TEXT        NOT NULL,
  cover_url       TEXT,
  category        TEXT        NOT NULL DEFAULT 'guide'
                  CHECK (category IN ('guide','platform','industry','news','tutorial')),
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','archived')),
  featured        BOOLEAN     NOT NULL DEFAULT FALSE,
  seo_title       TEXT,
  seo_description TEXT,
  view_count      BIGINT      NOT NULL DEFAULT 0,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_articles_status    ON articles (status, published_at DESC);
CREATE INDEX idx_articles_slug      ON articles (slug);
CREATE INDEX idx_articles_category  ON articles (category);

-- ============================================================
-- MIGRATION 002 — Functions, triggers, and RLS
-- ============================================================

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DO $$ DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','tracks','boosts','articles','job_queue'] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ─── Auto-create profile on signup ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter    INT := 0;
BEGIN
  base_slug  := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]', '-', 'g'));
  final_slug := base_slug;

  WHILE EXISTS (SELECT 1 FROM profiles WHERE slug = final_slug) LOOP
    counter    := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;

  INSERT INTO profiles (id, username, slug, display_name)
  VALUES (
    NEW.id,
    final_slug,
    final_slug,
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── Interaction counter sync ─────────────────────────────────────────────────
-- Keeps tracks.play_count / like_count / share_count accurate.
-- Only increments — no decrement except for unlike.
CREATE OR REPLACE FUNCTION sync_interaction_counters()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.event_type = 'play' THEN
      UPDATE tracks SET play_count = play_count + 1 WHERE id = NEW.track_id;
    ELSIF NEW.event_type = 'like' THEN
      UPDATE tracks SET like_count = like_count + 1 WHERE id = NEW.track_id;
    ELSIF NEW.event_type = 'share' THEN
      UPDATE tracks SET share_count = share_count + 1 WHERE id = NEW.track_id;
    ELSIF NEW.event_type = 'unlike' THEN
      UPDATE tracks SET like_count = GREATEST(0, like_count - 1) WHERE id = NEW.track_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_interaction_counters
  AFTER INSERT ON interactions
  FOR EACH ROW EXECUTE FUNCTION sync_interaction_counters();

-- ─── Enqueue audio processing job after upload ────────────────────────────────
-- When a track is inserted with raw_audio_path set, create a processing job.
CREATE OR REPLACE FUNCTION enqueue_audio_processing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw_audio_path IS NOT NULL AND NEW.status = 'pending' THEN
    INSERT INTO job_queue (job_type, payload)
    VALUES ('process_audio', jsonb_build_object('track_id', NEW.id, 'raw_audio_path', NEW.raw_audio_path));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enqueue_on_upload
  AFTER INSERT ON tracks
  FOR EACH ROW EXECUTE FUNCTION enqueue_audio_processing();

-- ─── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE boosts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles      ENABLE ROW LEVEL SECURITY;
-- job_queue and ranking_cache are internal tables — access via service_role only

-- Profiles
CREATE POLICY "profiles_public_read"   ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_owner_write"   ON profiles FOR UPDATE USING (auth.uid() = id);

-- Tracks (approved are public; pending/processing only to owner or admin)
CREATE POLICY "tracks_approved_public" ON tracks FOR SELECT
  USING (status = 'approved' OR auth.uid() = artist_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "tracks_owner_insert"    ON tracks FOR INSERT WITH CHECK (auth.uid() = artist_id);
CREATE POLICY "tracks_owner_update"    ON tracks FOR UPDATE USING (auth.uid() = artist_id);

-- Interactions
CREATE POLICY "interactions_public_insert" ON interactions FOR INSERT WITH CHECK (true);
CREATE POLICY "interactions_owner_select"  ON interactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM tracks t WHERE t.id = track_id AND t.artist_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Boosts
CREATE POLICY "boosts_owner"  ON boosts FOR ALL USING (auth.uid() = artist_id);
CREATE POLICY "boosts_admin"  ON boosts FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Notifications
CREATE POLICY "notifications_owner" ON notifications FOR ALL USING (auth.uid() = user_id);

-- Articles
CREATE POLICY "articles_published_public" ON articles FOR SELECT USING (status = 'published');
CREATE POLICY "articles_admin_all"        ON articles FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- MIGRATION 003 — Storage buckets and helper functions
-- ============================================================

-- ─── Increment track stat (race-condition-safe) ────────────────────────────────
CREATE OR REPLACE FUNCTION increment_stat(
  p_track_id UUID,
  p_field    TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_field = 'play_count' THEN
    UPDATE tracks SET play_count  = play_count  + 1 WHERE id = p_track_id;
  ELSIF p_field = 'like_count' THEN
    UPDATE tracks SET like_count  = like_count  + 1 WHERE id = p_track_id;
  ELSIF p_field = 'share_count' THEN
    UPDATE tracks SET share_count = share_count + 1 WHERE id = p_track_id;
  END IF;
END;
$$;

-- ─── Claim a job from queue (atomic, skiplocked) ────────────────────────────────
CREATE OR REPLACE FUNCTION claim_next_job(p_job_type TEXT DEFAULT NULL)
RETURNS SETOF job_queue LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE job_queue
  SET status = 'running', started_at = NOW(), attempts = attempts + 1
  WHERE id = (
    SELECT id FROM job_queue
    WHERE status = 'pending'
      AND run_after <= NOW()
      AND attempts < max_attempts
      AND (p_job_type IS NULL OR job_type = p_job_type)
    ORDER BY run_after ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- ─── Expire finished boosts ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_finished_boosts()
RETURNS TABLE(expired_count INT, reset_count INT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_expired INT := 0;
  v_reset   INT := 0;
BEGIN
  UPDATE boosts SET status = 'expired', updated_at = NOW()
  WHERE status = 'active' AND end_at < NOW();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  UPDATE tracks t
  SET boost_multiplier = 1.00, updated_at = NOW()
  WHERE boost_multiplier > 1.00
    AND NOT EXISTS (
      SELECT 1 FROM boosts b
      WHERE b.track_id = t.id AND b.status = 'active' AND b.end_at > NOW()
    );
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  RETURN QUERY SELECT v_expired, v_reset;
END;
$$;

-- ─── Storage bucket setup ─────────────────────────────────────────────────────
-- Run via Supabase dashboard or CLI:
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES
--   ('raw-uploads',       'raw-uploads',       false, 524288000, NULL),  -- 500MB, private
--   ('processed-audio',   'processed-audio',   true,  52428800,  ARRAY['audio/mpeg','audio/mp4']),
--   ('track-previews',    'track-previews',    true,  10485760,  ARRAY['audio/mpeg']),
--   ('track-covers',      'track-covers',      true,  5242880,   ARRAY['image/jpeg','image/png','image/webp']),
--   ('waveforms',         'waveforms',         true,  524288,    ARRAY['application/json']),
--   ('article-images',    'article-images',    true,  5242880,   ARRAY['image/jpeg','image/png','image/webp']);
