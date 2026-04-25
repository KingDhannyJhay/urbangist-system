import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  console.error('[api] Unhandled error:', err.message, err.stack);

  // Don't leak internal details in production
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    error:   'Internal server error.',
    message: isDev ? err.message : undefined,
    stack:   isDev ? err.stack   : undefined,
  });
};
