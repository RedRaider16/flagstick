// GitHub Pages has no server-side rewrites. When someone refreshes or opens a deep
// link such as /flagstick/e/ABC123/leaderboard, Pages serves 404.html. Copying the
// built index.html to 404.html makes that page boot the app, and the router then
// renders the requested route. Asset URLs are absolute (they include the base path),
// so they resolve from any depth.
import { copyFileSync, existsSync } from 'node:fs'

const src = 'dist/index.html'
if (!existsSync(src)) {
  console.error('spa-fallback: dist/index.html not found — did vite build run?')
  process.exit(1)
}
copyFileSync(src, 'dist/404.html')
console.log('spa-fallback: wrote dist/404.html')
