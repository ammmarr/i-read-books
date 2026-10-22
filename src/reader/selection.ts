import type { Highlight, NormRect } from '../db/db'
import { toNorm } from './PageView'

export interface PagePiece {
  page: number
  text: string
  rects: NormRect[]
}

export function cleanText(s: string) {
  return s
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Range.toString() glues text-layer spans together with no separator, so words
 * at a line break run into each other ("corners,to"). Walk the text nodes and
 * insert a newline wherever the next span sits on a lower line.
 */
function textOfRange(range: Range) {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode! : root, NodeFilter.SHOW_TEXT)
  let out = ''
  let prev: DOMRect | null = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue
    const t = n.textContent ?? ''
    const start = n === range.startContainer ? range.startOffset : 0
    const end = n === range.endContainer ? range.endOffset : t.length
    const part = t.slice(start, end)
    if (!part) continue
    const rect = (n.parentElement as HTMLElement).getBoundingClientRect()
    if (prev && rect.top > prev.top + prev.height * 0.5) out += String.fromCharCode(10)
    out += part
    prev = rect
  }
  return out
}

/** Split the current selection into per-page pieces with normalised rects. */
export function selectionPieces(root: HTMLElement): PagePiece[] {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return []
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return []

  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-page]')).filter((p) => range.intersectsNode(p))
  const out: PagePiece[] = []
  for (const p of pages) {
    const layer = p.querySelector<HTMLElement>('.textLayer')
    if (!layer) continue
    const sub = range.cloneRange()
    if (!p.contains(range.startContainer)) sub.setStart(layer, 0)
    if (!p.contains(range.endContainer)) sub.setEnd(layer, layer.childNodes.length)
    const box = p.getBoundingClientRect()
    // Only text spans contribute rects — skip the endOfContent helper.
    const rects = toNorm(
      Array.from(sub.getClientRects()).filter((r) => r.width > 0 && r.height > 0 && r.height < box.height * 0.2),
      box,
    )
    const text = cleanText(textOfRange(sub))
    if (rects.length && text) out.push({ page: Number(p.dataset.page), text, rects })
  }
  return out
}

/** Bounding box (client coords) of the current selection, for anchoring the toolbar. */
export function selectionBox(): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 1 && r.height > 1 && r.height < 200)
  if (!rects.length) return null
  const l = Math.min(...rects.map((r) => r.left)), t = Math.min(...rects.map((r) => r.top))
  const rr = Math.max(...rects.map((r) => r.right)), b = Math.max(...rects.map((r) => r.bottom))
  return new DOMRect(l, t, rr - l, b - t)
}

// ── Highlights a selection runs into ────────────────────────────────────

/** Two rects on the same line that overlap (or just meet) sideways. */
function touches(a: NormRect, b: NormRect) {
  const sameLine = Math.abs(a[1] + a[3] / 2 - (b[1] + b[3] / 2)) < Math.min(a[3], b[3]) * 0.6
  return sameLine && a[0] <= b[0] + b[2] + 0.004 && b[0] <= a[0] + a[2] + 0.004
}

/** Highlights the selection's pieces overlap (of one colour, or any). */
export function highlightsUnder(pieces: PagePiece[], highlights: Highlight[], color?: string) {
  return highlights.filter(
    (h) => (!color || h.color === color) && pieces.some((p) => p.page === h.page && p.rects.some((r) => h.rects.some((q) => touches(r, q)))),
  )
}

type CaretDoc = Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as CaretDoc
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  const r = document.caretRangeFromPoint?.(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : null
}

/**
 * Stretch the selection over these highlights, so one highlight can replace
 * them. False if a highlight's ends couldn't be found on screen.
 */
export function extendSelectionOver(root: HTMLElement, hs: Highlight[]): boolean {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return false
  const range = sel.getRangeAt(0).cloneRange()
  let ok = true
  for (const h of hs) {
    const pageEl = root.querySelector<HTMLElement>(`[data-page="${h.page}"]`)
    if (!pageEl || !h.rects.length) {
      ok = false
      continue
    }
    const box = pageEl.getBoundingClientRect()
    const lines = [...h.rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])
    const first = lines[0]
    const last = lines[lines.length - 1]
    const s = caretAt(box.left + first[0] * box.width + 1, box.top + (first[1] + first[3] / 2) * box.height)
    const e = caretAt(box.left + (last[0] + last[2]) * box.width - 1, box.top + (last[1] + last[3] / 2) * box.height)
    const inText = (c: { node: Node } | null) => !!c && root.contains(c.node) && !!(c.node.nodeType === 3 ? c.node.parentElement : (c.node as Element))?.closest('.textLayer')
    if (!inText(s) || !inText(e)) {
      ok = false
      continue
    }
    if (range.comparePoint(s!.node, s!.offset) < 0) range.setStart(s!.node, s!.offset)
    if (range.comparePoint(e!.node, e!.offset) > 0) range.setEnd(e!.node, e!.offset)
  }
  sel.removeAllRanges()
  sel.addRange(range)
  return ok
}

/** Rects joined per line (for when a highlight's text couldn't be re-read). */
export function mergeRects(rects: NormRect[]): NormRect[] {
  const out: NormRect[] = []
  for (const r of [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const o = out.find((q) => touches(q, r))
    if (!o) {
      out.push([...r] as NormRect)
      continue
    }
    const x1 = Math.max(o[0] + o[2], r[0] + r[2]), y1 = Math.max(o[1] + o[3], r[1] + r[3])
    o[0] = Math.min(o[0], r[0])
    o[1] = Math.min(o[1], r[1])
    o[2] = x1 - o[0]
    o[3] = y1 - o[1]
  }
  return out
}
