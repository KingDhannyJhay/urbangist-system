import type { Metadata } from 'next';
import Link             from 'next/link';
import { tracks }       from '@/lib/api';
import type { Track } from '@/types';

export const metadata: Metadata = {
  title:       'Discover Nigerian Music — UrbanGist',
  description: 'Stream and discover the best Afrobeats, Amapiano, Afrorap and Gospel from Nigeria.',
};

// ISR: rebuild every 30 seconds
export const revalidate = 30;

// ─── Safe fetch helpers — never throw during build ───────────────────────────

async function safeFeed(params: Parameters<typeof tracks.feed>[0]): Promise<Track[]> {
  try {
    const res = await tracks.feed(params);
    return res.tracks ?? [];
  } catch {
    // API offline during build — return empty list.
    // Page will still render; data arrives on first request.
    return [];
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const [trending, newDrops, rising] = await Promise.all([
    safeFeed({ feed: 'trending', limit: 24 }),
    safeFeed({ feed: 'new',      limit: 12 }),
    safeFeed({ feed: 'rising',   limit: 12 }),
  ]);

  return (
    <main className="pt-20 pb-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

      {/* Hero */}
      <section className="relative text-center py-20 mb-16 rounded-3xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg,#0B0B0B 0%,#0d1f12 50%,#0B0B0B 100%)' }}>
        <div className="absolute inset-0 opacity-20 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 50%,#22C55E,transparent 60%),radial-gradient(circle at 70% 50%,#A855F7,transparent 60%)' }} />
        <div className="relative z-10 px-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-green-500/20 bg-green-500/10 text-green-400 text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            Nigeria&apos;s Music Discovery Platform
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-4 leading-tight"
            style={{ fontFamily: 'Syne, sans-serif' }}>
            Stream. Discover.<br />
            <span className="text-green-500">Go Viral.</span>
          </h1>
          <p className="text-neutral-400 text-lg mb-8 max-w-xl mx-auto">
            Afrobeats, Amapiano, Gospel &amp; more — ranked by real plays, real shares, real love.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/trending"
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-green-500 text-black hover:bg-green-400 transition-colors">
              Explore Trending
            </Link>
            <Link href="/upload"
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors">
              Upload Your Music
            </Link>
          </div>
        </div>
      </section>

      {/* Trending */}
      <FeedSection title="🔥 Trending Now"      tracks={trending}  href="/trending" />
      <FeedSection title="✨ New Drops"         tracks={newDrops}  href="/trending" />
      <FeedSection title="📈 Rising (Last 24h)" tracks={rising}    href="/trending" />
    </main>
  );
}

// ─── Section component ────────────────────────────────────────────────────────

function FeedSection({ title, tracks: list, href }: {
  title:  string;
  tracks: Track[];
  href:   string;
}) {
  if (list.length === 0) return null;
  return (
    <section className="mb-12">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-black text-white" style={{ fontFamily: 'Syne, sans-serif' }}>
          {title}
        </h2>
        <Link href={href} className="text-xs text-green-500 hover:text-green-400 transition-colors">
          See all →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {list.map(track => (
          <TrackCard key={track.id} track={track} />
        ))}
      </div>
    </section>
  );
}

// ─── Track card (server-rendered, no interactivity here) ─────────────────────

function TrackCard({ track }: { track: Track }) {
  return (
    <Link href={`/track/${track.slug}`} className="group block">
      <div
        className="aspect-square w-full rounded-xl mb-2.5 flex items-center justify-center overflow-hidden"
        style={{ background: '#1C1C1C', border: '1px solid #2A2A2A' }}
      >
        {track.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover_url}
            alt={track.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <span className="text-3xl opacity-30">🎵</span>
        )}
      </div>
      <p className="truncate text-sm font-semibold text-white group-hover:text-green-500 transition-colors leading-snug">
        {track.title}
      </p>
      <p className="truncate text-xs text-neutral-500 mt-0.5">
        {track.artist.display_name}
      </p>
    </Link>
  );
}
