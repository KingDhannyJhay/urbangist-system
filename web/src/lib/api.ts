/**
 * lib/api.ts — Complete typed API client for UrbanGist web frontend.
 *
 * All requests go to the Railway API via Next.js rewrites (/api/* → Railway).
 * This means: no CORS issues, Railway URL never exposed to browser.
 *
 * Usage in Server Components:  const data = await tracks.feed({ feed: 'trending' })
 * Usage in Client Components:  const data = await tracks.feed({ feed: 'trending' })
 * Usage with auth:             const data = await profiles.dashboard(jwt)
 */

import type {
  Track, Profile, Boost, Article, DashboardData,
  BoostPlan, ArticleCategory,
} from '@/types';

// Re-export types that consumers may import from this module.
// BoostPlan is used by BoostButton.tsx via `import { type BoostPlan } from '@/lib/api'`
export type { BoostPlan, ArticleCategory };

// In browser: /api/* is rewritten to Railway by next.config.js
// In Node (SSR): use full URL from env
const API_BASE =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? 'http://localhost:3001')
    : '/api';

// ─── Fetch helper ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchOpts = RequestInit & { jwt?: string };

async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const { jwt, ...rest } = opts;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    ...(rest.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }

  return res.json() as Promise<T>;
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

export type FeedType = 'trending' | 'new' | 'rising';

export interface FeedResponse {
  tracks: Track[];
  total:  number;
  offset: number;
  limit:  number;
}

export const tracks = {
  feed(params: { feed?: FeedType; genre?: string; limit?: number; offset?: number } = {}, next?: RequestInit['next']): Promise<FeedResponse> {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    ).toString();
    return apiFetch<FeedResponse>(`/tracks${qs ? `?${qs}` : ''}`, { next: next ?? { revalidate: 30 } });
  },

  get(slug: string): Promise<{ track: Track; related: Track[] }> {
    return apiFetch(`/tracks/${slug}`, { next: { revalidate: 30 } });
  },

  search(q: string): Promise<{ tracks: Track[]; artists: Profile[] }> {
    return apiFetch(`/tracks/search?q=${encodeURIComponent(q)}`);
  },

  initiateUpload(body: {
    title: string; genre: string; subgenre?: string;
    description?: string; cover_mime: string; audio_mime: string;
  }, jwt: string): Promise<{
    track: { id: string; slug: string };
    upload: {
      cover: { signed_url: string; path: string };
      audio: { signed_url: string; path: string };
    };
  }> {
    return apiFetch('/tracks/upload', { method: 'POST', body: JSON.stringify(body), jwt });
  },
};

// ─── Profiles ─────────────────────────────────────────────────────────────────

export const profiles = {
  get(slug: string): Promise<{ profile: Profile; tracks: Track[]; stats: Record<string, number> }> {
    return apiFetch(`/profiles/${slug}`, { next: { revalidate: 60 } });
  },

  dashboard(jwt: string): Promise<DashboardData> {
    return apiFetch('/profiles/me/dashboard', { jwt });
  },

  update(data: Partial<Pick<Profile, 'display_name' | 'bio' | 'avatar_url' | 'social_links'>>, jwt: string): Promise<{ profile: Profile }> {
    return apiFetch('/profiles/me', { method: 'PATCH', body: JSON.stringify(data), jwt });
  },

  analytics(trackId: string, jwt: string): Promise<Record<string, unknown>> {
    return apiFetch(`/profiles/me/analytics/${trackId}`, { jwt });
  },

  markNotificationsRead(jwt: string): Promise<{ success: boolean }> {
    return apiFetch('/profiles/me/notifications/read', { method: 'PATCH', jwt });
  },
};

// ─── Boosts ───────────────────────────────────────────────────────────────────

export const boosts = {
  initiate(body: { track_id: string; plan: BoostPlan }, jwt: string): Promise<{
    boost_id: string; reference: string; amount_kobo: number;
    email: string; public_key: string; plan_label: string; amount_ngn: number;
  }> {
    return apiFetch('/boosts/initiate', { method: 'POST', body: JSON.stringify(body), jwt });
  },

  verify(body: { reference: string; boost_id: string }, jwt: string): Promise<{
    success: boolean; plan: string; ends_at: string; message: string;
  }> {
    return apiFetch('/boosts/verify', { method: 'POST', body: JSON.stringify(body), jwt });
  },

  list(jwt: string): Promise<{ boosts: Boost[] }> {
    return apiFetch('/boosts', { jwt });
  },
};

// ─── Interactions ─────────────────────────────────────────────────────────────

export const interactions = {
  record(event: {
    track_id: string;
    event_type: 'play' | 'like' | 'unlike' | 'share' | 'download';
    source?: string;
    progress_pct?: number;
    completed?: boolean;
  }, jwt?: string): Promise<{ recorded: boolean }> {
    return apiFetch('/interactions', { method: 'POST', body: JSON.stringify(event), jwt });
  },
};

// ─── Learn ────────────────────────────────────────────────────────────────────

export const learn = {
  list(params: { category?: ArticleCategory; limit?: number; offset?: number } = {}): Promise<{
    articles: Article[]; total: number; offset: number; limit: number;
  }> {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    ).toString();
    return apiFetch(`/learn${qs ? `?${qs}` : ''}`, { next: { revalidate: 300 } });
  },

  get(slug: string): Promise<{ article: Article; related: Article[] }> {
    return apiFetch(`/learn/${slug}`, { next: { revalidate: 300 } });
  },
};

// ─── Admin ────────────────────────────────────────────────────────────────────

export const admin = {
  stats(jwt: string): Promise<Record<string, number>> {
    return apiFetch('/admin/stats', { jwt });
  },

  pendingTracks(jwt: string): Promise<{ tracks: Track[] }> {
    return apiFetch('/admin/tracks/pending', { jwt });
  },

  approve(trackId: string, jwt: string): Promise<{ success: boolean }> {
    return apiFetch(`/admin/tracks/${trackId}/approve`, { method: 'PATCH', jwt });
  },

  reject(trackId: string, reason: string, jwt: string): Promise<{ success: boolean }> {
    return apiFetch(`/admin/tracks/${trackId}/reject`, {
      method: 'PATCH', body: JSON.stringify({ reason }), jwt,
    });
  },

  jobs(status: string, jwt: string): Promise<{ jobs: unknown[] }> {
    return apiFetch(`/admin/jobs?status=${status}`, { jwt });
  },

  retryJob(jobId: string, jwt: string): Promise<{ success: boolean }> {
    return apiFetch(`/admin/jobs/${jobId}/retry`, { method: 'POST', jwt });
  },

  articles(jwt: string): Promise<{ articles: Article[] }> {
    return apiFetch('/admin/articles', { jwt });
  },

  createArticle(data: Partial<Article> & { status: 'draft' | 'published' }, jwt: string): Promise<{ article: { id: string; slug: string } }> {
    return apiFetch('/admin/articles', { method: 'POST', body: JSON.stringify(data), jwt });
  },
};
