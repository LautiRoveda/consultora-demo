import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      { source: '/prototipo', destination: '/prototipo/index.html' },
      { source: '/prototipo/', destination: '/prototipo/index.html' },
    ];
  },
};

export default nextConfig;
