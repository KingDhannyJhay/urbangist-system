# UrbanGist — Database Migrations

Run these in Supabase SQL Editor **in exact order**.
Each file depends on the previous one existing.

---

## Run Order

### 001_schema.sql — Core tables + RLS + triggers
Creates every table the platform needs:
- `profiles` — artist accounts (extends Supabase auth.users)
- `tracks` — music uploads with full status workflow (pending → processing → approved → rejected)
- `interactions` — plays, likes, shares, downloads (drives ranking)
- `boosts` — Paystack promotion records
- `ranking_cache` — pre-computed scores (never calculated per-request)
- `job_queue` — background jobs for FFmpeg worker
- `notifications` — in-app alerts
- `articles` — Learn section blog posts

Also creates:
- All Row Level Security policies
- `handle_new_user()` trigger — auto-creates profile on signup
- `sync_interaction_counters()` trigger — keeps play/like/share counts accurate
- `enqueue_audio_processing()` trigger — auto-creates FFmpeg job on upload
- `claim_next_job()` RPC — atomic job queue claim (SKIP LOCKED)
- `expire_finished_boosts()` RPC — called by worker every 5 minutes

### 002_functions.sql — Analytics + ranking helpers
- `get_track_analytics()` — full analytics aggregate per track
- `update_rank_positions()` — assigns rank integers after recalculation
- `get_artist_dashboard()` — dashboard summary RPC
- `cleanup_abandoned_uploads()` — removes stuck pending tracks
- `mv_hot_tracks` — materialized view for high-performance feed queries

### 003_score_triggers.sql — Ranking decay formula in SQL
- `calculate_rank_score()` — the scoring formula as a pure SQL function
- `trg_update_rank_score` — auto-recalculates score on every stat change
- `recalc_all_scores()` — bulk recalculation RPC (called by worker)

**Formula:**
```
score = (plays × 1 + likes × 2 + shares × 4)
      × EXP(-LN(2) × age_hours / 72)
      × boost_multiplier
```

### 004_storage_and_policies.sql — Storage buckets + extra indexes
- Creates all 6 Supabase Storage buckets with MIME type restrictions
- Adds storage RLS policies (public read, authenticated upload, owner delete)
- `increment_track_stat()` — race-condition-safe counter increment
- `increment_article_view()` — article view counter
- `sync_like_count` trigger — keeps like_count in sync with likes table
- Full-text search indexes on tracks and profiles
- Extra performance indexes

---

## How to run

1. Go to **Supabase Dashboard → SQL Editor**
2. Click **New query**
3. Copy-paste the full content of `001_schema.sql`
4. Click **Run** — verify success
5. Repeat for `002_functions.sql`, `003_score_triggers.sql`, `004_storage_and_policies.sql`

---

## After running all migrations

Set yourself as admin:
```sql
-- Find your user ID
SELECT id, username FROM profiles ORDER BY created_at LIMIT 5;

-- Make yourself admin (replace with your actual UUID)
UPDATE profiles SET role = 'admin' WHERE id = 'your-uuid-here';
```

Verify the job queue trigger works:
```sql
-- Should show the process_audio job type
SELECT * FROM job_queue ORDER BY created_at DESC LIMIT 5;
```

Test the ranking formula:
```sql
SELECT calculate_rank_score(100, 20, 50, 2.0, NOW() - INTERVAL '24 hours', NOW() - INTERVAL '48 hours');
-- Should return a positive decimal number
```
