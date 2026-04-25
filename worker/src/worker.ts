import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { processAudioJob }     from './processors/audio.js';
import { recalcRankingsJob }   from './processors/rankings.js';
import { expireBoostsJob }     from './processors/boosts.js';
import { cleanupFailedJob }    from './processors/cleanup.js';

// ─── Supabase admin client ────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export { supabase };

// ─── Job dispatcher ───────────────────────────────────────────────────────────
type JobType = 'process_audio' | 'recalc_rankings' | 'expire_boosts' | 'cleanup_failed';

const handlers: Record<JobType, (payload: Record<string, unknown>) => Promise<void>> = {
  process_audio:   processAudioJob,
  recalc_rankings: recalcRankingsJob,
  expire_boosts:   expireBoostsJob,
  cleanup_failed:  cleanupFailedJob,
};

interface Job {
  id:          string;
  job_type:    JobType;
  payload:     Record<string, unknown>;
  attempts:    number;
  max_attempts: number;
}

async function processNextJob(jobType?: JobType): Promise<boolean> {
  // Atomic claim using SKIP LOCKED — safe for multiple worker instances
  const { data: jobs, error } = await supabase.rpc('claim_next_job', {
    p_job_type: jobType ?? null,
  });

  if (error) {
    console.error('[worker] claim_next_job error:', error.message);
    return false;
  }

  const job = jobs?.[0] as Job | undefined;
  if (!job) return false;

  const handler = handlers[job.job_type];
  if (!handler) {
    console.error(`[worker] No handler for job type: ${job.job_type}`);
    await markJobDead(job.id, `No handler for job type: ${job.job_type}`);
    return true;
  }

  console.log(`[worker] Processing job ${job.id} type=${job.job_type} attempt=${job.attempts}`);

  try {
    await handler(job.payload);
    await supabase
      .from('job_queue')
      .update({ status: 'done', finished_at: new Date().toISOString() })
      .eq('id', job.id);
    console.log(`[worker] ✓ Job ${job.id} completed.`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] ✗ Job ${job.id} failed:`, errorMsg);

    if (job.attempts >= job.max_attempts) {
      await markJobDead(job.id, errorMsg);
    } else {
      // Exponential backoff: 1min, 5min, 25min
      const backoffMin  = Math.pow(5, job.attempts - 1);
      const runAfter    = new Date(Date.now() + backoffMin * 60_000);
      await supabase.from('job_queue').update({
        status:     'pending',
        last_error: errorMsg,
        run_after:  runAfter.toISOString(),
      }).eq('id', job.id);
    }
  }

  return true;
}

async function markJobDead(jobId: string, error: string): Promise<void> {
  await supabase.from('job_queue').update({
    status:      'dead',
    last_error:  error,
    finished_at: new Date().toISOString(),
  }).eq('id', jobId);
  console.error(`[worker] ☠ Job ${jobId} marked dead after max attempts.`);
}

// ─── Main polling loop ────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('[worker] UrbanGist Worker starting…');
  console.log('[worker] Job types:', Object.keys(handlers).join(', '));

  // Graceful shutdown
  process.on('SIGTERM', () => { console.log('[worker] SIGTERM — shutting down.'); process.exit(0); });
  process.on('SIGINT',  () => { console.log('[worker] SIGINT — shutting down.');  process.exit(0); });

  // ── Cron jobs on fixed intervals ──────────────────────────────────────────
  // These enqueue DB jobs rather than running directly, keeping the loop clean.

  // Expire boosts every 5 minutes
  setInterval(async () => {
    await supabase.from('job_queue').insert({
      job_type:  'expire_boosts',
      payload:   {},
      run_after: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }, 5 * 60_000);

  // Recalculate all rankings every 30 minutes
  setInterval(async () => {
    await supabase.from('job_queue').insert({
      job_type: 'recalc_rankings',
      payload:  { scope: 'all' },
      run_after: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }, 30 * 60_000);

  // Clean up dead uploads every 6 hours
  setInterval(async () => {
    await supabase.from('job_queue').insert({
      job_type:  'cleanup_failed',
      payload:   {},
      run_after: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }, 6 * 60 * 60_000);

  // ── Main poll loop ────────────────────────────────────────────────────────
  let idleCycles = 0;
  while (true) {
    const processed = await processNextJob();

    if (processed) {
      idleCycles = 0;
    } else {
      idleCycles++;
      // Backoff: idle 1s → 2s → 4s → max 10s
      const waitMs = Math.min(1000 * Math.pow(2, Math.min(idleCycles - 1, 3)), 10_000);
      await sleep(waitMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
