import type { PDFDocumentProxy } from '../lib/pdf'
import type { TextContent } from './textIndex'

/**
 * "Reading view": a PDF page's text, lifted out of its tight layout and set again
 * as plain paragraphs, so the size, line spacing and width are yours to choose.
 * A PDF has no paragraphs — only pieces of text at positions — so they're worked
 * out here: lines from the positions, paragraphs from line gaps, indents and short
 * last lines, headings from bigger type, and running heads / page numbers dropped.
 */

export interface Block {
  kind: 'h' | 'p'
  text: string
  /** A paragraph that carries on from the page before (starts in lower case). */
  cont?: boolean
}

export interface ReflowPage {
  blocks: Block[]
  /** Characters of text — for how long the page takes to read. */
  chars: number
}

interface Line {
  text: string
  x: number
  xEnd: number
  y: number
  size: number
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** The value that carries the most weight (text), after rounding to `step`. */
function weightedMode(items: { v: number; w: number }[], step: number) {
  const m = new Map<number, number>()
  for (const { v, w } of items) {
    const k = Math.round(v / step) * step
    m.set(k, (m.get(k) ?? 0) + w)
  }
  let best = 0
  let bestW = -1
  for (const [k, w] of m) if (w > bestW) (best = k), (bestW = w)
  return best
}

const SENTENCE_END = /[.!?…:]["”’')\]]*$/

export function reflowContent(content: TextContent, pageW: number, pageH: number): ReflowPage {
  // 1 — lines, from where the pieces sit.
  const lines: Line[] = []
  let cur: Line | null = null
  let parts: string[] = []
  const flush = () => {
    if (cur) {
      cur.text = parts
        .join('')
        .replace(/[ﬀ-ﬆ]/g, (c) => c.normalize('NFKC'))
        .replace(/\s+/g, ' ')
        .trim()
      if (cur.text) lines.push(cur)
    }
    cur = null
    parts = []
  }
  for (const it of content.items) {
    if (!('str' in it)) continue
    const size = Math.abs(it.transform[3]) || it.height || 10
    const x = it.transform[4]
    const y = it.transform[5]
    if (cur && Math.abs(y - cur.y) > Math.max(2, cur.size * 0.45)) flush()
    if (!cur) cur = { text: '', x, xEnd: x, y, size }
    parts.push(it.str)
    if (it.str.trim()) {
      cur.x = Math.min(cur.x, x)
      cur.xEnd = Math.max(cur.xEnd, x + it.width)
      cur.size = Math.max(cur.size, size)
    }
    if (it.hasEOL) flush()
  }
  flush()
  if (!lines.length) return { blocks: [], chars: 0 }

  // 2 — what the body text looks like on this page.
  const weights = lines.map((l) => ({ v: l.size, w: l.text.length }))
  const body = weightedMode(weights, 0.5) || 10
  const bodyLines = lines.filter((l) => l.size <= body * 1.12 && l.size >= body * 0.85)
  const bodyLeft = weightedMode(bodyLines.map((l) => ({ v: l.x, w: l.text.length })), 2)
  const ends = bodyLines.map((l) => l.xEnd).sort((a, b) => a - b)
  const right = ends.length ? ends[Math.floor(ends.length * 0.9)] : pageW
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y
    if (g > 0 && g < body * 2.6) gaps.push(g)
  }
  const leading = median(gaps) || body * 1.3

  // 3 — drop running heads and page numbers at the very top and bottom.
  const kept = lines.filter((l) => {
    const edge = l.y > pageH * 0.955 || l.y < pageH * 0.055
    if (!edge) return true
    if (l.size > body * 1.15) return true
    return l.text.length > 60
  })

  // 4 — headings and paragraphs.
  const blocks: Block[] = []
  let prev: Line | null = null
  for (const l of kept) {
    const heading = l.size >= body * 1.18 && l.text.length <= 140
    const last = blocks[blocks.length - 1]
    if (heading) {
      if (last?.kind === 'h' && prev && prev.y - l.y < l.size * 1.9) last.text += ' ' + l.text
      else blocks.push({ kind: 'h', text: l.text })
    } else if (!last || last.kind === 'h' || !prev) {
      blocks.push({ kind: 'p', text: l.text })
    } else {
      const gap = prev.y - l.y
      const newPara =
        gap > leading * 1.5 ||
        (SENTENCE_END.test(last.text) && prev.xEnd < right - body * 3) ||
        (SENTENCE_END.test(last.text) && l.x > bodyLeft + body * 0.8)
      if (newPara) blocks.push({ kind: 'p', text: l.text })
      else if (/[A-Za-z]-$/.test(last.text) && /^[a-z]/.test(l.text)) last.text = last.text.slice(0, -1) + l.text
      else last.text += ' ' + l.text
    }
    prev = l
  }

  const first = blocks[0]
  if (first?.kind === 'p' && /^[a-z]/.test(first.text)) first.cont = true
  return { blocks, chars: blocks.reduce((a, b) => a + b.text.length, 0) }
}

/** A PDF's pages as reflowed text, worked out when first asked for and remembered. */
export class ReflowText {
  private pages = new Map<number, Promise<ReflowPage>>()
  private done = new Map<number, ReflowPage>()
  private doc: PDFDocumentProxy
  constructor(doc: PDFDocumentProxy) {
    this.doc = doc
  }

  get(page: number) {
    let p = this.pages.get(page)
    if (!p) {
      p = this.doc.getPage(page + 1).then(async (pg) => {
        const vp = pg.getViewport({ scale: 1 })
        const r = reflowContent(await pg.getTextContent(), vp.width, vp.height)
        this.done.set(page, r)
        return r
      })
      this.pages.set(page, p)
    }
    return p
  }

  peek(page: number) {
    return this.done.get(page)
  }
}
