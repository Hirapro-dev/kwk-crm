import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js 15: typedRoutes は experimental から top-level に昇格
  // ただし Turbopack(--turbo)では未対応のため一旦無効化。
  // typedRoutes を使いたい場合は `next dev`(Turbopack 無効)に切り替える。
  // typedRoutes: true,

  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    // Biome で lint しているので Next 内蔵 ESLint は無効
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
