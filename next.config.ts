import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable source maps in development to avoid Turbopack warnings
  productionBrowserSourceMaps: false,
  // Add empty turbopack config to silence warnings when using webpack
  turbopack: {},
}

// PWA runtime caching strategies for better performance
const runtimeCaching = [
  {
    // Cache static assets (JS, CSS, fonts)
    urlPattern: /^https:\/\/.*\.(js|css|woff2?|ttf|eot)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'static-assets',
      expiration: {
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      },
    },
  },
  {
    // Cache images
    urlPattern: /^https:\/\/.*\.(png|jpg|jpeg|svg|gif|webp|avif|ico)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'images',
      expiration: {
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      },
    },
  },
  {
    // Cache map tiles (Leaflet/ESRI tiles)
    urlPattern: /^https:\/\/(services\.arcgisonline\.com|tiles\.stadiamaps\.com|.*\.tile\.openstreetmap\.org)/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'map-tiles',
      expiration: {
        maxEntries: 500,
        maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
      },
    },
  },
  {
    // Cache GeoJSON files
    urlPattern: /.*\.geojson$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'geojson',
      expiration: {
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
      },
    },
  },
  {
    // Network first for API calls (Supabase)
    urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'supabase-api',
      networkTimeoutSeconds: 10,
      expiration: {
        maxEntries: 100,
        maxAgeSeconds: 60 * 5, // 5 minutes
      },
    },
  },
  {
    // Stale-while-revalidate for CDN assets (Leaflet icons, etc)
    urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'cdn-assets',
      expiration: {
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      },
    },
  },
]

// Conditionally export based on environment
const config = process.env.NODE_ENV === 'production'
  ? require('next-pwa')({
      dest: 'public',
      register: true,
      skipWaiting: true,
      disable: false,
      runtimeCaching,
    })(nextConfig)
  : nextConfig

export default config
