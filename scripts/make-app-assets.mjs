// Renders the source images @capacitor/assets turns into Android launcher
// icons and splash screens.  Run: node scripts/make-app-assets.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

mkdirSync('assets', { recursive: true })

const book = (fg = '#fafafa', fg2 = '#d4d4d4', ink = '#171717') => `
  <path d="M136 150c38-14 78-14 120 8v222c-42-22-82-22-120-8z" fill="${fg}"/>
  <path d="M376 150c-38-14-78-14-120 8v222c42-22 82-22 120-8z" fill="${fg2}"/>
  <rect x="300" y="118" width="34" height="96" rx="4" fill="#0070f3"/>
  <path d="M300 214l17-14 17 14z" fill="${ink}"/>`

const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#171717"/>${book()}</svg>`
// Adaptive icon foreground: art inside the central 66% safe zone.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(0.62) translate(-256 -265)">${book()}</g></svg>`
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#171717"/></svg>`
const splash = (bgc, fgc, fg2c, ink) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${bgc}"/><g transform="translate(1366 1366) scale(1.1) translate(-256 -265)">${book(fgc, fg2c, ink)}</g></svg>`

const out = (svg, file, size) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(`assets/${file}`)

await Promise.all([
  out(full, 'icon-only.png', 1024),
  out(fg, 'icon-foreground.png', 1024),
  out(bg, 'icon-background.png', 1024),
  out(splash('#fafafa', '#171717', '#4d4d4d', '#fafafa'), 'splash.png', 2732),
  out(splash('#0a0a0a', '#ededed', '#8f8f8f', '#0a0a0a'), 'splash-dark.png', 2732),
])
console.log('assets/ ready')
