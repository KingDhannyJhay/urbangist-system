-- ============================================================
-- UrbanGist — Automated Score Maintenance (No pg_cron)
-- ✅ Works on Supabase FREE tier
-- ✅ No pg_cron extension required
-- 
-- Strategy: trigger-based decay instead of time-based jobs.
-- Scores update whenever the track's stats change, which is
-- exactly when it matters. The ranking formula in the DB
-- mirrors lib/trending.ts identically.
-- ============================================================

-- ============================================================
-- 1. Core scoring function (same formula as lib/trending.ts)
--    score = (plays*1 + shares*4 + likes*2)
--            * EXP(-LN(2) * age_hours / 72)
--            * boost_multiplier
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_rank_score(
  p_plays          BIGINT,
  p_shares         BIGINT,
  p_likes          BIGINT,
  p_boost          FLOAT,
  p_published_at   TIMESTAMPTZ,
  p_created_at     TIMESTAMPTZ
) RETURNS FLOAT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    0.01,
    (p_plays * 1.0 + p_shares * 4.0 + p_likes * 2.0)
    * EXP(
        -LN(2)
        * EXTRACT(EPOCH FROM (NOW() - COALESCE(p_published_at, p_created_at))) / 3600.0
        / 72.0
      )
    * p_boost
  )
$$;

-- ============================================================
-- 2. Trigger function — recalculates score on every stat change
--    Fires when play_count, share_count, like_count, or
--    boost_multiplier changes on a live track.
-- ============================================================
CREATE OR REPLACE FUNCTION trg_recalc_rank_score()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.rank_score := calculate_rank_score(
    NEW.play_count,
    NEW.share_count,
    NEW.like_count,
    NEW.boost_multiplier,
    NEW.published_at,
    NEW.created_at
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- Drop old trigger if it exists, then recreate
DROP TRIGGER IF EXISTS trg_update_rank_score ON tracks;

CREATE TRIGGER trg_update_rank_score
  BEFORE UPDATE OF play_count, share_count, like_count, boost_multiplier
  ON tracks
  FOR EACH ROW
  WHEN (NEW.status = 'live')
  EXECUTE FUNCTION trg_recalc_rank_score();

-- ============================================================
-- 3. Expire boost promotions via a DB function
--    Called from: POST /api/webhooks/paystack (sets end_date)
--    Called from: GET  /api/boost/expire     (manual trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION expire_finished_boosts()
RETURNS TABLE(expired_count INT, reset_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired INT := 0;
  v_reset   INT := 0;
BEGIN
  -- Step 1: Mark promotions past their end_date as expired
  UPDATE promotions
  SET status = 'expired'
  WHERE status = 'active'
    AND end_date < NOW();

  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- Step 2: Reset boost_multiplier on tracks with no remaining active boost
  UPDATE tracks t
  SET
    boost_multiplier = 1.0,
    rank_score = calculate_rank_score(
      t.play_count, t.share_count, t.like_count,
      1.0,
      t.published_at, t.created_at
    ),
    updated_at = NOW()
  WHERE
    t.boost_multiplier > 1.0
    AND t.status = 'live'
    AND NOT EXISTS (
      SELECT 1 FROM promotions p
      WHERE p.track_id = t.id
        AND p.status   = 'active'
        AND p.end_date > NOW()
    );

  GET DIAGNOSTICS v_reset = ROW_COUNT;

  RETURN QUERY SELECT v_expired, v_reset;
END;
$$;

-- ============================================================
-- 4. Batch recalculate all live track scores
--    (run manually when needed, or call from /api/boost/expire)
-- ============================================================
CREATE OR REPLACE FUNCTION recalc_all_scores()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  UPDATE tracks
  SET
    rank_score = calculate_rank_score(
      play_count, share_count, like_count,
      boost_multiplier,
      published_at, created_at
    ),
    updated_at = NOW()
  WHERE status = 'live';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 5. Verify setup
-- ============================================================
-- Run this to confirm triggers are installed:
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'tracks'::regclass;
--
-- Run this to manually trigger a full recalculation:
-- SELECT recalc_all_scores();
--
-- Run this to expire finished boosts:
-- SELECT * FROM expire_finished_boosts();
--
-- Test the scoring function directly:
-- SELECT calculate_rank_score(100, 20, 50, 2.0, NOW() - INTERVAL '24 hours', NOW() - INTERVAL '48 hours');
