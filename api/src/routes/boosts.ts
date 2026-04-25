import { Router, Request, Response } from 'express';
import crypto                         from 'crypto';
import { z }                          from 'zod';
import { adminSupabase }              from '../lib/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimit }                  from 'express-rate-limit';

export const boostsRouter = Router();

const boostLimit = rateLimit({ windowMs: 60_000, max: 20 });

// Plan config — source of truth lives on server, never on client
const BOOST_PLANS = {
  basic:    { price: 1000,  hours: 24,  multiplier: 2.0, label: 'Basic Boost' },
  standard: { price: 3000,  hours: 72,  multiplier: 3.5, label: 'Standard Boost' },
  premium:  { price: 5000,  hours: 168, multiplier: 6.0, label: 'Premium Boost' },
} as const;
type BoostPlan = keyof typeof BOOST_PLANS;

// ─── POST /boosts/initiate — Step 1: create pending boost, return Paystack config ───
boostsRouter.post(
  '/initiate',
  boostLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      const schema = z.object({
        track_id: z.string().uuid(),
        plan:     z.enum(['basic', 'standard', 'premium']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request.', details: parsed.error.flatten() });
        return;
      }

      const { track_id, plan } = parsed.data;
      const planConfig = BOOST_PLANS[plan as BoostPlan];

      // Verify track ownership and approved status
      const { data: track, error: trackErr } = await adminSupabase
        .from('tracks')
        .select('id, title, artist_id, status')
        .eq('id', track_id)
        .eq('artist_id', authReq.user.id)
        .eq('status', 'approved')
        .single();

      if (trackErr || !track) {
        res.status(404).json({ error: 'Track not found or not eligible for boosting.' });
        return;
      }

      // Generate reference server-side (cryptographically unique)
      const reference = `UG-BOOST-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().replace(/-/g,'').slice(0,12).toUpperCase()}`;

      // Create pending boost record
      const { data: boost, error: boostErr } = await adminSupabase
        .from('boosts')
        .insert({
          track_id,
          artist_id:     authReq.user.id,
          plan,
          multiplier:    planConfig.multiplier,
          duration_hours: planConfig.hours,
          amount_ngn:    planConfig.price,
          status:        'pending',
          paystack_ref:  reference,
        })
        .select('id')
        .single();

      if (boostErr || !boost) throw boostErr ?? new Error('Failed to create boost record.');

      res.json({
        boost_id:   boost.id,
        reference,
        amount_kobo: planConfig.price * 100,
        email:      authReq.user.email,
        public_key: process.env.PAYSTACK_PUBLIC_KEY!,
        plan_label: planConfig.label,
        amount_ngn: planConfig.price,
      });
    } catch (err: unknown) {
      console.error('[boosts] initiate error:', err);
      res.status(500).json({ error: 'Failed to initiate boost.' });
    }
  }
);

// ─── POST /boosts/verify — Step 2: verify with Paystack, activate boost ───────
boostsRouter.post(
  '/verify',
  boostLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      const schema = z.object({
        reference: z.string().min(1).max(200),
        boost_id:  z.string().uuid(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request.' });
        return;
      }

      const { reference, boost_id } = parsed.data;

      // Load pending boost — ownership check included
      const { data: boost } = await adminSupabase
        .from('boosts')
        .select('*')
        .eq('id', boost_id)
        .eq('paystack_ref', reference)
        .eq('artist_id', authReq.user.id)
        .single();

      if (!boost) {
        res.status(404).json({ error: 'Boost not found.' });
        return;
      }

      // Idempotency — already activated
      if (boost.status === 'active') {
        res.json({ success: true, message: 'Boost already active.', ends_at: boost.end_at });
        return;
      }

      if (boost.status !== 'pending') {
        res.status(409).json({ error: `Boost cannot be activated. Status: ${boost.status}` });
        return;
      }

      // ── CALL PAYSTACK API — primary security verification ─────────────────
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
          signal:  AbortSignal.timeout(8_000),
        }
      );

      if (!verifyRes.ok) {
        console.error('[boosts] Paystack verify HTTP error:', verifyRes.status);
        res.status(502).json({ error: 'Payment verification service unavailable.' });
        return;
      }

      const paystackData = await verifyRes.json() as {
        status: boolean;
        data: { status: string; amount: number; paid_at: string; id: number };
      };

      if (!paystackData.status || paystackData.data.status !== 'success') {
        res.status(402).json({ error: `Payment not successful. Status: ${paystackData.data?.status}` });
        return;
      }

      // Amount check
      const paidNgn = paystackData.data.amount / 100;
      if (Math.abs(paidNgn - boost.amount_ngn) > 1) {
        console.error('[boosts] Amount mismatch:', paidNgn, 'vs', boost.amount_ngn);
        res.status(402).json({ error: 'Payment amount mismatch.' });
        return;
      }

      // Activate
      const now    = new Date();
      const endsAt = new Date(now.getTime() + boost.duration_hours * 3_600_000);

      await Promise.all([
        adminSupabase.from('boosts').update({
          status:         'active',
          start_at:       now.toISOString(),
          end_at:         endsAt.toISOString(),
          paid_at:        paystackData.data.paid_at,
          paystack_txn_id: String(paystackData.data.id),
        }).eq('id', boost.id).eq('status', 'pending'),

        adminSupabase.from('tracks').update({
          boost_multiplier: boost.multiplier,
        }).eq('id', boost.track_id),

        // Notify artist
        adminSupabase.from('notifications').insert({
          user_id: boost.artist_id,
          type:    'boost_activated',
          title:   '⚡ Boost Activated!',
          body:    `Your ${boost.plan} boost is live for ${boost.duration_hours / 24} day(s).`,
          link:    '/dashboard',
        }),

        // Enqueue immediate ranking recalculation for this track
        adminSupabase.from('job_queue').insert({
          job_type: 'recalc_rankings',
          payload:  { track_id: boost.track_id, reason: 'boost_activated' },
          run_after: new Date().toISOString(),
        }),
      ]);

      res.json({
        success:  true,
        plan:     boost.plan,
        ends_at:  endsAt.toISOString(),
        message:  `Your ${boost.plan} boost is now live!`,
      });
    } catch (err: unknown) {
      console.error('[boosts] verify error:', err);
      res.status(500).json({ error: 'Boost activation failed.' });
    }
  }
);

// ─── GET /boosts — artist's boost history ─────────────────────────────────────
boostsRouter.get(
  '/',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { data } = await adminSupabase
        .from('boosts')
        .select('*, track:tracks(title, slug)')
        .eq('artist_id', authReq.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      res.json({ boosts: data ?? [] });
    } catch (err: unknown) {
      console.error('[boosts] list error:', err);
      res.status(500).json({ error: 'Failed to fetch boosts.' });
    }
  }
);
