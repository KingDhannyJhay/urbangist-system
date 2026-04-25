import { Request, Response, NextFunction } from 'express';
import { adminSupabase } from '../lib/supabase.js';

export interface AuthenticatedRequest extends Request {
  user: {
    id:    string;
    email: string;
    role:  string;
  };
  jwt: string;
}

/**
 * Validates the Supabase JWT from the Authorization header.
 * Attaches req.user and req.jwt on success.
 *
 * Usage: app.use('/admin', authMiddleware, adminRouter);
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header missing or malformed.' });
    return;
  }

  const jwt = authHeader.slice(7);

  // Verify token with Supabase (validates signature + expiry)
  const { data: { user }, error } = await adminSupabase.auth.getUser(jwt);

  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  // Fetch profile for role check
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  (req as AuthenticatedRequest).user = {
    id:    user.id,
    email: user.email ?? '',
    role:  profile?.role ?? 'artist',
  };
  (req as AuthenticatedRequest).jwt = jwt;

  next();
}

/**
 * Requires admin role after authMiddleware has run.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  next();
}

/**
 * Optional auth — attaches user if JWT present, continues either way.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const jwt = authHeader.slice(7);
    const { data: { user } } = await adminSupabase.auth.getUser(jwt);
    if (user) {
      const { data: profile } = await adminSupabase
        .from('profiles').select('role').eq('id', user.id).single();
      (req as AuthenticatedRequest).user = {
        id: user.id, email: user.email ?? '', role: profile?.role ?? 'artist',
      };
      (req as AuthenticatedRequest).jwt = jwt;
    }
  }
  next();
}
