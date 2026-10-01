import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { buildId, nativeFingerprint } from './scripts/build-info.mjs'

// Relative base so the build works from any static host sub-path
// (GitHub Pages, Netlify, a Capacitor WebView, …).
// Shown in Settings so you can tell which build you're running.
// CI sets APP_VERSION (matches the APK); Vercel builds fall back to the commit.
const appVersion =
  process.env.APP_VERSION ?? (process.env.VERCEL_GIT_COMMIT_SHA ? `web ${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}` : 'dev')
// For "Update" inside the app: which build this is, when it was made, and
// which native app it can run in (see scripts/build-info.mjs).
const builtAt = Date.now()

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(buildId()),
    __BUILT_AT__: String(builtAt),
    __NATIVE_FP__: JSON.stringify(nativeFingerprint()),
  },
  plugins: [
    react(),
    {
      // The boot screen in index.html: the logo (src/assets/logo.json) with
      // its motion (src/styles/logo.css) inlined, so it animates before the app loads.
      name: 'boot-logo',
      transformIndexHtml(html) {
        const logo = JSON.parse(readFileSync('src/assets/logo.json', 'utf8')) as { w: number; h: number; paths: string[] }
        const p = logo.paths.map((d) => `<path d="${d}" pathLength="1"/>`).join('')
        const svg =
          `<svg viewBox="0 0 ${logo.w} ${logo.h}" class="logo-art logo-draw-flow" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">` +
          `<g class="logo-lines" stroke-width="4.5">${p}</g><g class="logo-glint" stroke-width="8">${p}</g></svg>`
        return html.replace('<!--boot-logo-->', svg).replace('/*logo-css*/', readFileSync('src/styles/logo.css', 'utf8'))
      },
    },
    {
      name: 'build-time',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-time.txt', source: String(builtAt) })
      },
    },
    tailwindcss(),
    VitePWA({
      // New versions wait for you to press "Update" (see src/lib/update.ts).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.png', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'I read',
        short_name: 'I read',
        description: 'A calm, private PDF reader with highlights and reading analytics.',
        theme_color: '#fafafa',
        // The splash an installed app shows while starting — black, like the icon and boot screen.
        background_color: '#0a0a0a',
        id: './',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['books', 'education', 'productivity'],
        // Installed on a PC: "Open with → I read" for PDFs (Chromium browsers).
        file_handlers: [{ action: './', accept: { 'application/pdf': ['.pdf'] } }],
        launch_handler: { client_mode: 'focus-existing' },
        shortcuts: [
          { name: 'Library', url: './#/', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Reading list', url: './#/list', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Insights', url: './#/stats', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,bcmap,pfb,ttf,wasm,icc}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
})
