import { supabase } from '../worker.js';

/**
 * Ranking Score Formula:
 *
 *   raw     = (plays × W_PLAY) + (likes × W_LIKE) + (shares × W_SHARE)
 *   decayed = raw × e^(−ln2 × age_hours / HALF_LIFE)
 *   final   = decayed × boost_multiplier
 *
 * Weight constants are tuned so shares have 4× the value of plays:
 *   - Play:  1.0  (passive engagement)
 *   - Like:  2.0  (intentional positive signal)
 *   - Share: 4.0  (viral amplification)
 *
 * Half-life = 72 hours (score halves every 3 days without new activity).
 * Boost multiplier: 1× (no boost) to 6× (premium).
 */

const WEIGHTS = {
  play:  1.0,
  like:  2.0,
  share: 4.0,
} as const;

const HALF_LIFE_HOURS = 72;

interface RankingJobPayload {
  scope?:    'all' | 'single';
  track_id?: string;
  reason?:   string;
}

export async function recalcRankingsJob(payload: Record<string, unknown>): Promise<void> {
  const { scope = 'all', track_id, reason } = payload as RankingJobPayload;

  console.log(`[rankings] Recalculating ${scope === 'all' ? 'all tracks' : `track ${track_id}`} (reason: ${reason ?? 'scheduled'})`);

  const BATCH_SIZE = 100;
  let   processed  = 0;
  let   offset     = 0;

  while (true) {
    // Fetch batch of approved tracks with their counters
    let query = supabase
      .from('tracks')
      .select('id, play_count, like_count, share_count, boost_multiplier, published_at, created_at')
      .eq('status', 'approved')
      .range(offset, offset + BATCH_SIZE - 1);

    if (scope === 'single' && track_id) {
      query = query.eq('id', track_id);
    }

    const { data: tracks, error } = await query;
    if (error) throw error;
    if (!tracks || tracks.length === 0) break;

    const now = Date.now();

    // Compute scores for this batch
    const upserts = tracks.map(track => {
      const publishedAt = track.published_at ?? track.created_at;
      const ageHours    = Math.max(0, (now - new Date(publishedAt).getTime()) / 3_600_000);
      const decayFactor = Math.exp(-Math.LN2 * (ageHours / HALF_LIFE_HOURS));
      const boost       = track.boost_multiplier ?? 1;

      const rawScore  = track.play_count  * WEIGHTS.play
                      + track.like_count  * WEIGHTS.like
                      + track.share_count * WEIGHTS.share;

      const finalScore = Math.max(0.01, rawScore * decayFactor * boost);

      return {
        track_id:     track.id,
        play_score:   track.play_count  * WEIGHTS.play,
        like_score:   track.like_count  * WEIGHTS.like,
        share_score:  track.share_count * WEIGHTS.share,
        decay_factor: parseFloat(decayFactor.toFixed(6)),
        boost_factor: boost,
        final_score:  parseFloat(finalScore.toFixed(4)),
        computed_at:  new Date().toISOString(),
      };
    });

    // Upsert ranking_cache in batch
    const { error: upsertErr } = await supabase
      .from('ranking_cache')
      .upsert(upserts, { onConflict: 'track_id' });

    if (upsertErr) {
      console.error('[rankings] Batch upsert error:', upsertErr.message);
      throw upsertErr;
    }

    processed += tracks.length;
    offset    += BATCH_SIZE;

    if (scope === 'single' || tracks.length < BATCH_SIZE) break;
  }

  // ── Compute 24h and 7d window scores ─────────────────────────────────────
  // These use recent interactions for "rising" feed
  if (scope === 'all') {
    await computeWindowScores();
  }

  // ── Update rank positions ─────────────────────────────────────────────────
  if (scope === 'all') {
    await updateRankPositions();
  }

  console.log(`[rankings] ✓ Recalculated ${processed} track(s).`);
}

async function computeWindowScores(): Promise<void> {
  // Use raw SQL via RPC for efficient windowed aggregation
  const now24h = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const now7d  = new Date(Date.now() -  7 * 24 * 3_600_000).toISOString();

  // Aggregate interactions in the last 24h
  const { data: stats24h } = await supabase
    .from('interactions')
    .select('track_id, event_type')
    .gte('created_at', now24h)
    .in('event_type', ['play', 'like', 'share']);

  // Aggregate interactions in the last 7 days
  const { data: stats7d } = await supabase
    .from('interactions')
    .select('track_id, event_type')
    .gte('created_at', now7d)
    .in('event_type', ['play', 'like', 'share']);

  const scoreMap24h = aggregateToScore(stats24h ?? []);
  const scoreMap7d  = aggregateToScore(stats7d  ?? []);

  // Merge all track IDs
  const allIds = new Set([...Object.keys(scoreMap24h), ...Object.keys(scoreMap7d)]);

  const updates = Array.from(allIds).map(id => ({
    track_id:  id,
    score_24h: parseFloat((scoreMap24h[id] ?? 0).toFixed(4)),
    score_7d:  parseFloat((scoreMap7d[id]  ?? 0).toFixed(4)),
  }));

  if (updates.length > 0) {
    await supabase.from('ranking_cache')
      .upsert(updates, { onConflict: 'track_id', ignoreDuplicates: false });
  }
}

function aggregateToScore(
  rows: { track_id: string; event_type: string }[]
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    const w = WEIGHTS[row.event_type as keyof typeof WEIGHTS] ?? 0;
    map[row.track_id] = (map[row.track_id] ?? 0) + w;
  }
  return map;
}

async function updateRankPositions(): Promise<void> {
  // Assign sequential rank positions ordered by final_score DESC
  // Using a raw RPC call to avoid N+1 updates
  const { error } = await supabase.rpc('update_rank_positions');
  if (error) {
    // Not fatal — positions are nice-to-have
    console.warn('[rankings] rank position update failed:', error.message);
  }
}
