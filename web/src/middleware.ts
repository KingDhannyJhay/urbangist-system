import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_ROUTES = ['/dashboard', '/upload', '/boost'];
const ADMIN_ROUTES     = ['/admin'];
const AUTH_ROUTES      = ['/auth/login', '/auth/signup'];

function matches(pathname: string, routes: string[]): boolean {
  return routes.some(r => pathname === r || pathname.startsWith(r + '/'));
}

// Explicit type for the setAll cookie parameter.
// Inlined to avoid dependency on @supabase/ssr's internal type exports,
// which vary between versions. This satisfies TypeScript strict mode.
type CookieToSet = {
  name:    string;
  value:   string;
  options?: Partial<{
    domain:   string;
    expires:  Date;
    httpOnly: boolean;
    maxAge:   number;
    path:     string;
    sameSite: 'strict' | 'lax' | 'none' | boolean;
    secure:   boolean;
  }>;
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() validates the JWT server-side — safe for auth gating
  const { data: { user } } = await supabase.auth.getUser();

  // Redirect authenticated users away from auth pages
  if (matches(pathname, AUTH_ROUTES) && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Require authentication for protected routes
  if (matches(pathname, [...PROTECTED_ROUTES, ...ADMIN_ROUTES]) && !user) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin routes: verify role via Supabase directly (no external fetch — Edge-safe)
  if (matches(pathname, ADMIN_ROUTES) && user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.redirect(new URL('/?error=forbidden', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon\\.ico|images/|fonts/|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
