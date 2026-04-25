/**
 * lib/supabase/client.ts — Browser-only Supabase client.
 *
 * Safe to import in 'use client' components.
 * Has zero server-only dependencies (no next/headers, no cookies()).
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
