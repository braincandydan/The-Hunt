import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable source maps in development to avoid Turbopack warnings
  productionBrowserSourceMaps: false,
  // Add empty turbopack config to silence warnings when using webpack
  turbopack: {},
}

// Conditionally export based on environment
const config = process.env.NODE_ENV === 'production'
  ? require('next-pwa')({
      dest: 'public',
      register: true,
      skipWaiting: true,
      disable: false,
    })(nextConfig)
  : nextConfig

export default config
