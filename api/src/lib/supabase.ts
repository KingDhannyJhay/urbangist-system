import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.SUPABASE_URL!;
const SUPABASE_ANON     = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
}

/**
 * Admin client — bypasses RLS.
 * Use for: webhooks, background jobs, admin routes.
 * NEVER expose to frontend or use for user-initiated actions.
 */
export const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Anon client — respects RLS.
 * Use for: building user-scoped queries in non-admin routes.
 */
export const anonSupabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/**
 * Build a Supabase client authenticated as a specific user (via their JWT).
 * Used in routes where actions must be scoped to the calling user.
 */
export function userSupabase(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { autoRefreshToken: false, persistSession: false },
  });
}
