import type { Metadata } from 'next';
import './globals.css';
import Navigation    from '@/components/layout/Navigation';
import Footer        from '@/components/layout/Footer';
import ToastProvider from '@/components/ui/ToastProvider';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://urbangist.com.ng'),
  title: {
    default:  'UrbanGist — Discover Nigerian Music',
    template: '%s | UrbanGist',
  },
  description:
    'Discover, stream and boost the best Afrobeats, Amapiano, Afrorap and Gospel from Nigeria.',
  openGraph: {
    type:     'website',
    locale:   'en_NG',
    url:      'https://urbangist.com.ng',
    siteName: 'UrbanGist',
    images:   [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image', site: '@UrbanGist' },
  robots:  { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Navigation is a Client Component — valid to import in Server layout */}
        <Navigation />
        <div className="min-h-screen">{children}</div>
        <Footer />
        {/* ToastProvider is 'use client' — keeps layout.tsx as pure Server Component */}
        <ToastProvider />
      </body>
    </html>
  );
}
