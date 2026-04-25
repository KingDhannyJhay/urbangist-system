import { Router, Request, Response } from 'express';
import { z }                          from 'zod';
import crypto                         from 'crypto';
import { adminSupabase }              from '../lib/supabase.js';
import { optionalAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimit }                  from 'express-rate-limit';

export const interactionsRouter = Router();

// Very generous limit — 200 events/min per IP
const eventLimit = rateLimit({ windowMs: 60_000, max: 200 });

const eventSchema = z.object({
  track_id:     z.string().uuid(),
  event_type:   z.enum(['play', 'like', 'unlike', 'share', 'download']),
  source:       z.enum(['direct','whatsapp','instagram','tiktok','twitter','qr','embed','other']).default('direct'),
  progress_pct: z.number().int().min(0).max(100).optional(),
  completed:    z.boolean().optional(),
});

// ─── POST /interactions — record a single event ───────────────────────────────
interactionsRouter.post(
  '/',
  eventLimit,
  optionalAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = eventSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid event.', details: parsed.error.flatten() });
        return;
      }

      const { track_id, event_type, source, progress_pct, completed } = parsed.data;
      const authReq = req as AuthenticatedRequest;

      // Verify track is approved (fail silently — don't leak info)
      const { data: track } = await adminSupabase
        .from('tracks').select('id, status').eq('id', track_id).single();
      if (!track || track.status !== 'approved') {
        res.json({ recorded: false });
        return;
      }

      // Hash IP for privacy
      const ip     = req.ip ?? req.socket.remoteAddress ?? '';
      const ipHash = crypto
        .createHash('sha256')
        .update(ip + (process.env.IP_HASH_SALT ?? 'ug-salt'))
        .digest('hex')
        .slice(0, 16);

      await adminSupabase.from('interactions').insert({
        track_id,
        event_type,
        source,
        user_id:      authReq.user?.id ?? null,
        ip_hash:      ipHash,
        progress_pct: progress_pct ?? null,
        completed:    completed ?? null,
      });
      // DB trigger (sync_interaction_counters) updates tracks counters automatically.

      res.json({ recorded: true });
    } catch (err: unknown) {
      console.error('[interactions] error:', err);
      // Don't expose errors for analytics events
      res.json({ recorded: false });
    }
  }
);

// ─── POST /interactions/batch — multiple events at once ───────────────────────
interactionsRouter.post(
  '/batch',
  eventLimit,
  optionalAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(10) });
      const parsed = batchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid batch.', details: parsed.error.flatten() });
        return;
      }

      const authReq = req as AuthenticatedRequest;
      const ip      = req.ip ?? '';
      const ipHash  = crypto.createHash('sha256')
        .update(ip + (process.env.IP_HASH_SALT ?? 'ug-salt'))
        .digest('hex').slice(0, 16);

      const rows = parsed.data.events.map(ev => ({
        ...ev,
        user_id:  authReq.user?.id ?? null,
        ip_hash:  ipHash,
      }));

      await adminSupabase.from('interactions').insert(rows);
      res.json({ recorded: rows.length });
    } catch (err: unknown) {
      console.error('[interactions] batch error:', err);
      res.json({ recorded: 0 });
    }
  }
);

// ─── GET /interactions/analytics/:trackId — artist analytics ─────────────────
interactionsRouter.get(
  '/analytics/:trackId',
  async (req: Request, res: Response): Promise<void> => {
    // Note: authMiddleware should be applied at router level for production
    try {
      const { trackId } = req.params;

      // Aggregate from interactions table using raw SQL via rpc
      const { data, error } = await adminSupabase.rpc('get_track_analytics', {
        p_track_id: trackId,
      });

      if (error) throw error;
      res.json(data ?? {});
    } catch (err: unknown) {
      console.error('[interactions] analytics error:', err);
      res.status(500).json({ error: 'Failed to fetch analytics.' });
    }
  }
);
