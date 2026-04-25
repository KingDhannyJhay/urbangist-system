/**
 * lib/supabase/server.ts
 *
 * Server-only Supabase client.
 * Import ONLY in: Server Components, Route Handlers, Server Actions.
 * NEVER import in 'use client' components.
 *
 * Uses `await cookies()` — required by Next.js 15+ (cookies() is now async).
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) =>
          cookieStore.get(name)?.value,
        set: (name: string, value: string, opts: CookieOptions) => {
          try { cookieStore.set({ name, value, ...opts }); } catch { /* read-only context */ }
        },
        remove: (name: string, opts: CookieOptions) => {
          try { cookieStore.set({ name, value: '', ...opts }); } catch { /* read-only context */ }
        },
      },
    }
  );
}

/**
 * Get the current user's JWT access token for Railway API calls.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
