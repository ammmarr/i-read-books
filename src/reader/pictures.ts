/**
 * Pictures in night mode. The night page is the PDF drawn inverted — dark paper,
 * light text — which also turns photos and illustrations into negatives. So we
 * lay an un-inverted copy of each picture's area back over the page.
 *
 * Where the pictures are comes from pdf.js itself (`render({ recordImages })` →
 * `page.imageCoordinates`): real images only, already cropped to their clip, so
 * text drawn as glyphs or image masks stays inverted.
 */
type Box = { x0: number; y0: number; x1: number; y1: number }

/** Normalised picture boxes (0–1 of the page), merged and with slivers dropped. */
function pictureBoxes(coords: ArrayLike<number>): Box[] {
  let boxes: Box[] = []
  for (let i = 0; i + 5 < coords.length; i += 6) {
    // Three corners (top-left, bottom-left, top-right); the fourth completes it.
    const xs = [coords[i], coords[i + 2], coords[i + 4], coords[i + 2] + coords[i + 4] - coords[i]]
    const ys = [coords[i + 1], coords[i + 3], coords[i + 5], coords[i + 3] + coords[i + 5] - coords[i + 1]]
    const b = {
      x0: Math.max(0, Math.min(...xs)),
      y0: Math.max(0, Math.min(...ys)),
      x1: Math.min(1, Math.max(...xs)),
      y1: Math.min(1, Math.max(...ys)),
    }
    if (b.x1 > b.x0 && b.y1 > b.y0) boxes.push(b)
  }
  // One picture is often drawn as several strips or tiles: join what touches.
  const near = 0.004
  for (let merged = true; merged; ) {
    merged = false
    const out: Box[] = []
    for (const b of boxes) {
      const o = out.find((a) => b.x0 <= a.x1 + near && b.x1 >= a.x0 - near && b.y0 <= a.y1 + near && b.y1 >= a.y0 - near)
      if (o) {
        o.x0 = Math.min(o.x0, b.x0)
        o.y0 = Math.min(o.y0, b.y0)
        o.x1 = Math.max(o.x1, b.x1)
        o.y1 = Math.max(o.y1, b.y1)
        merged = true
      } else out.push({ ...b })
    }
    boxes = out
  }
  // Rules, bullets and little ornaments read fine inverted.
  return boxes.filter((b) => b.x1 - b.x0 >= 0.04 && b.y1 - b.y0 >= 0.025 && (b.x1 - b.x0) * (b.y1 - b.y0) >= 0.004)
}

/**
 * Black-and-white text or line drawing on white — a scanned page, a title page
 * or diagram stored as an image. Inverted, that reads like the rest of the
 * night page (and doesn't glare), so it stays as it is. Photos and colour
 * illustrations are what turn into negatives.
 */
function isInk(src: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const n = 96
  const probe = document.createElement('canvas')
  probe.width = probe.height = n
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(src, x, y, w, h, 0, 0, n, n)
  const d = ctx.getImageData(0, 0, n, n).data
  let grey = 0, light = 0
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    if (Math.max(r, g, b) - Math.min(r, g, b) < 50) grey++
    light += r * 0.3 + g * 0.59 + b * 0.11
  }
  return grey / (n * n) >= 0.97 && light / (n * n) >= 175
}

/** Un-inverted copies of the page's pictures, positioned over `page` (shown by CSS in night mode only). */
export function pictureLayers(page: HTMLCanvasElement, coords: ArrayLike<number> | null | undefined): HTMLCanvasElement[] {
  const boxes = coords?.length ? pictureBoxes(coords) : []
  if (!boxes.length) return []
  const W = page.width, H = page.height
  const src = page.getContext('2d')
  if (!src) return []
  // A line of just blank paper (pdf.js stores the corners at half precision,
  // so a box can come out a pixel or two big — a white hairline at night).
  const blank = (x: number, y: number, w: number, h: number) => {
    const d = src.getImageData(x, y, w, h).data
    let white = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++
    return white >= w * h * 0.95
  }
  const out: HTMLCanvasElement[] = []
  for (const b of boxes) {
    let x = Math.floor(b.x0 * W), y = Math.floor(b.y0 * H)
    let x2 = Math.ceil(b.x1 * W), y2 = Math.ceil(b.y1 * H)
    for (let i = 0; i < 3 && x2 - x > 2 && blank(x, y, 1, y2 - y); i++) x++
    for (let i = 0; i < 3 && x2 - x > 2 && blank(x2 - 1, y, 1, y2 - y); i++) x2--
    for (let i = 0; i < 3 && y2 - y > 2 && blank(x, y, x2 - x, 1); i++) y++
    for (let i = 0; i < 3 && y2 - y > 2 && blank(x, y2 - 1, x2 - x, 1); i++) y2--
    const w = x2 - x, h = y2 - y
    if (w < 2 || h < 2) continue
    if (isInk(page, x, y, w, h)) continue
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(page, x, y, w, h, 0, 0, w, h)
    c.className = 'pdf-picture'
    c.setAttribute('aria-hidden', 'true')
    c.style.left = `${(x / W) * 100}%`
    c.style.top = `${(y / H) * 100}%`
    c.style.width = `${(w / W) * 100}%`
    c.style.height = `${(h / H) * 100}%`
    out.push(c)
  }
  return out
}
