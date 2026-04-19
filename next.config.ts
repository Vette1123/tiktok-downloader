import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep native / dynamic-require packages out of the server bundle so their
  // runtime `require()` calls resolve from node_modules at runtime instead of
  // being traced at build time.
  serverExternalPackages: ['fluent-ffmpeg', '@ffmpeg-installer/ffmpeg'],
}

export default nextConfig
