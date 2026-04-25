import { Router, Request, Response } from 'express';
import crypto                         from 'crypto';
import { adminSupabase }              from '../lib/supabase.js';
import { rateLimit }                  from 'express-rate-limit';

export const webhooksRouter = Router();

const webhookLimit = rateLimit({ windowMs: 60_000, max: 300 });

// ─── POST /webhooks/paystack ───────────────────────────────────────────────────
// Backup activation. Primary path is POST /boosts/verify.
// Body is raw Buffer (mounted in server.ts before json() middleware).
webhooksRouter.post(
  '/paystack',
  webhookLimit,
  async (req: Request, res: Response): Promise<void> => {
    // Raw body is Buffer because of express.raw() in server.ts
    const rawBody  = req.body as Buffer;
    const signature = req.headers['x-paystack-signature'] as string;

    if (!signature) {
      res.status(401).json({ error: 'Missing signature.' });
      return;
    }

    // HMAC-SHA512 timing-safe verification
    const expectedSig = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody)
      .digest('hex');

    let valid = false;
    try {
      const a = Buffer.from(signature, 'hex');
      const b = Buffer.from(expectedSig, 'hex');
      valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { valid = false; }

    if (!valid) {
      console.warn('[webhook] Invalid HMAC signature.');
      res.status(401).json({ error: 'Invalid signature.' });
      return;
    }

    let event: { event?: string; data?: Record<string, unknown> };
    try { event = JSON.parse(rawBody.toString('utf8')); }
    catch { res.json({ received: true }); return; }

    if (event.event !== 'charge.success') {
      res.json({ received: true }); return;
    }

    const data      = event.data ?? {};
    const reference = data.reference as string | undefined;
    if (!reference) { res.json({ received: true }); return; }

    try {
      // Find the pending boost
      const { data: boost } = await adminSupabase
        .from('boosts')
        .select('*')
        .eq('paystack_ref', reference)
        .maybeSingle();

      if (!boost) {
        console.log('[webhook] No boost for ref:', reference);
        res.json({ received: true }); return;
      }

      // Idempotency — primary /boosts/verify already activated
      if (boost.status === 'active') {
        console.log('[webhook] Already active, skip:', boost.id);
        res.json({ received: true }); return;
      }

      if (boost.status !== 'pending') {
        res.json({ received: true }); return;
      }

      // Re-verify with Paystack even on backup webhook path
      const paystackData = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
          signal:  AbortSignal.timeout(8_000),
        }
      ).then(r => r.json()) as {
        status: boolean;
        data:   { status: string; amount: number; paid_at: string; id: number };
      };

      if (!paystackData.status || paystackData.data.status !== 'success') {
        console.error('[webhook] Payment not successful for ref:', reference);
        res.json({ received: true }); return;
      }

      const paidNgn = paystackData.data.amount / 100;
      if (Math.abs(paidNgn - boost.amount_ngn) > 1) {
        console.error('[webhook] Amount mismatch, skip activation.');
        res.json({ received: true }); return;
      }

      const now    = new Date();
      const endsAt = new Date(now.getTime() + boost.duration_hours * 3_600_000);

      await Promise.all([
        adminSupabase.from('boosts').update({
          status:          'active',
          start_at:        now.toISOString(),
          end_at:          endsAt.toISOString(),
          paid_at:         paystackData.data.paid_at,
          paystack_txn_id: String(paystackData.data.id),
        }).eq('id', boost.id).eq('status', 'pending'),

        adminSupabase.from('tracks')
          .update({ boost_multiplier: boost.multiplier })
          .eq('id', boost.track_id),

        adminSupabase.from('notifications').insert({
          user_id: boost.artist_id,
          type:    'boost_activated',
          title:   '⚡ Boost Activated!',
          body:    `Your ${boost.plan} boost is live for ${boost.duration_hours / 24} day(s).`,
          link:    '/dashboard',
        }),

        adminSupabase.from('job_queue').insert({
          job_type: 'recalc_rankings',
          payload:  { track_id: boost.track_id, reason: 'boost_webhook' },
        }),
      ]);

      console.log('[webhook] Backup activation complete:', boost.id);
    } catch (err: unknown) {
      console.error('[webhook] Processing error:', err);
    }

    // Always return 200 to Paystack — never 500 (causes retry storms)
    res.json({ received: true });
  }
);
