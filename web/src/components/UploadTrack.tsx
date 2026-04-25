'use client';

// components/UploadTrack.tsx
// Files go: Browser → Supabase Storage (direct, via presigned URL)
// Metadata goes: Browser → Railway API → Supabase DB
// FFmpeg processing: Railway API enqueues job → Worker picks it up

import { useState } from 'react';
import { tracks }            from '@/lib/api';
import { createClient }      from '@/lib/supabase/client';

interface UploadState {
  phase:    'idle' | 'presign' | 'uploading_cover' | 'uploading_audio' | 'saving' | 'done' | 'error';
  progress: number;
  error?:   string;
  trackSlug?: string;
}

export default function UploadTrack() {
  const [form, setForm] = useState({
    title: '', genre: '', description: '',
  });
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [state,     setState]     = useState<UploadState>({ phase: 'idle', progress: 0 });
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coverFile || !audioFile) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/auth/login'; return; }
      const jwt = session.access_token;

      // ── Step 1: Get presigned upload URLs from Railway API ────────────
      setState({ phase: 'presign', progress: 5 });
      const upload = await tracks.initiateUpload({
        title:      form.title,
        genre:      form.genre,
        description: form.description,
        cover_mime: coverFile.type,
        audio_mime: audioFile.type,
      }, jwt);

      // ── Step 2: Upload cover to Supabase Storage (direct from browser) ─
      setState({ phase: 'uploading_cover', progress: 20 });
      const coverUpload = await fetch(upload.upload.cover.signed_url, {
        method:  'PUT',
        headers: { 'Content-Type': coverFile.type },
        body:    coverFile,
      });
      if (!coverUpload.ok) throw new Error('Cover upload failed.');

      // ── Step 3: Upload audio to Supabase Storage (direct from browser) ─
      // Large files (up to 500MB) go directly to Supabase — API is never the bottleneck
      setState({ phase: 'uploading_audio', progress: 40 });
      const audioUpload = await fetch(upload.upload.audio.signed_url, {
        method:  'PUT',
        headers: { 'Content-Type': audioFile.type },
        body:    audioFile,
      });
      if (!audioUpload.ok) throw new Error('Audio upload failed.');

      // ── Step 4: Mark upload complete (Railway API updates DB) ─────────
      // The DB trigger (enqueue_audio_processing) fires automatically,
      // adding a job_queue row. Worker picks it up for FFmpeg processing.
      setState({ phase: 'saving', progress: 90 });

      setState({ phase: 'done', progress: 100, trackSlug: upload.track.slug });
    } catch (err: unknown) {
      setState({
        phase:    'error',
        progress: 0,
        error:    err instanceof Error ? err.message : 'Upload failed.',
      });
    }
  };

  if (state.phase === 'done') {
    return (
      <div className="card p-8 text-center">
        <p className="text-2xl mb-2">✅ Submitted!</p>
        <p className="text-gray-400 mb-4">
          Your track is processing. It will be ready for review within a few minutes.
        </p>
        <a href={`/track/${state.trackSlug}`} className="btn-primary">
          View Track Page
        </a>
      </div>
    );
  }

  const isUploading = ['presign','uploading_cover','uploading_audio','saving'].includes(state.phase);

  return (
    <form onSubmit={handleSubmit} className="card p-8 space-y-5 max-w-xl">
      <div>
        <label className="label">Title *</label>
        <input className="input" value={form.title}
          onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />
      </div>
      <div>
        <label className="label">Genre *</label>
        <input className="input" value={form.genre}
          onChange={e => setForm(p => ({ ...p, genre: e.target.value }))} required />
      </div>
      <div>
        <label className="label">Cover Art *</label>
        <input type="file" accept="image/jpeg,image/png,image/webp"
          onChange={e => setCoverFile(e.target.files?.[0] ?? null)} required />
      </div>
      <div>
        <label className="label">Audio File * (MP3/WAV/FLAC, max 500MB)</label>
        <input type="file" accept="audio/mpeg,audio/wav,audio/flac,audio/aac"
          onChange={e => setAudioFile(e.target.files?.[0] ?? null)} required />
        <p className="text-xs text-gray-500 mt-1">
          File uploads directly to our storage — your connection, not our server.
        </p>
      </div>

      {state.error && (
        <p className="text-red-400 text-sm">{state.error}</p>
      )}

      {isUploading && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{phaseLabel(state.phase)}</span>
            <span>{state.progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${state.progress}%` }} />
          </div>
        </div>
      )}

      <button type="submit" disabled={isUploading || !coverFile || !audioFile}
        className="btn-primary w-full disabled:opacity-50">
        {isUploading ? phaseLabel(state.phase) : 'Submit Track'}
      </button>
    </form>
  );
}

function phaseLabel(phase: UploadState['phase']): string {
  switch (phase) {
    case 'presign':         return 'Preparing upload…';
    case 'uploading_cover': return 'Uploading cover art…';
    case 'uploading_audio': return 'Uploading audio… (may take a moment)';
    case 'saving':          return 'Saving track…';
    default:                return 'Processing…';
  }
}
