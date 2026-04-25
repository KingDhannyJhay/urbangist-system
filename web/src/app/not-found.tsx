import Link from 'next/link';

// ✅ Force static rendering (prevents server-side execution issues)
export const dynamic = 'force-static';

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <div
        className="text-7xl font-black text-[#1C1C1C] mb-4"
        style={{ fontFamily: 'Syne,sans-serif' }}
      >
        404
      </div>

      <h1
        className="text-2xl font-black text-[#F8F8F8] mb-3"
        style={{ fontFamily: 'Syne,sans-serif' }}
      >
        Page not found
      </h1>

      <p className="text-[#A3A3A3] mb-8">
        The track or page you&apos;re looking for doesn&apos;t exist.
      </p>

      <div className="flex gap-3">
        <Link href="/" className="btn-primary">
          Go Home
        </Link>
        <Link href="/trending" className="btn-secondary">
          Browse Trending
        </Link>
      </div>
    </main>
  );
}
