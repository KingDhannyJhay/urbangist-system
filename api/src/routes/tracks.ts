import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { adminSupabase }                        from '../lib/supabase.js';
import { authMiddleware, AuthenticatedRequest, optionalAuth } from '../middleware/auth.js';
import { rateLimit }                            from 'express-rate-limit';

export const tracksRouter = Router();

// Strict rate limit on upload initiation
const uploadLimit = rateLimit({ windowMs: 600_000, max: 10, skipSuccessfulRequests: false });

// ─── GET /tracks — discovery feed ─────────────────────────────────────────────
// Uses ranking_cache; never computes scores on request.
tracksRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { feed = 'trending', genre, limit = '20', offset = '0' } = req.query as Record<string, string>;

    const lim = Math.min(parseInt(limit) || 20, 50);
    const off = parseInt(offset) || 0;

    // Determine sort column based on feed type
    const sortColumn =
      feed === 'rising'   ? 'rc.score_24h' :
      feed === 'new'      ? 't.published_at' :
      'rc.final_score';  // trending (default)

    let query = adminSupabase
      .from('tracks')
      .select(`
        id, title, slug, genre, subgenre,
        audio_url, preview_url, cover_url, waveform_url,
        duration_sec, play_count, like_count, share_count,
        boost_multiplier, published_at,
        artist:profiles!artist_id ( id, display_name, slug, avatar_url, verified ),
        ranking_cache!inner ( final_score, score_24h, rank_position )
      `)
      .eq('status', 'approved')
      .order(
        feed === 'new' ? 'published_at' : 'ranking_cache.final_score',
        { ascending: false, nullsFirst: false }
      )
      .range(off, off + lim - 1);

    if (genre) query = query.eq('genre', genre);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ tracks: data ?? [], total: count, offset: off, limit: lim });
  } catch (err: unknown) {
    console.error('[tracks] feed error:', err);
    res.status(500).json({ error: 'Failed to fetch tracks.' });
  }
});

// ─── GET /tracks/:slug — single track ─────────────────────────────────────────
tracksRouter.get('/:slug', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const authReq  = req as AuthenticatedRequest;

    const { data, error } = await adminSupabase
      .from('tracks')
      .select(`
        *,
        artist:profiles!artist_id ( id, display_name, slug, avatar_url, verified, bio, social_links ),
        ranking_cache ( final_score, rank_position, score_24h )
      `)
      .eq('slug', slug)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Track not found.' });
      return;
    }

    // Non-approved tracks only visible to owner or admin
    if (data.status !== 'approved') {
      if (!authReq.user || (authReq.user.id !== data.artist_id && authReq.user.role !== 'admin')) {
        res.status(404).json({ error: 'Track not found.' });
        return;
      }
    }

    // Fetch related tracks (same genre, exclude current)
    const { data: related } = await adminSupabase
      .from('tracks')
      .select('id, title, slug, cover_url, artist:profiles!artist_id(display_name, slug)')
      .eq('genre', data.genre)
      .eq('status', 'approved')
      .neq('id', data.id)
      .order('ranking_cache(final_score)', { ascending: false })
      .limit(6);

    res.json({ track: data, related: related ?? [] });
  } catch (err: unknown) {
    console.error('[tracks] single error:', err);
    res.status(500).json({ error: 'Failed to fetch track.' });
  }
});

// ─── POST /tracks/upload — initiate upload (returns presigned URLs) ────────────
tracksRouter.post(
  '/upload',
  uploadLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      const bodySchema = z.object({
        title:       z.string().min(1).max(200),
        genre:       z.string().min(1),
        subgenre:    z.string().optional(),
        description: z.string().max(2000).optional(),
        lyrics:      z.string().optional(),
        cover_mime:  z.enum(['image/jpeg', 'image/png', 'image/webp']),
        audio_mime:  z.enum(['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/ogg']),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request.', details: parsed.error.flatten() });
        return;
      }

      const { title, genre, subgenre, description, lyrics, cover_mime, audio_mime } = parsed.data;

      // Generate slug
      const { default: slugify } = await import('slugify');
      const { data: profile } = await adminSupabase
        .from('profiles').select('slug, display_name').eq('id', authReq.user.id).single();

      const artistName = profile?.display_name || profile?.slug || 'artist';
      const baseSlug   = slugify(`${title}-by-${artistName}`, { lower: true, strict: true });

      // Check slug uniqueness
      const { data: existing } = await adminSupabase
        .from('tracks').select('id').eq('slug', baseSlug).maybeSingle();
      const slug = existing ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;

      // Build storage paths
      const uploadId   = crypto.randomUUID();
      const coverExt   = cover_mime.split('/')[1];
      const audioExt   = audio_mime === 'audio/mpeg' ? 'mp3' : audio_mime.split('/')[1];
      const coverPath  = `${authReq.user.id}/${uploadId}/cover.${coverExt}`;
      const audioPath  = `${authReq.user.id}/${uploadId}/raw.${audioExt}`;

      // Generate presigned upload URLs (60 min expiry)
      const [coverUrl, audioUrl] = await Promise.all([
        adminSupabase.storage.from('track-covers').createSignedUploadUrl(coverPath),
        adminSupabase.storage.from('raw-uploads').createSignedUploadUrl(audioPath, { upsert: false }),
      ]);

      if (coverUrl.error || audioUrl.error) {
        throw new Error('Failed to generate upload URLs.');
      }

      // Create pending track record
      const { data: track, error: insertErr } = await adminSupabase
        .from('tracks')
        .insert({
          artist_id:      authReq.user.id,
          title,
          slug,
          genre,
          subgenre:       subgenre ?? null,
          description:    description ?? null,
          lyrics:         lyrics ?? null,
          raw_audio_path: audioPath,
          cover_path:     coverPath,
          status:         'pending',
        })
        .select('id, slug')
        .single();

      if (insertErr || !track) throw insertErr ?? new Error('Failed to create track.');

      // The database trigger (enqueue_audio_processing) will automatically
      // create a job_queue entry when raw_audio_path is set.

      res.status(201).json({
        track: { id: track.id, slug: track.slug },
        upload: {
          cover: {
            signed_url: coverUrl.data.signedUrl,
            path:       coverPath,
          },
          audio: {
            signed_url: audioUrl.data.signedUrl,
            path:       audioPath,
          },
        },
      });
    } catch (err: unknown) {
      console.error('[tracks] upload init error:', err);
      res.status(500).json({ error: 'Failed to initiate upload.' });
    }
  }
);

// ─── GET /tracks/search — full-text search ────────────────────────────────────
tracksRouter.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q   = (req.query.q as string)?.trim();
    const lim = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!q) { res.json({ tracks: [], artists: [] }); return; }

    const [tracksRes, artistsRes] = await Promise.all([
      adminSupabase
        .from('tracks')
        .select('id, title, slug, genre, cover_url, artist:profiles!artist_id(display_name, slug)')
        .eq('status', 'approved')
        .textSearch('to_tsvector', q, { type: 'websearch', config: 'english' })
        .order('play_count', { ascending: false })
        .limit(lim),

      adminSupabase
        .from('profiles')
        .select('id, display_name, slug, avatar_url, verified')
        .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`)
        .limit(10),
    ]);

    res.json({
      tracks:  tracksRes.data  ?? [],
      artists: artistsRes.data ?? [],
    });
  } catch (err: unknown) {
    console.error('[tracks] search error:', err);
    res.status(500).json({ error: 'Search failed.' });
  }
});
