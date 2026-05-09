import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [],
  },
  serverExternalPackages: ['@anthropic-ai/sdk'],
}

export default nextConfig
