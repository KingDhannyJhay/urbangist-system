import { Router, Request, Response } from 'express';
import { adminSupabase }              from '../lib/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

export const profilesRouter = Router();

// ─── GET /profiles/:slug — public artist profile ──────────────────────────────
profilesRouter.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;

    const { data: profile, error } = await adminSupabase
      .from('profiles')
      .select('id, username, display_name, bio, avatar_url, slug, verified, social_links, created_at')
      .eq('slug', slug)
      .single();

    if (error || !profile) {
      res.status(404).json({ error: 'Artist not found.' });
      return;
    }

    // Fetch artist's approved tracks with ranking scores
    const { data: artistTracks } = await adminSupabase
      .from('tracks')
      .select(`
        id, title, slug, genre, cover_url, preview_url, duration_sec,
        play_count, like_count, share_count, boost_multiplier, published_at,
        ranking_cache(final_score, rank_position)
      `)
      .eq('artist_id', profile.id)
      .eq('status', 'approved')
      .order('ranking_cache(final_score)', { ascending: false })
      .limit(20);

    // Track stats aggregate
    const stats = (artistTracks ?? []).reduce(
      (acc, t) => ({
        total_plays:  acc.total_plays  + (t.play_count  ?? 0),
        total_likes:  acc.total_likes  + (t.like_count  ?? 0),
        total_shares: acc.total_shares + (t.share_count ?? 0),
      }),
      { total_plays: 0, total_likes: 0, total_shares: 0 }
    );

    res.json({
      profile,
      tracks:       artistTracks ?? [],
      stats:        { ...stats, total_tracks: artistTracks?.length ?? 0 },
    });
  } catch (err) {
    console.error('[profiles] get error:', err);
    res.status(500).json({ error: 'Failed to fetch artist profile.' });
  }
});

// ─── GET /profiles/me/dashboard — authenticated artist dashboard ──────────────
profilesRouter.get('/me/dashboard', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;

    // All artist's own tracks (all statuses)
    const { data: myTracks } = await adminSupabase
      .from('tracks')
      .select(`
        id, title, slug, genre, status, cover_url,
        play_count, like_count, share_count, boost_multiplier,
        created_at, published_at, rejection_note
      `)
      .eq('artist_id', user.id)
      .order('created_at', { ascending: false });

    // Active boosts
    const { data: activeBoosts } = await adminSupabase
      .from('boosts')
      .select('id, track_id, plan, multiplier, start_at, end_at, status, amount_ngn')
      .eq('artist_id', user.id)
      .eq('status', 'active');

    // Dashboard summary via DB function
    const { data: summary } = await adminSupabase
      .rpc('get_artist_dashboard', { p_artist_id: user.id });

    // Notifications
    const { data: notifications } = await adminSupabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({
      tracks:        myTracks       ?? [],
      active_boosts: activeBoosts   ?? [],
      summary:       summary        ?? {},
      notifications: notifications  ?? [],
    });
  } catch (err) {
    console.error('[profiles] dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

// ─── PATCH /profiles/me — update own profile ─────────────────────────────────
profilesRouter.patch('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;

    // Only allow safe fields to be updated
    const allowed = ['display_name', 'bio', 'avatar_url', 'social_links'];
    const updates = Object.fromEntries(
      Object.entries(req.body as Record<string, unknown>).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update.' });
      return;
    }

    const { data, error } = await adminSupabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select('id, display_name, bio, avatar_url, slug, social_links')
      .single();

    if (error) throw error;
    res.json({ profile: data });
  } catch (err) {
    console.error('[profiles] update error:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ─── GET /profiles/me/analytics/:trackId ─────────────────────────────────────
profilesRouter.get('/me/analytics/:trackId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user }    = req as AuthenticatedRequest;
    const { trackId } = req.params;

    // Verify ownership
    const { data: track } = await adminSupabase
      .from('tracks').select('artist_id').eq('id', trackId).single();

    if (!track || track.artist_id !== user.id) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const { data } = await adminSupabase.rpc('get_track_analytics', { p_track_id: trackId });
    res.json(data ?? {});
  } catch (err) {
    console.error('[profiles] analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

// ─── PATCH /profiles/me/notifications/read — mark all read ───────────────────
profilesRouter.patch('/me/notifications/read', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { user } = req as AuthenticatedRequest;
    await adminSupabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
});
