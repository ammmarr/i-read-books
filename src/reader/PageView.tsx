import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { pdfjs, readLinks, type PDFDocumentProxy, type PdfLink } from '../lib/pdf'
import type { Highlight, NormRect } from '../db/db'
import { rangeFor, type DocText } from './textIndex'
import { pictureLayers } from './pictures'

/** Keep each canvas under ~16 MP — mobile browsers silently fail above that. */
const MAX_CANVAS_PIXELS = 16_000_000

export interface PageHit {
  start: number
  end: number
  current: boolean
}

interface Props {
  doc: PDFDocumentProxy
  text: DocText
  index: number
  scale: number
  top: number
  left: number
  width: number
  height: number
  highlights: Highlight[]
  freshHighlightId?: string | null
  flashHighlightId?: string | null
  hits: PageHit[]
  bookmarked: boolean
  /** Night page theme: the page is drawn inverted, pictures aren't. */
  night: boolean
  onCurrentHitRect?: (page: number, rect: NormRect) => void
  onLink?: (link: PdfLink, page: number) => void
}

type TextLayerInstance = InstanceType<typeof pdfjs.TextLayer>

export const PageView = memo(function PageView({
  doc, text, index, scale, top, left, width, height, highlights, freshHighlightId, flashHighlightId, hits, bookmarked, night, onCurrentHitRect, onLink,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const pageEl = useRef<HTMLDivElement>(null)
  const textEl = useRef<HTMLDivElement>(null)
  const textLayer = useRef<TextLayerInstance | null>(null)
  const [rendered, setRendered] = useState(false)
  const [textReady, setTextReady] = useState(0)
  const [hitRects, setHitRects] = useState<{ rects: NormRect[]; current: boolean }[]>([])
  const [links, setLinks] = useState<PdfLink[]>([])

  // Link annotations: chapter jumps inside the book, and web links.
  useEffect(() => {
    let alive = true
    doc.getPage(index + 1).then(readLinks).then((l) => alive && setLinks(l)).catch(() => {})
    return () => {
      alive = false
    }
  }, [doc, index])

  // Canvas: render into a fresh canvas and swap it in when done, so zooming
  // shows the old (stretched) bitmap instead of flashing blank. In night mode
  // the page's pictures go on top un-inverted (see pictures.ts).
  const nightRef = useRef(night)
  nightRef.current = night
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null
    const hasBitmap = !!host.current?.firstChild
    const timer = setTimeout(
      async () => {
        try {
          const page = await doc.getPage(index + 1)
          if (cancelled) return
          const viewport = page.getViewport({ scale })
          const dpr = window.devicePixelRatio || 1
          const output = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)))
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * output)
          canvas.height = Math.floor(viewport.height * output)
          canvas.className = 'pdf-canvas'
          canvas.setAttribute('aria-hidden', 'true')
          task = page.render({
            canvas,
            viewport,
            transform: output !== 1 ? [output, 0, 0, output, 0, 0] : undefined,
            // Where the pictures are — recorded once per page, kept on the page.
            recordImages: !page.imageCoordinates,
          })
          await task.promise
          if (cancelled || !host.current) return
          host.current.replaceChildren(canvas)
          if (nightRef.current) addPictures(host.current, doc, index, canvas)
          setRendered(true)
        } catch (e) {
          if ((e as Error)?.name !== 'RenderingCancelledException') console.warn('page render failed', index, e)
        }
      },
      // Debounce re-renders during continuous zoom; first paint is immediate.
      hasBitmap ? 160 : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
    }
  }, [doc, index, scale])

  // Switched to night with the page already drawn: add its pictures now.
  useEffect(() => {
    const el = host.current
    const canvas = el?.querySelector<HTMLCanvasElement>('canvas.pdf-canvas')
    if (night && el && canvas) addPictures(el, doc, index, canvas)
  }, [night, rendered, doc, index])

  // Text layer: created once per page, then just re-laid-out on zoom.
  useEffect(() => {
    let cancelled = false
    const el = textEl.current
    if (!el) return
    ;(async () => {
      const [page, content] = await Promise.all([doc.getPage(index + 1), text.getContent(index)])
      if (cancelled) return
      const viewport = page.getViewport({ scale: scaleRef.current })
      const tl = new pdfjs.TextLayer({ textContentSource: content, container: el, viewport })
      textLayer.current = tl
      await tl.render().catch(() => {})
      if (cancelled) return
      const end = document.createElement('div')
      end.className = 'endOfContent'
      el.append(end)
      setTextReady((n) => n + 1)
    })()
    return () => {
      cancelled = true
      textLayer.current?.cancel()
      textLayer.current = null
      el.replaceChildren()
    }
  }, [doc, text, index])

  const scaleRef = useRef(scale)
  scaleRef.current = scale
  useEffect(() => {
    const tl = textLayer.current
    if (!tl || !textReady) return
    doc.getPage(index + 1).then((page) => {
      if (textLayer.current === tl) tl.update({ viewport: page.getViewport({ scale }) })
    })
  }, [doc, index, scale, textReady])

  // Search hits → normalised rects from the live text layer.
  useLayoutEffect(() => {
    if (!hits.length) return setHitRects([])
    const tl = textLayer.current
    const idx = text.peekIndex(index)
    const box = pageEl.current?.getBoundingClientRect()
    if (!tl || !idx || !box || !textReady) return
    const out = hits.map((h) => {
      const r = rangeFor(idx, tl.textDivs, h.start, h.end)
      const rects = r ? toNorm(r.getClientRects(), box) : []
      return { rects, current: h.current }
    })
    setHitRects(out)
    const cur = out.find((o) => o.current && o.rects.length)
    if (cur) onCurrentHitRect?.(index, cur.rects[0])
    // scale intentionally omitted: rects are normalised, so they survive zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, textReady, index, text])

  return (
    <div
      ref={pageEl}
      data-page={index}
      className="pdf-page absolute overflow-hidden shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_2px_8px_-2px_rgba(0,0,0,0.12)]"
      style={
        {
          top,
          left,
          width,
          height,
          '--scale-factor': scale,
          '--total-scale-factor': scale,
          '--user-unit': 1,
        } as React.CSSProperties
      }
    >
      <div ref={host} className="absolute inset-0" />
      {!rendered && <div className="skeleton absolute inset-0 opacity-60" />}

      <div className="hl-layer">
        {highlights.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              className={`hl-rect ${h.id === freshHighlightId ? 'is-new' : ''}`}
              style={{
                left: `${r[0] * 100}%`,
                top: `${r[1] * 100}%`,
                width: `${r[2] * 100}%`,
                height: `${r[3] * 100}%`,
                background: `var(--hl-${h.color})`,
                animationDelay: h.id === freshHighlightId ? `${i * 60}ms` : undefined,
              }}
            />
          )),
        )}
        {hitRects.map((h, k) =>
          h.rects.map((r, i) => (
            <div
              key={`hit-${k}-${i}`}
              className={`search-hit ${h.current ? 'is-current' : ''}`}
              style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` }}
            />
          )),
        )}
      </div>

      {/* note markers sit in the margin next to annotated highlights */}
      {highlights
        .filter((h) => h.note)
        .map((h) => (
          <span
            key={`note-${h.id}`}
            className="pointer-events-none absolute right-1.5 size-2 -translate-y-1/2 rounded-full bg-link ring-2 ring-white/80"
            style={{ top: `${(h.rects[0]?.[1] ?? 0) * 100 + ((h.rects[0]?.[3] ?? 0) * 100) / 2}%` }}
          />
        ))}

      <AnimatePresence>
        {flashHighlightId && highlights.some((h) => h.id === flashHighlightId) && (
          <FlashRing rects={highlights.find((h) => h.id === flashHighlightId)!.rects} />
        )}
      </AnimatePresence>

      <div ref={textEl} className="textLayer" />

      {links.length > 0 && (
        <div className="link-layer absolute inset-0 z-[2]" style={{ pointerEvents: 'none' }}>
          {links.map((l, i) => {
            const style = { left: `${l.rect[0] * 100}%`, top: `${l.rect[1] * 100}%`, width: `${l.rect[2] * 100}%`, height: `${l.rect[3] * 100}%` }
            return l.url ? (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                title={l.url}
                aria-label={`Open link: ${l.url}`}
                className="pdf-link is-external"
                style={style}
              />
            ) : (
              <a
                key={i}
                href="#"
                aria-label="Go to linked page"
                className="pdf-link"
                style={style}
                onClick={(e) => {
                  e.preventDefault()
                  onLink?.(l, index)
                }}
              />
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {bookmarked && (
          <motion.div
            initial={{ y: -40 }}
            animate={{ y: 0 }}
            exit={{ y: -40 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="pointer-events-none absolute right-4 top-0 h-9 w-5 bg-link [clip-path:polygon(0_0,100%_0,100%_100%,50%_78%,0_100%)]"
          />
        )}
      </AnimatePresence>
    </div>
  )
})

/** Lays the page's pictures over its bitmap, un-inverted for night mode — once per bitmap. */
function addPictures(host: HTMLElement, doc: PDFDocumentProxy, index: number, canvas: HTMLCanvasElement) {
  if (canvas.dataset.pictures) return
  canvas.dataset.pictures = '1'
  doc
    .getPage(index + 1)
    .then((page) => {
      if (canvas.parentNode === host) host.append(...pictureLayers(canvas, page.imageCoordinates))
    })
    .catch(() => {})
}

function FlashRing({ rects }: { rects: NormRect[] }) {
  const xs = rects.map((r) => r[0]), ys = rects.map((r) => r[1])
  const x2 = Math.max(...rects.map((r) => r[0] + r[2])), y2 = Math.max(...rects.map((r) => r[1] + r[3]))
  const x = Math.min(...xs), y = Math.min(...ys)
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.15 }}
      animate={{ opacity: [0, 1, 1, 0], scale: 1 }}
      transition={{ duration: 1.6, times: [0, 0.15, 0.7, 1] }}
      className="pointer-events-none absolute rounded-[4px] ring-2 ring-link"
      style={{ left: `${x * 100 - 0.6}%`, top: `${y * 100 - 0.4}%`, width: `${(x2 - x) * 100 + 1.2}%`, height: `${(y2 - y) * 100 + 0.8}%` }}
    />
  )
}

/** Client rects → page-relative fractions, dropping slivers and merging per line. */
export function toNorm(list: DOMRectList | DOMRect[], box: DOMRect): NormRect[] {
  const raw = Array.from(list)
    .map((r) => {
      const l = Math.max(r.left, box.left), t = Math.max(r.top, box.top)
      const rr = Math.min(r.right, box.right), b = Math.min(r.bottom, box.bottom)
      return { l, t, r: rr, b }
    })
    .filter((r) => r.r - r.l > 0.5 && r.b - r.t > 0.5)
  if (!raw.length) return []
  // Drop the giant rects some browsers report for block-level wrappers.
  const heights = raw.map((r) => r.b - r.t).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)]
  const lines: { l: number; t: number; r: number; b: number }[] = []
  for (const r of raw.filter((r) => r.b - r.t <= median * 2.2).sort((a, b) => a.t - b.t || a.l - b.l)) {
    const line = lines.find((x) => Math.abs((x.t + x.b) / 2 - (r.t + r.b) / 2) < median * 0.5 && r.l <= x.r + median * 0.8 && r.r >= x.l - median * 0.8)
    if (line) {
      line.l = Math.min(line.l, r.l)
      line.r = Math.max(line.r, r.r)
      line.t = Math.min(line.t, r.t)
      line.b = Math.max(line.b, r.b)
    } else lines.push({ ...r })
  }
  return lines.map((r) => [
    (r.l - box.left) / box.width,
    (r.t - box.top) / box.height,
    (r.r - r.l) / box.width,
    (r.b - r.t) / box.height,
  ])
}
