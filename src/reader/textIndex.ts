import type { PDFDocumentProxy } from '../lib/pdf'

type TextContent = Awaited<ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getTextContent']>>
type TextItem = { str: string; hasEOL: boolean }

export type { TextContent }

/**
 * A searchable, normalised view of one page's text. Every character of `norm`
 * maps back to a (text item, character) position so a match can be turned into a
 * DOM Range over the pdf.js text layer — which renders exactly one span per item.
 */
export interface PageIndex {
  norm: string
  /** item index per norm char; -1 for virtual separators */
  item: Int32Array
  /** char offset within the item per norm char */
  char: Int32Array
  /** original (un-folded) character per norm char, for display */
  disp: string[]
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function buildPageIndex(content: TextContent): PageIndex {
  const items = content.items.filter((i): i is TextItem & (typeof content.items)[number] => 'str' in i) as TextItem[]
  const chars: string[] = []
  const item: number[] = []
  const char: number[] = []
  const disp: string[] = []
  let lastWasSpace = true

  const push = (c: string, it: number, ch: number, original: string) => {
    const space = /\s/.test(c)
    if (space) {
      if (lastWasSpace) return
      chars.push(' ')
      disp.push(' ')
    } else {
      chars.push(c)
      disp.push(original)
    }
    item.push(it)
    char.push(ch)
    lastWasSpace = space
  }

  items.forEach((it, i) => {
    const s = it.str
    // Join words hyphenated across a line break: "infor-" + "mation".
    const hyphenated = it.hasEOL && /[a-z]-$/i.test(s)
    const end = hyphenated ? s.length - 1 : s.length
    for (let k = 0; k < end; k++) {
      const f = fold(s[k])
      let first = true
      for (const c of f) {
        push(c, i, k, first ? s[k] : '')
        first = false
      }
    }
    if (it.hasEOL && !hyphenated) push(' ', -1, 0, ' ')
  })

  return { norm: chars.join(''), item: Int32Array.from(item), char: Int32Array.from(char), disp }
}

export function normalizeQuery(q: string) {
  return fold(q).replace(/\s+/g, ' ').trim()
}

export interface Match {
  page: number
  start: number
  end: number
  /** index in the global match list */
  n: number
}

export function findInPage(index: PageIndex, query: string, page: number): Omit<Match, 'n'>[] {
  const out: Omit<Match, 'n'>[] = []
  if (!query) return out
  let from = 0
  for (;;) {
    const at = index.norm.indexOf(query, from)
    if (at < 0) break
    out.push({ page, start: at, end: at + query.length })
    from = at + Math.max(1, query.length)
  }
  return out
}

export function snippet(index: PageIndex, start: number, end: number, radius = 48) {
  const s = Math.max(0, start - radius)
  const e = Math.min(index.norm.length, end + radius)
  const d = (a: number, b: number) => index.disp.slice(a, b).join('')
  return {
    before: (s > 0 ? '…' : '') + d(s, start).trimStart(),
    match: d(start, end),
    after: d(end, e).trimEnd() + (e < index.norm.length ? '…' : ''),
  }
}

/** Build a DOM Range covering norm offsets [start, end) on a rendered text layer. */
export function rangeFor(index: PageIndex, textDivs: HTMLElement[], start: number, end: number): Range | null {
  let a = start
  while (a < end && index.item[a] < 0) a++
  let b = end - 1
  while (b > a && index.item[b] < 0) b--
  if (a > b) return null
  const startDiv = textDivs[index.item[a]]
  const endDiv = textDivs[index.item[b]]
  const sNode = startDiv?.firstChild
  const eNode = endDiv?.firstChild
  if (!sNode || !eNode) return null
  const r = document.createRange()
  try {
    r.setStart(sNode, Math.min(index.char[a], sNode.textContent?.length ?? 0))
    r.setEnd(eNode, Math.min(index.char[b] + 1, eNode.textContent?.length ?? 0))
  } catch {
    return null
  }
  return r
}

/** Per-document caches shared by the page views and the search panel. */
export class DocText {
  private content = new Map<number, Promise<TextContent>>()
  private indexes = new Map<number, PageIndex>()
  private doc: PDFDocumentProxy
  constructor(doc: PDFDocumentProxy) {
    this.doc = doc
  }

  getContent(page: number) {
    let p = this.content.get(page)
    if (!p) {
      p = this.doc.getPage(page + 1).then((pg) => pg.getTextContent())
      this.content.set(page, p)
    }
    return p
  }

  async getIndex(page: number) {
    const hit = this.indexes.get(page)
    if (hit) return hit
    const idx = buildPageIndex(await this.getContent(page))
    this.indexes.set(page, idx)
    return idx
  }

  peekIndex(page: number) {
    return this.indexes.get(page)
  }
}
