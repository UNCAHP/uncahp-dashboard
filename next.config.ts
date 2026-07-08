import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
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
