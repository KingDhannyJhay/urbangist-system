// types/index.ts — shared types for the web frontend

export interface Profile {
  id:           string;
  username:     string;
  display_name: string | null;
  bio:          string | null;
  avatar_url:   string | null;
  slug:         string;
  verified:     boolean;
  social_links: {
    instagram?: string;
    twitter?:   string;
    youtube?:   string;
    spotify?:   string;
    tiktok?:    string;
  };
  created_at: string;
}

export interface Track {
  id:              string;
  title:           string;
  slug:            string;
  genre:           string;
  subgenre?:       string;
  description?:    string;
  audio_url:       string | null;
  preview_url:     string | null;
  cover_url:       string | null;
  waveform_url:    string | null;
  duration_sec:    number | null;
  play_count:      number;
  like_count:      number;
  share_count:     number;
  boost_multiplier: number;
  status:          'pending' | 'processing' | 'approved' | 'rejected';
  published_at:    string | null;
  rejection_note?: string | null;
  artist: {
    id:           string;
    display_name: string;
    slug:         string;
    avatar_url:   string | null;
    verified:     boolean;
  };
  ranking_cache?: {
    final_score:   number;
    rank_position: number | null;
    score_24h:     number;
  } | null;
}

export interface Boost {
  id:             string;
  track_id:       string;
  plan:           BoostPlan;
  multiplier:     number;
  duration_hours: number;
  amount_ngn:     number;
  status:         'pending' | 'active' | 'expired' | 'cancelled';
  start_at:       string | null;
  end_at:         string | null;
  created_at:     string;
  track?: Pick<Track, 'title' | 'slug'>;
}

export type BoostPlan = 'basic' | 'standard' | 'premium';

export const BOOST_PLANS: Record<BoostPlan, {
  label:      string;
  price:      number;
  hours:      number;
  multiplier: number;
  badge:      string;
  desc:       string;
}> = {
  basic: {
    label: 'Basic Boost', price: 1000, hours: 24,
    multiplier: 2.0, badge: '🔥', desc: '24-hour visibility boost',
  },
  standard: {
    label: 'Standard Boost', price: 3000, hours: 72,
    multiplier: 3.5, badge: '⚡', desc: '3-day ranking power-up',
  },
  premium: {
    label: 'Premium Boost', price: 5000, hours: 168,
    multiplier: 6.0, badge: '👑', desc: '7-day featured placement',
  },
};

export interface Article {
  id:          string;
  title:       string;
  slug:        string;
  excerpt:     string | null;
  content:     string;
  cover_url:   string | null;
  category:    ArticleCategory;
  tags:        string[];
  featured:    boolean;
  view_count:  number;
  seo_title?:  string | null;
  seo_description?: string | null;
  published_at: string | null;
  author: {
    display_name: string;
    slug:         string;
    avatar_url:   string | null;
  };
}

export type ArticleCategory = 'guide' | 'platform' | 'industry' | 'news' | 'tutorial';

export const GENRES = [
  'Afrobeats', 'Amapiano', 'Afrorap', 'Gospel',
  'Afropop', 'Highlife', 'Fuji', 'R&B', 'Hip-Hop',
  'Dancehall', 'Afro-Soul', 'Alternative', 'Pop', 'Afrojuju',
] as const;

export type Genre = (typeof GENRES)[number];

export interface Notification {
  id:         string;
  type:       string;
  title:      string;
  body:       string | null;
  link:       string | null;
  read:       boolean;
  created_at: string;
}

export interface DashboardData {
  tracks:        Track[];
  active_boosts: Boost[];
  summary: {
    total_tracks:     number;
    live_tracks:      number;
    pending_tracks:   number;
    total_plays:      number;
    total_likes:      number;
    total_shares:     number;
    active_boosts:    number;
    total_boost_spend: number;
  };
  notifications: Notification[];
}
