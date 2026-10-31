import { wordFrom } from '../lib/dictionary'

const WORD_CHAR = /[\p{L}\p{N}'’-]/u

type CaretDoc = Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }

/** The word of the PDF text under a point (screen coordinates), with where it is on screen. */
export function wordAtPoint(x: number, y: number): { word: string; rect: DOMRect; rects: DOMRect[]; node: Node } | null {
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
  return word ? { word, rect: range.getBoundingClientRect(), rects, node } : null
}

/** Which page a bit of the PDF text is on, and the sentence around `word` there. */
export function placeOf(node: Node | null | undefined, word: string): { page: number; top?: number; context?: string } | null {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null | undefined)
  const pageEl = el?.closest<HTMLElement>('.pdf-page')
  if (!el || !pageEl) return null
  const pr = pageEl.getBoundingClientRect()
  const top = pr.height ? Math.max(0, Math.min(1, (el.getBoundingClientRect().top - pr.top) / pr.height)) : undefined
  const page = Number(pageEl.dataset.page)
  const layer = el.closest('.textLayer')
  const spans = layer ? [...layer.querySelectorAll('span:not(.markedContent)')] : []
  const i = spans.findIndex((s) => s.contains(el) || s === el)
  if (i < 0) return { page, top }
  // The line, with a couple of lines either side, cut down to the sentence.
  const text = spans
    .slice(Math.max(0, i - 3), i + 4)
    .map((s) => s.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/(\p{L})- (\p{Ll})/gu, '$1$2')
  return { page, top, context: sentenceAround(text, word) }
}

/** The sentence `word` is in, from a run of text (cut down around it when long). */
export function sentenceAround(text: string, word: string): string | undefined {
  const at = text.toLowerCase().indexOf(word.toLowerCase())
  if (at < 0) return text.trim().slice(0, 200) || undefined
  const before = text.slice(0, at)
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '))
  const endMatch = /[.?!](\s|$)/.exec(text.slice(at + word.length))
  const end = endMatch ? at + word.length + endMatch.index + 1 : text.length
  let sentence = text.slice(start >= 0 ? start + 2 : 0, end).trim()
  if (sentence.length > 220) {
    // Around the word, cut at spaces.
    const w = sentence.toLowerCase().indexOf(word.toLowerCase())
    const from = w > 100 ? sentence.lastIndexOf(' ', w - 100) + 1 : 0
    const cut = sentence.slice(from, from + 200)
    const to = cut.length < 200 ? cut.length : cut.lastIndexOf(' ')
    sentence = `${from > 0 ? '…' : ''}${cut.slice(0, to > 0 ? to : cut.length).trim()}…`
  }
  return sentence || undefined
}
