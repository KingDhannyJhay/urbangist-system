import { Router, Request, Response } from 'express';
import { z }                          from 'zod';
import { adminSupabase }              from '../lib/supabase.js';
import { requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';

export const adminRouter = Router();

// Every admin route requires the admin role (checked after authMiddleware in server.ts)
adminRouter.use(requireAdmin);

// ─── GET /admin/me ────────────────────────────────────────────────────────────
// Used by web middleware to confirm the caller is an admin.
adminRouter.get('/me', (req: Request, res: Response): void => {
  const { user } = req as AuthenticatedRequest;
  res.json({ id: user.id, email: user.email, role: user.role });
});

// ─── GET /admin/stats ─────────────────────────────────────────────────────────
adminRouter.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [live, pending, processing, artists, plays, revenue] = await Promise.all([
      adminSupabase.from('tracks').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      adminSupabase.from('tracks').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      adminSupabase.from('tracks').select('id', { count: 'exact', head: true }).eq('status', 'processing'),
      adminSupabase.from('profiles').select('id', { count: 'exact', head: true }),
      adminSupabase.from('interactions').select('id', { count: 'exact', head: true }).eq('event_type', 'play'),
      adminSupabase.from('boosts').select('amount_ngn').in('status', ['active', 'expired']),
    ]);

    const totalRevenue = (revenue.data ?? []).reduce(
      (s: number, b: { amount_ngn: number }) => s + b.amount_ngn, 0
    );

    res.json({
      live_tracks:       live.count       ?? 0,
      pending_tracks:    pending.count    ?? 0,
      processing_tracks: processing.count ?? 0,
      total_artists:     artists.count    ?? 0,
      total_plays:       plays.count      ?? 0,
      total_revenue:     totalRevenue,
    });
  } catch (err) {
    console.error('[admin] stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ─── GET /admin/tracks/pending ───────────────────────────────────────────────
adminRouter.get('/tracks/pending', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await adminSupabase
      .from('tracks')
      .select(`
        id, title, slug, genre, cover_url, audio_url, raw_audio_path, created_at, rejection_note,
        artist:profiles!artist_id(id, display_name, slug, verified)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ tracks: data ?? [] });
  } catch (err) {
    console.error('[admin] pending error:', err);
    res.status(500).json({ error: 'Failed to fetch pending tracks.' });
  }
});

// ─── GET /admin/tracks — all tracks with filters ─────────────────────────────
adminRouter.get('/tracks', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const limit  = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    let query = adminSupabase
      .from('tracks')
      .select(`
        id, title, slug, genre, status, play_count, boost_multiplier,
        created_at, published_at,
        artist:profiles!artist_id(display_name, slug)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ tracks: data ?? [], total: count, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tracks.' });
  }
});

// ─── PATCH /admin/tracks/:id/approve ─────────────────────────────────────────
adminRouter.patch('/tracks/:id/approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const { error } = await adminSupabase
      .from('tracks')
      .update({ status: 'approved', approved_at: new Date().toISOString(), published_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    const { data: track } = await adminSupabase
      .from('tracks').select('artist_id, title, slug').eq('id', id).single();

    if (track) {
      await Promise.all([
        adminSupabase.from('notifications').insert({
          user_id: track.artist_id, type: 'track_approved',
          title:   '✅ Your track is live!',
          body:    `"${track.title}" has been approved and is now discoverable on UrbanGist.`,
          link:    `/track/${track.slug}`,
        }),
        adminSupabase.from('ranking_cache').upsert(
          { track_id: id, final_score: 0, score_24h: 0, score_7d: 0, computed_at: new Date().toISOString() },
          { onConflict: 'track_id' }
        ),
        adminSupabase.from('job_queue').insert({
          job_type: 'recalc_rankings', payload: { track_id: id, reason: 'approval' },
          run_after: new Date().toISOString(),
        }),
      ]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin] approve error:', err);
    res.status(500).json({ error: 'Failed to approve track.' });
  }
});

// ─── PATCH /admin/tracks/:id/reject ──────────────────────────────────────────
adminRouter.patch('/tracks/:id/reject', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id }     = req.params;
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);

    await adminSupabase.from('tracks')
      .update({ status: 'rejected', rejection_note: reason ?? null })
      .eq('id', id);

    const { data: track } = await adminSupabase
      .from('tracks').select('artist_id, title').eq('id', id).single();

    if (track) {
      await adminSupabase.from('notifications').insert({
        user_id: track.artist_id, type: 'track_rejected',
        title:   '⚠️ Track not approved',
        body:    reason ?? 'Your track did not meet our quality guidelines. Please review and resubmit.',
        link:    '/dashboard',
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin] reject error:', err);
    res.status(500).json({ error: 'Failed to reject track.' });
  }
});

// ─── GET /admin/jobs — job queue monitor ─────────────────────────────────────
adminRouter.get('/jobs', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = (req.query.status as string) || 'pending';
    const { data } = await adminSupabase
      .from('job_queue').select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(100);
    res.json({ jobs: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch jobs.' });
  }
});

// ─── POST /admin/jobs/:id/retry ───────────────────────────────────────────────
adminRouter.post('/jobs/:id/retry', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { error } = await adminSupabase
      .from('job_queue')
      .update({ status: 'pending', attempts: 0, last_error: null, run_after: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retry job.' });
  }
});

// ─── Articles ────────────────────────────────────────────────────────────────
adminRouter.get('/articles', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data } = await adminSupabase
      .from('articles')
      .select('id, title, slug, status, category, featured, view_count, published_at, author:profiles!author_id(display_name)')
      .order('created_at', { ascending: false });
    res.json({ articles: data ?? [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch articles.' });
  }
});

adminRouter.post('/articles', async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const schema = z.object({
      title:           z.string().min(1).max(300),
      slug:            z.string().min(1).max(300),
      excerpt:         z.string().optional(),
      content:         z.string().min(1),
      category:        z.enum(['guide','platform','industry','news','tutorial']),
      cover_url:       z.string().url().optional().nullable(),
      tags:            z.array(z.string()).default([]),
      seo_title:       z.string().optional().nullable(),
      seo_description: z.string().max(160).optional().nullable(),
      featured:        z.boolean().default(false),
      status:          z.enum(['draft','published']).default('draft'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid article.', details: parsed.error.flatten() });
      return;
    }

    const { data, error } = await adminSupabase
      .from('articles')
      .insert({
        ...parsed.data,
        author_id:    authReq.user.id,
        published_at: parsed.data.status === 'published' ? new Date().toISOString() : null,
      })
      .select('id, slug')
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'An article with this slug already exists.' });
        return;
      }
      throw error;
    }

    res.status(201).json({ article: data });
  } catch (err) {
    console.error('[admin] article create error:', err);
    res.status(500).json({ error: 'Failed to create article.' });
  }
});

adminRouter.patch('/articles/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const schema = z.object({
      status: z.enum(['draft','published','archived']).optional(),
      featured: z.boolean().optional(),
    });
    const updates = schema.parse(req.body);
    const extra: Record<string, unknown> = {};
    if (updates.status === 'published') extra.published_at = new Date().toISOString();

    await adminSupabase.from('articles').update({ ...updates, ...extra }).eq('id', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update article.' });
  }
});
