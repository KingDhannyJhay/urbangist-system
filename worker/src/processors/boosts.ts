import { supabase } from '../worker.js';

// ─── Expire finished boosts ────────────────────────────────────────────────────
export async function expireBoostsJob(_payload: Record<string, unknown>): Promise<void> {
  console.log('[boosts] Running expiry check…');

  const { data, error } = await supabase.rpc('expire_finished_boosts');
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  console.log(`[boosts] ✓ Expired ${result?.expired_count ?? 0} boosts, reset ${result?.reset_count ?? 0} tracks.`);
}

// ─── Clean up failed/stuck uploads ────────────────────────────────────────────
export async function cleanupFailedJob(_payload: Record<string, unknown>): Promise<void> {
  console.log('[cleanup] Running failed upload cleanup…');

  // Tracks stuck in 'processing' for over 30 minutes — something crashed
  const stuckCutoff = new Date(Date.now() - 30 * 60_000).toISOString();

  const { data: stuckTracks, error } = await supabase
    .from('tracks')
    .select('id, raw_audio_path')
    .eq('status', 'processing')
    .lt('updated_at', stuckCutoff);

  if (error) throw error;

  if (!stuckTracks || stuckTracks.length === 0) {
    console.log('[cleanup] No stuck tracks found.');
    return;
  }

  console.log(`[cleanup] Found ${stuckTracks.length} stuck tracks. Re-queuing…`);

  for (const track of stuckTracks) {
    // Re-queue audio processing
    await supabase.from('job_queue').insert({
      job_type: 'process_audio',
      payload:  { track_id: track.id, raw_audio_path: track.raw_audio_path },
      run_after: new Date().toISOString(),
    });

    // Reset status back to pending so user sees it in queue
    await supabase.from('tracks').update({
      status: 'pending',
    }).eq('id', track.id);
  }

  // Also clean up dead jobs older than 7 days
  const deadCutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const { error: deleteErr } = await supabase
    .from('job_queue')
    .delete()
    .eq('status', 'dead')
    .lt('created_at', deadCutoff);

  if (deleteErr) {
    console.warn('[cleanup] Failed to delete old dead jobs:', deleteErr.message);
  }

  console.log('[cleanup] ✓ Cleanup complete.');
}
