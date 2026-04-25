import ffmpeg     from 'fluent-ffmpeg';
import fs          from 'fs';
import path        from 'path';
import os          from 'os';
import { supabase } from '../worker.js';

interface AudioJobPayload {
  track_id:       string;
  raw_audio_path: string;
}

/**
 * Full audio processing pipeline:
 * 1. Download raw upload from Supabase Storage
 * 2. Compress to 128kbps MP3 (distribution quality)
 * 3. Generate 30-second preview clip (starting at 30s or 0s)
 * 4. Generate waveform JSON (peaks array for visualisation)
 * 5. Upload all outputs to Supabase Storage
 * 6. Update track record with public URLs
 */
export async function processAudioJob(payload: Record<string, unknown>): Promise<void> {
  const { track_id, raw_audio_path } = payload as AudioJobPayload;

  if (!track_id || !raw_audio_path) {
    throw new Error('processAudioJob: missing track_id or raw_audio_path');
  }

  // Mark track as processing
  await supabase.from('tracks')
    .update({ status: 'processing' })
    .eq('id', track_id);

  // Create temp working directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ug-${track_id}-`));

  try {
    // ── Step 1: Download raw audio ────────────────────────────────────────
    const rawExt     = path.extname(raw_audio_path) || '.mp3';
    const rawLocal   = path.join(tmpDir, `raw${rawExt}`);

    console.log(`[audio] Downloading ${raw_audio_path}…`);
    const { data: rawData, error: dlErr } = await supabase.storage
      .from('raw-uploads')
      .download(raw_audio_path);

    if (dlErr || !rawData) throw new Error(`Download failed: ${dlErr?.message}`);

    const arrayBuf = await rawData.arrayBuffer();
    fs.writeFileSync(rawLocal, Buffer.from(arrayBuf));
    console.log(`[audio] Downloaded ${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)} MB`);

    // Get audio duration before processing
    const durationSec = await getAudioDuration(rawLocal);
    console.log(`[audio] Duration: ${durationSec.toFixed(1)}s`);

    // ── Step 2: Compress to 128kbps MP3 ──────────────────────────────────
    const processedLocal = path.join(tmpDir, 'processed.mp3');
    await compressAudio(rawLocal, processedLocal);
    console.log('[audio] ✓ Compression complete');

    // ── Step 3: Generate 30s preview clip ────────────────────────────────
    const previewLocal = path.join(tmpDir, 'preview.mp3');
    const previewStart = Math.min(30, Math.max(0, durationSec * 0.15)); // start at 15% mark
    await generatePreview(rawLocal, previewLocal, previewStart, 30);
    console.log('[audio] ✓ Preview generated');

    // ── Step 4: Generate waveform JSON ────────────────────────────────────
    const waveformLocal = path.join(tmpDir, 'waveform.json');
    await generateWaveform(rawLocal, waveformLocal);
    console.log('[audio] ✓ Waveform generated');

    // ── Step 5: Upload outputs to Supabase Storage ────────────────────────
    const basePath   = raw_audio_path.replace(/\/raw\.[^/]+$/, ''); // strip filename
    const processedPath = `${basePath}/processed.mp3`;
    const previewPath   = `${basePath}/preview.mp3`;
    const waveformPath  = `${basePath}/waveform.json`;

    const [upProc, upPrev, upWave] = await Promise.all([
      supabase.storage.from('processed-audio').upload(
        processedPath,
        fs.readFileSync(processedLocal),
        { contentType: 'audio/mpeg', upsert: true }
      ),
      supabase.storage.from('track-previews').upload(
        previewPath,
        fs.readFileSync(previewLocal),
        { contentType: 'audio/mpeg', upsert: true }
      ),
      supabase.storage.from('waveforms').upload(
        waveformPath,
        fs.readFileSync(waveformLocal),
        { contentType: 'application/json', upsert: true }
      ),
    ]);

    if (upProc.error) throw new Error(`Processed upload failed: ${upProc.error.message}`);
    if (upPrev.error) throw new Error(`Preview upload failed: ${upPrev.error.message}`);
    if (upWave.error) throw new Error(`Waveform upload failed: ${upWave.error.message}`);

    // ── Step 6: Get public URLs ────────────────────────────────────────────
    const audioUrl    = supabase.storage.from('processed-audio').getPublicUrl(processedPath).data.publicUrl;
    const previewUrl  = supabase.storage.from('track-previews').getPublicUrl(previewPath).data.publicUrl;
    const waveformUrl = supabase.storage.from('waveforms').getPublicUrl(waveformPath).data.publicUrl;

    // ── Step 7: Update track record ───────────────────────────────────────
    const { error: updateErr } = await supabase.from('tracks').update({
      audio_path:      processedPath,
      preview_path:    previewPath,
      waveform_path:   waveformPath,
      audio_url:       audioUrl,
      preview_url:     previewUrl,
      waveform_url:    waveformUrl,
      duration_sec:    Math.round(durationSec),
      file_size_bytes: fs.statSync(processedLocal).size,
      audio_format:    'mp3',
      status:          'pending',   // back to pending — awaits admin approval
    }).eq('id', track_id);

    if (updateErr) throw new Error(`Track update failed: ${updateErr.message}`);

    // Notify admins
    const { data: admins } = await supabase
      .from('profiles').select('id').eq('role', 'admin');

    if (admins?.length) {
      await supabase.from('notifications').insert(
        admins.map(a => ({
          user_id: a.id,
          type:    'track_ready_for_review',
          title:   '🎵 New track ready for review',
          body:    `Track ${track_id} has been processed and awaits approval.`,
          link:    '/admin',
        }))
      );
    }

    console.log(`[audio] ✓ Track ${track_id} processing complete.`);

  } finally {
    // Always clean up temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── FFmpeg helpers ───────────────────────────────────────────────────────────

function getAudioDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration ?? 0);
    });
  });
}

/**
 * Compress to 128kbps stereo MP3.
 * -q:a 2 = ~190kbps VBR (better quality/size ratio than CBR 128)
 * -ar 44100 = standard sample rate
 * -ac 2 = stereo
 */
function compressAudio(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec('libmp3lame')
      .audioFrequency(44100)
      .audioChannels(2)
      .audioBitrate('128k')
      .outputOptions([
        '-map_metadata', '-1',     // strip metadata to reduce file size
        '-id3v2_version', '3',
      ])
      .on('error', reject)
      .on('end', resolve)
      .save(output);
  });
}

/**
 * Generate a 30-second preview clip.
 * -ss: start time, -t: duration
 * Fade in 0.5s, fade out 1s to avoid abrupt cuts.
 */
function generatePreview(
  input:  string,
  output: string,
  start:  number,
  durationSec: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .seekInput(start)
      .duration(durationSec)
      .audioCodec('libmp3lame')
      .audioFrequency(44100)
      .audioChannels(2)
      .audioBitrate('96k')
      .audioFilters([
        `afade=t=in:st=0:d=0.5`,               // fade in
        `afade=t=out:st=${durationSec - 1}:d=1`, // fade out
      ])
      .on('error', reject)
      .on('end', resolve)
      .save(output);
  });
}

/**
 * Generate waveform data as JSON peaks array.
 * Uses ebur128 filter to extract amplitude at ~100 points per second
 * then downsamples to 800 peaks for frontend visualisation.
 *
 * Output format: { peaks: number[], duration: number, samples: number }
 */
function generateWaveform(input: string, outputJson: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const amplitudes: number[] = [];

    ffmpeg(input)
      .audioFilters('aresample=8000,asetnsamples=100,astats=metadata=1:reset=1')
      .format('null')
      .output('/dev/null')
      .on('error', reject)
      .on('stderr', (line: string) => {
        // Parse RMS peak from astats output
        const match = line.match(/RMS_peak\s*=\s*([0-9.e+-]+)/);
        if (match) {
          const dbValue = parseFloat(match[1]);
          // Convert dB to 0–1 range (dB is negative, -90dBFS = silence)
          const normalized = Math.pow(10, dbValue / 20);
          amplitudes.push(Math.min(1, Math.max(0, normalized)));
        }
      })
      .on('end', () => {
        // Downsample to max 800 peaks
        const targetPeaks = 800;
        const peaks = downsample(amplitudes, targetPeaks);
        const waveform = {
          peaks,
          duration: 0, // will be filled from track metadata
          samples:  peaks.length,
          generated_at: new Date().toISOString(),
        };
        fs.writeFileSync(outputJson, JSON.stringify(waveform));
        resolve();
      })
      .run();
  });
}

function downsample(data: number[], targetLength: number): number[] {
  if (data.length <= targetLength) return data;
  const factor = data.length / targetLength;
  return Array.from({ length: targetLength }, (_, i) => {
    const start = Math.floor(i * factor);
    const end   = Math.floor((i + 1) * factor);
    const slice = data.slice(start, end);
    return slice.reduce((a, b) => Math.max(a, b), 0); // peak within bucket
  });
}
