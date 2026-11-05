import type { NextConfig } from 'next';

// Uploads pass through this server's /api proxy, which by default forwards only the first 10 MB of a body. Allow the
// API's own limit (MAX_UPLOAD_BYTES, the same .env value) plus room for the form encoding, so the API — not the proxy —
// decides and explains. Larger files are stopped by the upload form before they are sent.
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES) || 10 * 1024 * 1024;

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: maxUploadBytes + 1024 * 1024 },
  // The browser only ever talks to this origin; the API session cookie stays same-site and httpOnly.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:4000'}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
