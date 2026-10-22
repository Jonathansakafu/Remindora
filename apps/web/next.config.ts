import type { NextConfig } from 'next';

/**
 * BUILD_TARGET=desktop produces a static export that the Tauri shell bundles
 * (same UI, offline-capable). The hosted web build serves with security headers.
 */
const isDesktop = process.env.BUILD_TARGET === 'desktop';
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const apiWs = api.replace(/^http/, 'ws');

const csp = [
  "default-src 'self'",
  `connect-src 'self' ${api} ${apiWs}`,
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@remindora/ui'],
  output: isDesktop ? 'export' : undefined,
  trailingSlash: isDesktop,
  images: { unoptimized: true },
  ...(isDesktop
    ? {}
    : {
        async headers() {
          return [
            {
              source: '/:path*',
              headers: [
                { key: 'Content-Security-Policy', value: csp },
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
              ],
            },
          ];
        },
      }),
};

export default config;
