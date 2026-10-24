// After a website build: pack the Chrome extension (extension/) into
// dist/i-read-substack.zip, the download in Settings → Substack. Its
// config.js points it at this app's Supabase project (public key only).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const env = { ...process.env }
// Locally the values live in .env (Vite reads it for the app; this script reads it itself).
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseKey = env.VITE_SUPABASE_ANON_KEY
const appUrl = env.VITE_SITE_URL || 'https://i-read-books-teal.vercel.app/'
if (!supabaseUrl || !supabaseKey) {
  console.warn('make-extension: no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — skipping the extension zip')
  process.exit(0)
}

const config = `// Written by scripts/make-extension.mjs — the I read app this extension reports to.
export const CONFIG = ${JSON.stringify({ supabaseUrl, supabaseKey, appUrl }, null, 2)}
`
// Also next to the sources, so extension/ can be loaded unpacked while developing.
writeFileSync('extension/config.js', config)

const files = {}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else {
      const rel = relative('extension', p).split('\\').join('/')
      if (rel !== 'config.js') files[`i-read-substack/${rel}`] = readFileSync(p)
    }
  }
}
walk('extension')
files['i-read-substack/config.js'] = strToU8(config)

mkdirSync('dist', { recursive: true })
writeFileSync('dist/i-read-substack.zip', zipSync(files, { level: 6 }))
console.log(`make-extension: dist/i-read-substack.zip (${Object.keys(files).length} files)`)
