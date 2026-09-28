import type { NormRect } from '../db/db'
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
