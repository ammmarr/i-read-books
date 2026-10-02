// The *legacy* build on purpose: the modern one calls brand-new JS APIs
// (Promise.try, Uint8Array#toHex, Math.sumPrecise…) without fallbacks, so on
// tablets/WebViews a few months old some PDFs fail to open. Legacy ships the
// polyfills and renders identically.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PageSize } from '../db/db'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const asset = (path: string) => new URL(`pdfjs/${path}`, document.baseURI).href

export function openPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data,
    cMapUrl: asset('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts/'),
    wasmUrl: asset('wasm/'),
    iccUrl: asset('iccs/'),
  }).promise
}

/** Frees the worker-side document. (v6 moved `destroy` to the loading task.) */
export function closePdf(doc: PDFDocumentProxy) {
  doc.loadingTask.destroy().catch(() => {})
}

export async function openPdfBlob(blob: Blob) {
  return openPdf(new Uint8Array(await blob.arrayBuffer()))
}

export async function getPageSizes(doc: PDFDocumentProxy): Promise<PageSize[]> {
  const sizes: PageSize[] = []
  // Batches keep the worker busy without flooding it on 1,000-page books.
  const batch = 24
  for (let i = 1; i <= doc.numPages; i += batch) {
    const pages = await Promise.all(
      Array.from({ length: Math.min(batch, doc.numPages - i + 1) }, (_, k) => doc.getPage(i + k)),
    )
    for (const p of pages) {
      const vp = p.getViewport({ scale: 1 })
      sizes.push({ w: vp.width, h: vp.height })
    }
  }
  return sizes
}

/** Renders page 1 to a JPEG blob for the library cover, plus its average tint. */
export async function renderCover(doc: PDFDocumentProxy, width = 420) {
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // 'print' intent renders without requestAnimationFrame, so imports finish
  // even if the app is backgrounded mid-way (rAF pauses in hidden tabs).
  await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise
  const tint = averageColor(ctx, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86))
  page.cleanup()
  return { blob: blob ?? undefined, tint }
}

function averageColor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  try {
    const { data } = ctx.getImageData(0, 0, w, h)
    let r = 0, g = 0, b = 0, n = 0
    const step = 4 * 37
    for (let i = 0; i < data.length; i += step) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    }
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  } catch {
    return '#e5e5e5'
  }
}

export async function readMetadata(doc: PDFDocumentProxy) {
  try {
    const { info } = (await doc.getMetadata()) as unknown as { info: Record<string, unknown> }
    const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
    return { title: clean(info?.Title), author: clean(info?.Author) }
  } catch {
    return { title: '', author: '' }
  }
}

/** Where an internal link or outline entry points: a page, and optionally how far down it (0–1). */
export interface DestTarget {
  page: number
  top?: number
}

export async function resolveDest(doc: PDFDocumentProxy, dest: unknown): Promise<DestTarget | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[] | null)
    if (!Array.isArray(explicit) || explicit[0] == null) return null
    const ref = explicit[0]
    const page = typeof ref === 'number' ? ref : await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
    const kind = (explicit[1] as { name?: string } | undefined)?.name
    const y = kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : kind === 'FitR' ? explicit[5] : null
    if (typeof y !== 'number') return { page }
    const vp = (await doc.getPage(page + 1)).getViewport({ scale: 1 })
    const [, top] = vp.convertToViewportPoint(0, y)
    return { page, top: Math.max(0, Math.min(1, top / vp.height)) }
  } catch {
    return null
  }
}

export interface PdfLink {
  /** Normalised [x, y, w, h] on the page. */
  rect: [number, number, number, number]
  url?: string
  dest?: unknown
  /** Named actions like NextPage / PrevPage / FirstPage / LastPage. */
  action?: string
}

export async function readLinks(page: PDFPageProxy): Promise<PdfLink[]> {
  const annots = (await page.getAnnotations({ intent: 'display' }).catch(() => [])) as {
    subtype?: string
    rect: number[]
    url?: string
    unsafeUrl?: string
    dest?: unknown
    action?: string
  }[]
  const vp = page.getViewport({ scale: 1 })
  const out: PdfLink[] = []
  for (const a of annots) {
    if (a.subtype !== 'Link') continue
    const url = a.url ?? (a.unsafeUrl && /^(https?:|mailto:)/i.test(a.unsafeUrl) ? a.unsafeUrl : undefined)
    if (!url && a.dest == null && !a.action) continue
    const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]) as number[]
    const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]) as number[]
    const l = Math.min(x1, x2), t = Math.min(y1, y2)
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1)
    if (w < 1 || h < 1) continue
    out.push({ rect: [l / vp.width, t / vp.height, w / vp.width, h / vp.height], url, dest: a.dest, action: a.action })
  }
  return out
}

export interface OutlineItem {
  title: string
  page: number | null
  /** How far down the page the heading sits (0–1), when the PDF says. */
  top?: number
  items: OutlineItem[]
}

export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
  const raw = await doc.getOutline().catch(() => null)
  if (!raw) return []
  const walk = async (items: typeof raw): Promise<OutlineItem[]> =>
    Promise.all(
      items.map(async (it) => {
        const t = await resolveDest(doc, it.dest)
        return {
          title: it.title,
          page: t?.page ?? null,
          top: t?.top,
          items: it.items?.length ? await walk(it.items) : [],
        }
      }),
    )
  return walk(raw)
}

/** Flattened outline, sorted by page — used to label "which chapter am I in". */
export function flattenOutline(items: OutlineItem[], depth = 0): (OutlineItem & { depth: number })[] {
  return items.flatMap((it) => [{ ...it, depth }, ...flattenOutline(it.items, depth + 1)])
}

export type { PDFDocumentProxy, PDFPageProxy }
export { pdfjs }
