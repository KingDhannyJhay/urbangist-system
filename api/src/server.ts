import 'dotenv/config';
import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import morgan       from 'morgan';
import { rateLimit } from 'express-rate-limit';

import { tracksRouter }       from './routes/tracks.js';
import { interactionsRouter } from './routes/interactions.js';
import { boostsRouter }       from './routes/boosts.js';
import { adminRouter }        from './routes/admin.js';
import { webhooksRouter }     from './routes/webhooks.js';
import { profilesRouter }     from './routes/profiles.js';
import { learnRouter }        from './routes/learn.js';
import { authMiddleware }     from './middleware/auth.js';
import { errorHandler }       from './middleware/error.js';

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ─── Trust proxy (Railway reverse proxy) ─────────────────────────────────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,  // allow audio streaming
  contentSecurityPolicy:     false,  // set by frontend/CDN
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL ?? 'https://urbangist.com.ng')
  .split(',')
  .map(s => s.trim())
  .concat(['http://localhost:3000', 'http://localhost:3001']);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Webhook MUST receive raw Buffer for HMAC — mount before json()
app.use('/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Global rate limiting ─────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs:        60_000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please slow down.' },
  skip:            (req) => req.path === '/health',
}));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    service: 'urbangist-api',
    version: process.env.npm_package_version ?? '1.0.0',
    ts:      new Date().toISOString(),
  });
});

// ─── Public routes ────────────────────────────────────────────────────────────
app.use('/tracks',       tracksRouter);
app.use('/interactions', interactionsRouter);
app.use('/learn',        learnRouter);
app.use('/profiles',     profilesRouter);   // /me subroutes use authMiddleware internally

// ─── Authenticated routes ─────────────────────────────────────────────────────
app.use('/boosts',       boostsRouter);     // individual handlers use authMiddleware

// ─── Admin routes — require auth + admin role ─────────────────────────────────
app.use('/admin',        authMiddleware, adminRouter);

// ─── Webhook — raw body, HMAC verified inside handler ────────────────────────
app.use('/webhooks',     webhooksRouter);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] UrbanGist API listening on port ${PORT}`);
  console.log(`[api] Environment: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[api] CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

export default app;
