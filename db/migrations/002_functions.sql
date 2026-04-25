-- ============================================================
-- UrbanGist — Migration 004: Analytics + Ranking helpers
-- Run after 001_schema.sql
-- ============================================================

-- ─── Track analytics aggregate ────────────────────────────────────────────────
-- Called by GET /interactions/analytics/:trackId
CREATE OR REPLACE FUNCTION get_track_analytics(p_track_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_plays',       COUNT(*) FILTER (WHERE event_type = 'play'),
    'total_likes',       COUNT(*) FILTER (WHERE event_type = 'like'),
    'total_shares',      COUNT(*) FILTER (WHERE event_type = 'share'),
    'total_downloads',   COUNT(*) FILTER (WHERE event_type = 'download'),
    'completed_plays',   COUNT(*) FILTER (WHERE event_type = 'play' AND completed = TRUE),
    'completion_rate',   ROUND(
      100.0 * COUNT(*) FILTER (WHERE event_type = 'play' AND completed = TRUE)
             / NULLIF(COUNT(*) FILTER (WHERE event_type = 'play'), 0),
      1
    ),
    'plays_24h',  COUNT(*) FILTER (WHERE event_type = 'play'  AND created_at >= NOW() - INTERVAL '24 hours'),
    'plays_7d',   COUNT(*) FILTER (WHERE event_type = 'play'  AND created_at >= NOW() - INTERVAL '7 days'),
    'likes_7d',   COUNT(*) FILTER (WHERE event_type = 'like'  AND created_at >= NOW() - INTERVAL '7 days'),
    'shares_7d',  COUNT(*) FILTER (WHERE event_type = 'share' AND created_at >= NOW() - INTERVAL '7 days'),
    'source_breakdown', jsonb_build_object(
      'direct',    COUNT(*) FILTER (WHERE source = 'direct'),
      'whatsapp',  COUNT(*) FILTER (WHERE source = 'whatsapp'),
      'instagram', COUNT(*) FILTER (WHERE source = 'instagram'),
      'tiktok',    COUNT(*) FILTER (WHERE source = 'tiktok'),
      'twitter',   COUNT(*) FILTER (WHERE source = 'twitter'),
      'qr',        COUNT(*) FILTER (WHERE source = 'qr'),
      'embed',     COUNT(*) FILTER (WHERE source = 'embed')
    ),
    'first_event', MIN(created_at),
    'last_event',  MAX(created_at)
  )
  INTO result
  FROM interactions
  WHERE track_id = p_track_id;

  RETURN result;
END;
$$;

-- ─── Update global rank positions ─────────────────────────────────────────────
-- Assigns sequential integer rank based on final_score DESC.
-- Called by worker after each full ranking recalculation.
CREATE OR REPLACE FUNCTION update_rank_positions()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Global rank by final_score
  UPDATE ranking_cache rc
  SET rank_position = ranked.rn
  FROM (
    SELECT track_id,
           ROW_NUMBER() OVER (ORDER BY final_score DESC) AS rn
    FROM   ranking_cache
  ) ranked
  WHERE rc.track_id = ranked.track_id;

  -- 24-hour rank
  UPDATE ranking_cache rc
  SET rank_24h = ranked.rn
  FROM (
    SELECT track_id,
           ROW_NUMBER() OVER (ORDER BY score_24h DESC) AS rn
    FROM   ranking_cache
    WHERE  score_24h > 0
  ) ranked
  WHERE rc.track_id = ranked.track_id;

  -- 7-day rank
  UPDATE ranking_cache rc
  SET rank_7d = ranked.rn
  FROM (
    SELECT track_id,
           ROW_NUMBER() OVER (ORDER BY score_7d DESC) AS rn
    FROM   ranking_cache
    WHERE  score_7d > 0
  ) ranked
  WHERE rc.track_id = ranked.track_id;
END;
$$;

-- ─── Artist dashboard summary ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_artist_dashboard(p_artist_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_tracks',       COUNT(t.id),
    'live_tracks',        COUNT(t.id) FILTER (WHERE t.status = 'approved'),
    'pending_tracks',     COUNT(t.id) FILTER (WHERE t.status = 'pending'),
    'total_plays',        COALESCE(SUM(t.play_count),  0),
    'total_likes',        COALESCE(SUM(t.like_count),  0),
    'total_shares',       COALESCE(SUM(t.share_count), 0),
    'active_boosts',      (
      SELECT COUNT(*) FROM boosts b
      WHERE b.artist_id = p_artist_id AND b.status = 'active'
    ),
    'total_boost_spend',  (
      SELECT COALESCE(SUM(amount_ngn), 0) FROM boosts b
      WHERE b.artist_id = p_artist_id AND b.status IN ('active','expired')
    )
  )
  INTO result
  FROM tracks t
  WHERE t.artist_id = p_artist_id;

  RETURN result;
END;
$$;

-- ─── Presigned URL expiry cleanup ─────────────────────────────────────────────
-- Removes tracks stuck in 'pending' with no raw audio after 24h
-- (user started upload but never completed it)
CREATE OR REPLACE FUNCTION cleanup_abandoned_uploads()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM tracks
  WHERE status       = 'pending'
    AND raw_audio_path IS NULL
    AND created_at   < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ─── Indexes for analytics queries ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_interactions_analytics
  ON interactions (track_id, event_type, created_at DESC, source);

CREATE INDEX IF NOT EXISTS idx_interactions_recent
  ON interactions (created_at DESC)
  WHERE created_at >= NOW() - INTERVAL '7 days';

-- ─── Materialized view for hot tracks (optional, manual refresh) ──────────────
-- Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hot_tracks;
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hot_tracks AS
  SELECT
    t.id,
    t.title,
    t.slug,
    t.genre,
    t.cover_url,
    t.audio_url,
    t.preview_url,
    t.duration_sec,
    t.play_count,
    t.like_count,
    t.share_count,
    t.boost_multiplier,
    t.published_at,
    p.display_name  AS artist_name,
    p.slug          AS artist_slug,
    p.avatar_url    AS artist_avatar,
    p.verified      AS artist_verified,
    rc.final_score,
    rc.score_24h,
    rc.rank_position
  FROM   tracks t
  JOIN   profiles p       ON p.id = t.artist_id
  LEFT JOIN ranking_cache rc ON rc.track_id = t.id
  WHERE  t.status = 'approved'
  ORDER  BY rc.final_score DESC NULLS LAST
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_hot_tracks_id ON mv_hot_tracks (id);
CREATE        INDEX IF NOT EXISTS mv_hot_tracks_score ON mv_hot_tracks (final_score DESC);
CREATE        INDEX IF NOT EXISTS mv_hot_tracks_24h   ON mv_hot_tracks (score_24h   DESC);
