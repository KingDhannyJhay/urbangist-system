'use client';

// components/BoostButton.tsx
// Client component — uses Railway API for initiate/verify, Paystack for popup

import { useState } from 'react';
import Script       from 'next/script';
import { boosts, type BoostPlan } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';

declare global {
  interface Window {
    PaystackPop: {
      setup(cfg: {
        key:       string;
        email:     string;
        amount:    number;
        currency:  string;
        ref:       string;
        onSuccess: (tx: { reference: string }) => void;
        onCancel:  () => void;
      }): { openIframe(): void };
    };
  }
}

interface Props {
  trackId: string;
  plan:    BoostPlan;
}

export default function BoostButton({ trackId, plan }: Props) {
  const [loading,     setLoading]     = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [result,      setResult]      = useState<{ success: boolean; endsAt?: string } | null>(null);
  const supabase = createClient();

  const handleBoost = async () => {
    if (!scriptReady) return;
    setLoading(true);

    try {
      // Get JWT from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/auth/login'; return; }
      const jwt = session.access_token;

      // ── Layer 1: Get Paystack config from Railway API ──────────────────
      const config = await boosts.initiate({ track_id: trackId, plan }, jwt);

      // ── Layer 2: Open Paystack popup ────────────────────────────────────
      const handler = window.PaystackPop.setup({
        key:      config.public_key,
        email:    config.email,
        amount:   config.amount_kobo,
        currency: 'NGN',
        ref:      config.reference,

        onSuccess: async (tx) => {
          // ── Layer 3: Verify with Railway API ───────────────────────────
          try {
            const verified = await boosts.verify(
              { reference: tx.reference, boost_id: config.boost_id },
              jwt,
            );
            setResult({ success: true, endsAt: verified.ends_at });
          } catch {
            // Webhook will catch this — show a softer message
            setResult({ success: true });
          }
          setLoading(false);
        },

        onCancel: () => setLoading(false),
      });

      handler.openIframe();
    } catch (err: unknown) {
      console.error('[boost]', err);
      setLoading(false);
    }
  };

  if (result?.success) {
    return (
      <div className="rounded-xl bg-green-950/50 border border-green-500/20 p-4 text-center">
        <p className="font-bold text-green-400">⚡ Boost Active!</p>
        {result.endsAt && (
          <p className="text-xs text-gray-400 mt-1">
            Ends: {new Date(result.endsAt).toLocaleDateString()}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <Script
        src="https://js.paystack.co/v1/inline.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <button
        onClick={handleBoost}
        disabled={loading || !scriptReady}
        className="btn-boost w-full disabled:opacity-50"
      >
        {loading ? 'Processing…' : `⚡ Boost (${plan})`}
      </button>
    </>
  );
}
