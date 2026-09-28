// Builds every logo/icon from the line-art drawing in assets/logo-source.jpg:
//   src/assets/logo-lineart.png   transparent line art (the in-app logo, tinted by theme)
//   public/…                      favicon + PWA / home-screen icons
//   assets/…                      sources for `npx @capacitor/assets generate --android`
// Run: node scripts/make-app-assets.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'assets/logo-source.jpg'
const BG = { r: 0xd1, g: 0xd1, b: 0xd1 } // the drawing's own paper grey
const INK = { r: 0x17, g: 0x17, b: 0x17 }

mkdirSync('src/assets', { recursive: true })
mkdirSync('public', { recursive: true })

// 1. Separate the lines from the paper → alpha mask, keeping the soft edges.
const { data, info } = await sharp(SRC).greyscale().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height
const paper = 209, ink = 20
const alpha = new Uint8Array(W * H)
let x0 = W, y0 = H, x1 = 0, y1 = 0
for (let i = 0; i < W * H; i++) {
  const a = Math.max(0, Math.min(1, (paper - data[i]) / (paper - ink)))
  alpha[i] = Math.round(a * 255)
  if (alpha[i] > 60) {
    const x = i % W, y = (i / W) | 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
}
const pad = 12
x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad)
const cw = x1 - x0 + 1, ch = y1 - y0 + 1

/** Max-filter (dilate) the alpha so thin strokes survive being shrunk. */
function thicken(src, w, h, r) {
  if (r <= 0) return src
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w && src[y * w + xx] > m) m = src[y * w + xx] }
      tmp[y * w + x] = m
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h && tmp[yy * w + x] > m) m = tmp[yy * w + x] }
      out[y * w + x] = m
    }
  return out
}

function crop(stroke = 0) {
  const a = new Uint8Array(cw * ch)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) a[y * cw + x] = alpha[(y + y0) * W + (x + x0)]
  return thicken(a, cw, ch, stroke)
}

/** Line art as an RGBA sharp image in the given colour. */
function art(color, stroke = 0) {
  const a = crop(stroke)
  const rgba = Buffer.alloc(cw * ch * 4)
  for (let i = 0; i < cw * ch; i++) {
    rgba[i * 4] = color.r; rgba[i * 4 + 1] = color.g; rgba[i * 4 + 2] = color.b; rgba[i * 4 + 3] = a[i]
  }
  return sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } })
}

/** Square icon: the figure centred, `fill` = share of the height it takes. */
async function icon(file, size, { fill = 0.74, bg = BG, color = INK, stroke = 0, transparent = false } = {}) {
  const h = Math.round(size * fill)
  const figure = await art(color, stroke).resize({ height: h }).png().toBuffer()
  const meta = await sharp(figure).metadata()
  const base = sharp({
    create: { width: size, height: size, channels: 4, background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : { ...bg, alpha: 1 } },
  })
  await base
    .composite([{ input: figure, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) + Math.round(size * 0.01) }])
    .png()
    .toFile(file)
}

// In-app logo (tinted by CSS, so it follows light/dark mode)
await art(INK).png().toFile('src/assets/logo-lineart.png')

// Web / PWA
await icon('public/favicon.png', 64, { fill: 0.86, stroke: 2 })
await icon('public/pwa-64x64.png', 64, { fill: 0.84, stroke: 2 })
await icon('public/pwa-192x192.png', 192, { fill: 0.78, stroke: 1 })
await icon('public/pwa-512x512.png', 512, { fill: 0.76, stroke: 1 })
await icon('public/apple-touch-icon-180x180.png', 180, { fill: 0.74, stroke: 1 })
await icon('public/maskable-icon-512x512.png', 512, { fill: 0.58, stroke: 1 }) // inside the circular safe zone

// Android (@capacitor/assets): adaptive icon = foreground on a grey layer
mkdirSync('assets', { recursive: true })
await icon('assets/icon-only.png', 1024, { fill: 0.74, stroke: 2 })
await icon('assets/icon-foreground.png', 1024, { fill: 0.57, stroke: 2, transparent: true }) // 66% safe zone
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { ...BG, alpha: 1 } } }).png().toFile('assets/icon-background.png')
await icon('assets/splash.png', 2732, { fill: 0.22, bg: { r: 0xfa, g: 0xfa, b: 0xfa }, stroke: 4 })
await icon('assets/splash-dark.png', 2732, { fill: 0.22, bg: { r: 0x0a, g: 0x0a, b: 0x0a }, color: { r: 0xed, g: 0xed, b: 0xed }, stroke: 4 })

console.log(`line art ${cw}×${ch}; icons written`)
