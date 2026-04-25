import { Router, Request, Response } from 'express';
import { adminSupabase }              from '../lib/supabase.js';

export const learnRouter = Router();

// ─── GET /learn — published articles listing ──────────────────────────────────
learnRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const category = req.query.category as string | undefined;
    const limit    = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset   = parseInt(req.query.offset as string) || 0;

    let query = adminSupabase
      .from('articles')
      .select(`
        id, title, slug, excerpt, cover_url, category, tags,
        featured, view_count, published_at,
        author:profiles!author_id(display_name, slug, avatar_url)
      `, { count: 'exact' })
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq('category', category);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ articles: data ?? [], total: count, limit, offset });
  } catch (err) {
    console.error('[learn] list error:', err);
    res.status(500).json({ error: 'Failed to fetch articles.' });
  }
});

// ─── GET /learn/:slug — single article ────────────────────────────────────────
learnRouter.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;

    const { data, error } = await adminSupabase
      .from('articles')
      .select(`
        *,
        author:profiles!author_id(display_name, slug, avatar_url, bio)
      `)
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Article not found.' });
      return;
    }

    // Increment view count (fire-and-forget)
    adminSupabase.from('articles')
      .update({ view_count: data.view_count + 1 })
      .eq('id', data.id)
      .then(() => {}).catch(() => {});

    // Related articles (same category)
    const { data: related } = await adminSupabase
      .from('articles')
      .select('id, title, slug, cover_url, excerpt, published_at')
      .eq('status', 'published')
      .eq('category', data.category)
      .neq('id', data.id)
      .order('published_at', { ascending: false })
      .limit(3);

    res.json({ article: data, related: related ?? [] });
  } catch (err) {
    console.error('[learn] single error:', err);
    res.status(500).json({ error: 'Failed to fetch article.' });
  }
});
