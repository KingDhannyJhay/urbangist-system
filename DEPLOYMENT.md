# UrbanGist System — Deployment Guide
## Railway (API + Worker) + Cloudflare Pages (Web) + Supabase

---

## ARCHITECTURE OVERVIEW

```
                    ┌─────────────────────────────────┐
                    │     Cloudflare Pages (Web)       │
                    │   Next.js — urbangist.com.ng     │
                    │                                  │
                    │  Server Components → fetch API   │
                    │  Client Components → fetch API   │
                    └──────────────┬──────────────────┘
                                   │ HTTPS
                    ┌──────────────▼──────────────────┐
                    │       Railway (API Service)       │
                    │   Node.js Express — port 3001    │
                    │                                  │
                    │  /tracks  /boosts  /interactions │
                    │  /admin   /webhooks/paystack     │
                    └──────┬──────────────┬───────────┘
                           │              │
              ┌────────────▼──┐    ┌──────▼──────────────────┐
              │  Railway      │    │     Supabase             │
              │  (Worker)     │    │  Postgres + Auth +       │
              │               │    │  Storage (S3-compatible) │
              │  FFmpeg jobs  │    │                          │
              │  Rankings     │    │  Buckets:                │
              │  Expiry cron  │◄───│  - raw-uploads           │
              └───────────────┘    │  - processed-audio       │
                                   │  - track-previews        │
                                   │  - track-covers          │
                                   │  - waveforms             │
                                   └──────────────────────────┘
```

---

## PART 1: SUPABASE SETUP

### 1.1 Create Project
1. Go to https://supabase.com → New Project
2. Name: `urbangist`, Region: closest to Nigeria (US East / EU West)
3. Save your database password

### 1.2 Run Migrations
In Supabase SQL Editor, run in order:
```
db/migrations/001_schema.sql
db/migrations/002_functions.sql
```

### 1.3 Create Storage Buckets
Run in SQL Editor:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('raw-uploads',     'raw-uploads',     false, 524288000, NULL),
  ('processed-audio', 'processed-audio', true,  52428800,  ARRAY['audio/mpeg','audio/mp4']),
  ('track-previews',  'track-previews',  true,  10485760,  ARRAY['audio/mpeg']),
  ('track-covers',    'track-covers',    true,  5242880,   ARRAY['image/jpeg','image/png','image/webp']),
  ('waveforms',       'waveforms',       true,  524288,    ARRAY['application/json']),
  ('article-images',  'article-images',  true,  5242880,   ARRAY['image/jpeg','image/png','image/webp']);
```

Then add storage RLS policies in Supabase Dashboard → Storage → Policies:
- `raw-uploads`: INSERT for authenticated users, SELECT for service role only
- All other buckets: SELECT for public, INSERT for authenticated

### 1.4 Get Your Keys
Dashboard → Project Settings → API:
- Project URL
- anon public key
- service_role key (keep secret)

### 1.5 Set First Admin
After signing up, run:
```sql
UPDATE profiles SET role = 'admin' WHERE username = 'your-username';
```

---

## PART 2: RAILWAY — API SERVICE

### 2.1 Create Account
https://railway.app → sign up

### 2.2 Create New Project
Railway Dashboard → New Project → Deploy from GitHub repo

### 2.3 Create API Service
1. New Service → GitHub Repo → Select `urbangist-system`
2. Set **Root Directory**: `/api`
3. Railway will auto-detect Node.js via nixpacks

### 2.4 Set Environment Variables
Railway → API Service → Variables → Add all from `api/.env.example`:
```
NODE_ENV              = production
SUPABASE_URL          = https://xxx.supabase.co
SUPABASE_ANON_KEY     = eyJ...
SUPABASE_SERVICE_ROLE_KEY = eyJ...
PAYSTACK_PUBLIC_KEY   = pk_live_...
PAYSTACK_SECRET_KEY   = sk_live_...
FRONTEND_URL          = https://urbangist.com.ng
IP_HASH_SALT          = (openssl rand -hex 32)
```

### 2.5 Verify Deployment
Visit your Railway URL → `/health` should return:
```json
{ "status": "ok", "service": "urbangist-api" }
```

---

## PART 3: RAILWAY — WORKER SERVICE

### 3.1 Create Worker Service (same Railway project)
Railway Dashboard → your project → New Service → GitHub Repo
Set **Root Directory**: `/worker`

### 3.2 Set Environment Variables
```
NODE_ENV                  = production
SUPABASE_URL              = (same as API)
SUPABASE_SERVICE_ROLE_KEY = (same as API)
```

### 3.3 Verify FFmpeg Installation
Check Worker logs for:
```
[worker] UrbanGist Worker starting…
[worker] Job types: process_audio, recalc_rankings, expire_boosts, cleanup_failed
```

### 3.4 Test FFmpeg
Submit a test track upload and watch Worker logs for:
```
[audio] Downloading uploads/...
[audio] ✓ Compression complete
[audio] ✓ Preview generated
[audio] ✓ Waveform generated
[audio] ✓ Track xxx processing complete.
```

---

## PART 4: CLOUDFLARE PAGES — WEB FRONTEND

### 4.1 Create Cloudflare Account
https://cloudflare.com → Sign up (free)

### 4.2 Connect GitHub
Cloudflare Dashboard → Pages → Create application → Connect to Git
Select your `urbangist-system` repo

### 4.3 Build Configuration
```
Framework preset:    Next.js
Build command:       cd web && npm run build
Build output dir:    web/.vercel/output/static
Root directory:      /
```

### 4.4 Set Environment Variables
Cloudflare Pages → Settings → Environment Variables:
```
NEXT_PUBLIC_SUPABASE_URL      = https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJ...
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY = pk_live_...
NEXT_PUBLIC_SITE_URL          = https://urbangist.com.ng
API_URL                       = https://urbangist-api.up.railway.app
```

### 4.5 Custom Domain
Cloudflare Pages → Custom domains → Add `urbangist.com.ng`
Update your DNS to point to Cloudflare Pages.

---

## PART 5: PAYSTACK WEBHOOK

### 5.1 Set Webhook URL
Paystack Dashboard → Settings → API Keys & Webhooks:
```
Webhook URL: https://urbangist-api.up.railway.app/webhooks/paystack
```

### 5.2 Test
Use Paystack test dashboard to send a test `charge.success` event.
Check Railway API logs for:
```
[webhook] Backup activation complete: xxx
```

---

## PART 6: VERIFY END-TO-END FLOW

### Test upload pipeline:
1. Sign up at `urbangist.com.ng/auth/signup`
2. Upload a track at `/upload`
3. Check Supabase → `tracks` table: status = 'pending'
4. Check Supabase → `job_queue` table: job_type = 'process_audio'
5. Watch Worker logs: FFmpeg processing output
6. Check Supabase → `tracks`: audio_url, preview_url, waveform_url populated
7. Go to `/admin` → approve the track
8. Track appears in feed at `/`

### Test boost flow:
1. Go to `/boost`
2. Select track + plan
3. Pay with Paystack test card: `4084 0840 8408 4081`
4. Check Supabase → `boosts`: status = 'active'
5. Check `tracks`: boost_multiplier updated

---

## PART 7: MONITORING

### Railway Logs
- API: Railway Dashboard → API service → Logs tab
- Worker: Railway Dashboard → Worker service → Logs tab

### Railway Metrics
- Railway Dashboard → Metrics: CPU, Memory, Network per service

### Supabase
- Dashboard → Database → Query editor for manual investigation
- Dashboard → Storage → Usage metrics
- Dashboard → Auth → Users

### Dead jobs (processing failures)
```sql
SELECT * FROM job_queue WHERE status = 'dead' ORDER BY created_at DESC;
```

### Stuck processing jobs
```sql
SELECT * FROM tracks WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes';
```

---

## PART 8: SCALING

When you outgrow Railway Hobby:

### API
- Scale to multiple Railway replicas (Railway Pro)
- Add Redis for rate limiting (replaces in-memory Map)
- Add connection pooling: PgBouncer via Supabase pooler

### Worker
- Run multiple Worker instances (job queue uses SKIP LOCKED — safe)
- Separate worker types: one for audio, one for rankings

### Database
- Supabase Pro: more connections, daily backups, point-in-time recovery
- Add read replicas for analytics queries

### CDN
- Supabase Storage already uses Cloudflare CDN for `processed-audio`
- For very high traffic: mirror to Cloudflare R2

---

*UrbanGist System Architecture v1.0*
