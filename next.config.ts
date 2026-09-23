import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // sharp (client logo resizing) is a native module. Keep it external to the bundle and make
  // sure its platform binaries — the @img/* optional packages, including libvips — are traced
  // into the Vercel function, otherwise it fails at runtime with "libvips-cpp.so: cannot open".
  serverExternalPackages: ['sharp'],
  outputFileTracingIncludes: {
    '/': ['./node_modules/sharp/**/*', './node_modules/@img/**/*'],
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Logo uploads go through Server Actions, whose request body defaults to 1MB.
  // Raise it comfortably above the app's logo cap (multipart adds overhead).
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: 'scontent.**' },
    ],
  },
};

export default nextConfig;
