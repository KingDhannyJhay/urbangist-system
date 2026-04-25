/**
 * lib/supabase.ts — browser-only re-export (safe for 'use client').
 *
 * Only exports createClient (browser). Server functions live exclusively
 * in lib/supabase/server.ts and must be imported from there directly.
 * This prevents next/headers from bleeding into the client bundle.
 */
export { createClient } from '@/lib/supabase/client';
