import { wordFrom } from '../lib/dictionary'

const WORD_CHAR = /[\p{L}\p{N}'’-]/u

type CaretDoc = Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }

/** The word of the PDF text under a point (screen coordinates), with where it is on screen. */
export function wordAtPoint(x: number, y: number): { word: string; rect: DOMRect; rects: DOMRect[] } | null {
  const doc = document as CaretDoc
  let node: Node | null = null
  let offset = 0
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    node = p?.offsetNode ?? null
    offset = p?.offset ?? 0
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y)
    node = r?.startContainer ?? null
    offset = r?.startOffset ?? 0
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement?.closest('.textLayer')) return null
  const text = node.textContent ?? ''
  let a = Math.min(offset, text.length)
  let b = a
  while (a > 0 && WORD_CHAR.test(text[a - 1])) a--
  while (b < text.length && WORD_CHAR.test(text[b])) b++
  if (a === b) return null
  const range = document.createRange()
  range.setStart(node, a)
  range.setEnd(node, b)
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  // The caret snaps to the nearest text: only a word the pointer is actually on counts.
  if (!rects.some((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1)) return null
  const word = wordFrom(text.slice(a, b))
  return word ? { word, rect: range.getBoundingClientRect(), rects } : null
}
