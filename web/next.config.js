/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for @cloudflare/next-on-pages
  // Tells Next.js to output in a format compatible with Cloudflare Pages
  images: {
    // Cloudflare Pages CDN handles image delivery.
    // unoptimized avoids needing a Node.js image server.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection',        value: '1; mode=block' },
          { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  async rewrites() {
    // Proxy /api/* to the Railway API service.
    // API_URL must be set as an environment variable in Cloudflare Pages dashboard.
    // Falls back to localhost for local development.
    const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
    return [
      {
        source:      '/api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },

  async redirects() {
    return [
      { source: '/blog',       destination: '/learn',       permanent: true },
      { source: '/blog/:slug', destination: '/learn/:slug', permanent: true },
    ];
  },
};

module.exports = nextConfig;
