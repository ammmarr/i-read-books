// After a website build: pack the app into a zip the Android app can download
// and switch to ("Update" inside the app), plus version.json describing it.
// Only runs on Vercel (or with LIVE_BUNDLE=1) — the APK doesn't need a copy.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { buildId, nativeFingerprint } from './build-info.mjs'

if (!process.env.VERCEL && !process.env.LIVE_BUNDLE) process.exit(0)

const dist = 'dist'
const files = {}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else {
      const rel = relative(dist, p).split('\\').join('/')
      if (rel.startsWith('live/') || rel === 'version.json') continue
      // Already-compressed files gain nothing from deflate.
      files[rel] = [readFileSync(p), { level: /\.(png|jpe?g|webp|woff2?|zip|gz|br)$/i.test(rel) ? 0 : 6 }]
    }
  }
}
walk(dist)
if (!files['index.html']) throw new Error('make-live-bundle: dist/index.html missing — run after vite build')

const build = buildId()
const zip = zipSync(files)
mkdirSync(join(dist, 'live'), { recursive: true })
writeFileSync(join(dist, 'live', `${build}.zip`), zip)

const info = {
  build,
  builtAt: Number(readFileSync(join(dist, 'build-time.txt'), 'utf8')),
  native: nativeFingerprint(),
  bundle: `live/${build}.zip`,
  checksum: createHash('sha256').update(zip).digest('hex'),
  size: zip.length,
}
writeFileSync(join(dist, 'version.json'), JSON.stringify(info, null, 2))
console.log(`live bundle ${build.slice(0, 7)} · ${(zip.length / 1024 / 1024).toFixed(1)} MB · native ${info.native}`)
