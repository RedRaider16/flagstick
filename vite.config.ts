/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The site is served from https://<user>.github.io/<repo>/ on GitHub Pages, so every
// asset URL and the router basename must carry that prefix. Override with
// VITE_BASE_PATH (e.g. "/" for a custom domain).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const raw = env.VITE_BASE_PATH || '/flagstick/'
  const base = raw.endsWith('/') ? raw : `${raw}/`
  return {
    base,
    plugins: [react()],
    // React + supabase-js is ~200 kB gzipped in one file; fine for this app's size.
    build: { chunkSizeWarningLimit: 800 },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
      testTimeout: 30000,
    },
  }
})
