import type { FoliateBook, FoliateTocItem } from 'foliate-js/view.js'
import type { HighlightColor } from '../db/db'
import { CHARS_PER_LOC } from '../lib/epub'

/**
 * An EPUB shown the way the PDF reader shows a PDF: pages one below another,
 * on the desk, in one scroll through the whole book.
 *
 * Each chapter is laid out in page-sized columns (CSS columns, so lines never
 * split across pages), and each page on screen is a frame onto one column. Only
 * the pages near the screen are mounted, like the PDF reader's, and a frame
 * leaving the screen is reused for the next page of its chapter. Chapters are
 * measured in the background (a hidden frame) to know their page counts; until
 * then they're estimated, and the scroll stays put when a count corrects.
 *
 * Fixed-layout books (comics, some picture books) are one designed page per
 * section: each is scaled to fit a page instead of being laid out in columns.
 *
 * foliate-js still reads the book (sections, contents, CFIs, search); this
 * replaces only its renderer. Book pages run in sandboxed frames without
 * scripts, on top of the cleaning in lib/epub.ts.
 */

export interface PageLook {
  /** Text size, % of the default (18.5 px). */
  size: number
  /** Text across the whole screen (Ctrl F) rather than a comfortable column. */
  wide: boolean
  page: string
  desk: string
  fg: string
  link: string
  dark: boolean
}

export interface ScrollLocation {
  fraction: number
  location: { current: number; next: number; total: number }
  section: { current: number; total: number }
  time: { section: number }
  tocItem: { label: string; href: string } | null
  cfi: string
}

/** A note a link points to, shown in a card rather than by going there. */
export interface NoteCard {
  text: string
  /** Where it is in the book, when that's somewhere you can scroll to. */
  target: string | null
}

export interface SearchHit {
  cfi: string
  excerpt: { pre: string; match: string; post: string }
  /** The location it's at (about: it's worked out from the text, without laying the chapter out). */
  page: number
}

/**
 * Where a jump puts its target: at the very top (laid out again, you stay exactly
 * where you were), just below the top bar (your spot, a chapter, a link), or a third
 * of the way down the screen (a highlight or a search hit, to read in context).
 */
export type Landing = 'top' | 'bar' | 'middle'

interface Section {
  index: number
  size: number
  /** Characters before it (linear sections only). */
  before: number
  pages: number
  measured: boolean
}

interface Mounted {
  el: HTMLDivElement
  frame: HTMLIFrameElement
  s: number
  p: number
  doc?: Document
  gone?: boolean
}

type Anchor = (doc: Document) => Range | Element | number | null | undefined

interface TocEntry {
  label: string
  href: string
  anchor: Anchor
  /** Where it starts in its chapter, in pages. Unknown until the chapter's laid out, if it's partway through. */
  pos: number | null
}

const GAP = 18 // between pages
/** Room above the first page and below the last, clear of the bars (as in the PDF reader). */
const PAD_TOP = 64
const PAD_BOTTOM = 96
const BASE_PX = 18.5
/** A note card shows a short note; something longer behind a superscript is a real section, to go to. */
const NOTE_MAX = 1500
const HL_RGB: Record<HighlightColor, string> = {
  yellow: '252, 211, 77',
  green: '110, 231, 160',
  blue: '124, 184, 255',
  pink: '249, 154, 200',
  purple: '185, 164, 251',
}

const OPS = 'http://www.idpf.org/2007/ops'
const typesOf = (el: Element) => new Set((el.getAttributeNS(OPS, 'type') ?? el.getAttribute('epub:type') ?? '').split(/\s+/).filter(Boolean))
const rolesOf = (el: Element) => new Set((el.getAttribute('role') ?? '').split(/\s+/).filter(Boolean))
const NOTE_TYPES = ['footnote', 'endnote', 'rearnote', 'note']
const NOTE_ROLES = ['doc-footnote', 'doc-endnote', 'note']

/** Is this element (or something around it) a footnote or endnote? */
function isNoteTarget(el: Element | null) {
  for (let e = el; e && e.localName !== 'body'; e = e.parentElement) {
    const t = typesOf(e)
    const r = rolesOf(e)
    if (NOTE_TYPES.some((x) => t.has(x)) || NOTE_ROLES.some((x) => r.has(x))) return true
  }
  return false
}
/** The book says this link is a reference to a note. */
const saysNoteRef = (a: Element) => {
  const t = typesOf(a)
  const r = rolesOf(a)
  return ['noteref', 'biblioref', 'glossref'].some((x) => t.has(x)) || ['doc-noteref', 'doc-biblioref', 'doc-glossref'].some((x) => r.has(x))
}
/** A little raised number, which is how most books write a note reference without saying so. */
const looksLikeNoteRef = (a: Element) => {
  const t = typesOf(a)
  const r = rolesOf(a)
  if (t.has('backlink') || r.has('doc-backlink')) return false
  if (!(a.closest('sup') || a.querySelector('sup') || getComputedStyle(a).verticalAlign === 'super')) return false
  // Starting its own paragraph, it's a note's number linking back to the text.
  const block = a.closest('p, li, div, aside, td')
  return !block?.textContent?.trim().startsWith(a.textContent?.trim() ?? '')
}
/** A note's box: the paragraph or list item around its anchor. */
function noteBox(el: Element) {
  let e = el
  while (e.matches('a, span, sup, sub, em, strong, i, b, small, big') && e.parentElement) e = e.parentElement
  if (e.localName === 'body') return el.nextElementSibling ?? el
  return e
}
/** A note's words, paragraphs kept, its link back to the text (an arrow, no words) left out. */
function noteText(box: Element) {
  const copy = box.cloneNode(true) as Element
  for (const a of copy.querySelectorAll('a')) if (typesOf(a).has('backlink') || rolesOf(a).has('doc-backlink') || !/[\p{L}\p{N}]/u.test(a.textContent ?? '')) a.remove()
  const tidy = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()
  const parts = [...copy.querySelectorAll('p')].map((p) => tidy(p.textContent)).filter(Boolean)
  return parts.length ? parts.join(String.fromCharCode(10, 10)) : tidy(copy.textContent)
}

/** A chapter's words with their spacing evened out (as a highlight's text is), and where each character came from. */
function flatten(doc: Document) {
  const nodes: Text[] = []
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  const size = nodes.reduce((sum, n) => sum + n.data.length, 0)
  const nodeAt = new Uint32Array(size)
  const offsetAt = new Uint32Array(size)
  const pieces: string[] = []
  let len = 0
  let afterSpace = true
  nodes.forEach((n, i) => {
    let piece = ''
    for (let j = 0; j < n.data.length; j++) {
      const space = /\s/.test(n.data[j])
      if (space && afterSpace) continue
      nodeAt[len] = i
      offsetAt[len] = j
      len++
      piece += space ? ' ' : n.data[j]
      afterSpace = space
    }
    pieces.push(piece)
  })
  return { doc, nodes, nodeAt, offsetAt, text: pieces.join('') }
}

const rectOf = (a: Range | Element) => ('startContainer' in a ? (a.getClientRects()[0] ?? a.getBoundingClientRect()) : a.getBoundingClientRect())

type CFIModule = typeof import('foliate-js/epubcfi.js') & {
  joinIndir: (...xs: string[]) => string
  fromRange: (r: Range) => string
  fake: { fromIndex: (i: number) => string }
}

export class EpubScroller extends EventTarget {
  readonly el: HTMLDivElement
  private content: HTMLDivElement
  private measurer: HTMLIFrameElement
  private book: FoliateBook
  private look: PageLook
  private fixed: boolean
  private sections: Section[] = []
  /** Section index → position in `sections`. */
  private pos = new Map<number, number>()
  private totalSize = 0
  private starts: number[] = []
  private totalPages = 0
  private geo = { pageW: 600, pageH: 840, padX: 48, padY: 56, textW: 504, textH: 728, colGap: 40, left: 0, zoom: 1 }
  private mounted = new Map<number, Mounted>()
  private urls = new Map<number, string | null>()
  private queue: number[] = []
  private measuring = false
  private measuredDoc: { index: number; doc: Document } | null = null
  /** The hidden frame holds one chapter at a time, so its users take turns. */
  private measurerTurn: Promise<unknown> = Promise.resolve()
  /** Bumped when the layout changes: a measurement from before it doesn't count. */
  private layoutGen = 0
  /** Bumped by each jump: only the latest one lands. */
  private jump = 0
  /** The last jump that finished: when it isn't the latest, one is under way. */
  private settled = 0
  private annotations = new Map<string, HighlightColor>()
  private searchId = 0
  private searchHits = new Map<number, string[]>()
  private searchCurrent: string | null = null
  private marks = new WeakMap<Document, { cfi: string; range: Range }[]>()
  private cfi?: CFIModule
  private tocBySection = new Map<number, TocEntry[]>()
  private ro: ResizeObserver
  private frameT = 0
  private relocT: ReturnType<typeof setTimeout> | undefined
  private relayoutT: ReturnType<typeof setTimeout> | undefined
  private width = 0
  private cursorHidden = false
  private closed = false
  lastLocation: ScrollLocation | null = null

  constructor(host: HTMLElement, book: FoliateBook, look: PageLook) {
    super()
    this.book = book
    this.look = look
    this.fixed = book.rendition?.layout === 'pre-paginated'
    this.el = document.createElement('div')
    this.el.style.cssText = `position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-x pan-y;background:${look.desk}`
    this.content = document.createElement('div')
    this.content.style.cssText = 'position:relative;width:100%'
    this.el.append(this.content)
    this.measurer = document.createElement('iframe')
    this.measurer.setAttribute('sandbox', 'allow-same-origin')
    this.measurer.setAttribute('aria-hidden', 'true')
    this.measurer.tabIndex = -1
    this.measurer.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;border:0'
    this.el.append(this.measurer)
    host.append(this.el)

    let at = 0
    this.sections = book.sections
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.linear !== 'no' && s.size > 0)
      .map(({ s, index }) => {
        const sec: Section = { index, size: s.size, before: at, pages: 1, measured: this.fixed }
        at += s.size
        return sec
      })
    this.sections.forEach((s, i) => this.pos.set(s.index, i))
    this.totalSize = Math.max(1, at)

    this.el.addEventListener('scroll', () => this.onScroll(), { passive: true })
    this.ro = new ResizeObserver(() => {
      const w = this.el.clientWidth
      if (w && Math.abs(w - this.width) > 1) this.relayoutSoon()
      else this.render()
    })
  }

  // ── Opening ───────────────────────────────────────────────────────────
  async open() {
    if (!this.sections.length) throw new Error('This book has no readable pages')
    this.cfi = (await import('foliate-js/epubcfi.js')) as unknown as CFIModule
    await this.buildToc()
    this.layoutGeometry()
    this.estimate()
    this.applyHeights()
    // The pages just made the screen scroll, and on a laptop the scrollbar takes up width. Settle that
    // now: seen later, it would lay the book out again while the first jump is under way.
    if (this.el.clientWidth !== this.width) {
      this.layoutGeometry()
      this.estimate()
      this.applyHeights()
    }
    this.ro.observe(this.el)
  }

  close() {
    this.closed = true
    this.ro.disconnect()
    clearTimeout(this.relocT)
    clearTimeout(this.relayoutT)
    for (const m of this.mounted.values()) this.drop(m)
    this.mounted.clear()
    this.el.remove()
  }

  private async buildToc() {
    const book = this.book as FoliateBook & { resolveHref?: (h: string) => { index: number; anchor: Anchor } | null }
    const walk = (xs: FoliateTocItem[] | null | undefined) => {
      for (const it of xs ?? []) {
        try {
          const r = it.href ? book.resolveHref?.(it.href) : null
          if (r && r.index >= 0) {
            const list = this.tocBySection.get(r.index) ?? []
            list.push({ label: it.label?.trim() ?? '', href: it.href, anchor: r.anchor, pos: it.href.includes('#') ? null : 0 })
            this.tocBySection.set(r.index, list)
          }
        } catch {
          /* a broken contents entry */
        }
        walk(it.subitems)
      }
    }
    walk(this.book.toc)
  }

  // ── Look and geometry ─────────────────────────────────────────────────
  setLook(look: PageLook) {
    const relayout = look.size !== this.look.size || look.wide !== this.look.wide
    this.look = look
    this.el.style.background = look.desk
    for (const m of this.mounted.values()) {
      m.el.style.background = look.page
      // A new size or width lays everything out again in a moment; restyling first would show the wrong column.
      if (m.doc && !relayout) this.styleDoc(m.doc)
    }
    if (relayout) this.relayoutSoon()
  }

  private layoutGeometry() {
    const w = this.el.clientWidth || window.innerWidth
    this.width = w
    const side = w < 600 ? 10 : 28
    // The page as it reads best; "fill the screen" is that same page zoomed to the screen's width (like
    // fitting a PDF page to the width): text grows with it, so a line never gets longer.
    const baseW = Math.min(w - side * 2, 720)
    const zoom = this.look.wide ? Math.max(1, (w - side * 2) / baseW) : 1
    const pageW = Math.round(baseW * zoom)
    const pageH = Math.round(baseW * 1.414 * zoom)
    const padX = this.fixed ? 0 : Math.round(Math.max(22, Math.min(84, baseW * 0.11)) * zoom)
    const padY = this.fixed ? 0 : Math.round(Math.max(30, Math.min(84, baseW * 1.414 * 0.065)) * zoom)
    this.geo = { pageW, pageH, padX, padY, textW: pageW - padX * 2, textH: pageH - padY * 2, colGap: padX * 2, left: Math.round((w - pageW) / 2), zoom }
  }

  /** Before a chapter is measured: its pages, guessed from its size (and what's been measured so far). */
  private estimate() {
    const measured = this.sections.filter((s) => s.measured)
    const perPage = measured.length
      ? measured.reduce((a, s) => a + s.size, 0) / Math.max(1, measured.reduce((a, s) => a + s.pages, 0))
      : (this.geo.textW * this.geo.textH) / (BASE_PX * (this.look.size / 100)) ** 2 / 0.95
    for (const s of this.sections) if (!s.measured) s.pages = Math.max(1, Math.round(s.size / Math.max(200, perPage)))
  }

  private applyHeights() {
    this.starts = []
    let n = 0
    for (const s of this.sections) {
      this.starts.push(n)
      n += s.pages
    }
    this.totalPages = n
    this.content.style.height = `${PAD_TOP + n * (this.geo.pageH + GAP) - GAP + PAD_BOTTOM}px`
  }

  private pageTop(g: number) {
    return PAD_TOP + g * (this.geo.pageH + GAP)
  }

  /** The (section position, page) a global page index is. */
  private where(g: number) {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= g) lo = mid
      else hi = mid - 1
    }
    return { k: lo, p: g - this.starts[lo] }
  }

  /** Where the top of the screen is, to keep it there when pages change. */
  private anchorNow() {
    const y = this.el.scrollTop
    const g = Math.max(0, Math.min(this.totalPages - 1, Math.floor((y - PAD_TOP) / (this.geo.pageH + GAP))))
    const { k, p } = this.where(g)
    return { k, p, off: (y - this.pageTop(g)) / this.geo.pageH }
  }

  private restoreAnchor(a: { k: number; p: number; off: number }) {
    const s = this.sections[a.k]
    if (!s) return
    const p = Math.min(a.p, s.pages - 1)
    this.el.scrollTop = this.pageTop(this.starts[a.k] + p) + a.off * this.geo.pageH
  }

  /** Dragging a window's edge or stepping the text size sends many changes: lay out once they stop. */
  private relayoutSoon() {
    clearTimeout(this.relayoutT)
    this.relayoutT = setTimeout(() => this.relayout(), 120)
  }

  /** Text size, width or the screen changed: everything is laid out again, and you stay where you were. */
  private relayout() {
    if (this.closed) return
    const cfi = this.lastLocation?.cfi
    const frac = this.lastLocation?.fraction
    this.layoutGeometry()
    this.layoutGen++
    for (const s of this.sections) {
      s.measured = this.fixed
      if (this.fixed) s.pages = 1
    }
    this.measuredDoc = null
    for (const list of this.tocBySection.values()) for (const t of list) if (t.href.includes('#')) t.pos = null
    for (const m of this.mounted.values()) this.drop(m)
    this.mounted.clear()
    this.estimate()
    this.applyHeights()
    // A jump under way still goes where you asked (it waits for the new count): you weren't staying here.
    const jumping = this.settled !== this.jump
    const back = jumping ? Promise.resolve() : cfi ? this.goTo(cfi, 'top') : frac != null ? this.goToFraction(frac) : Promise.resolve()
    void back.finally(() => this.render())
    this.measureAll()
  }

  // ── Book page documents ───────────────────────────────────────────────
  private docCss() {
    const { textW, textH, colGap } = this.geo
    const L = this.look
    const a = L.dark ? 0.38 : 0.5
    return `
      @namespace epub "http://www.idpf.org/2007/ops";
      html {
        height: ${textH}px !important; width: ${textW}px !important; max-width: none !important; min-height: 0 !important;
        column-width: ${textW}px !important; column-gap: ${colGap}px !important; column-fill: auto !important;
        overflow: hidden !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important;
        font-size: ${(BASE_PX * L.size * this.geo.zoom) / 100}px !important; -webkit-text-size-adjust: none; text-size-adjust: none;
        background: transparent !important; color: ${L.fg} !important; color-scheme: ${L.dark ? 'dark' : 'light'};
        touch-action: pan-x pan-y;
      }
      body {
        margin: 0 !important; padding: 0 !important; background: transparent !important; color: inherit !important; line-height: 1.72 !important;
        width: auto !important; max-width: none !important; height: auto !important; min-height: 0 !important; overflow: visible !important;
        overflow-wrap: break-word;
      }
      /* Your text size wins over the book's own (many books fix it in px or pt, right down to single words). */
      body, section, article, div, p, li, dd, dt, dl, ol, ul, blockquote, table, tbody, thead, tfoot, tr, td, th, caption, pre,
      figure, figcaption, aside, header, footer, main, nav, center, address, label { font-size: 1rem !important; }
      span, a, em, i, b, strong, u, s, cite, q, abbr, code, kbd, samp, var, font, big, mark, ins, del { font-size: inherit !important; }
      h1 { font-size: 1.6rem !important; } h2 { font-size: 1.4rem !important; } h3 { font-size: 1.22rem !important; }
      h4, h5, h6 { font-size: 1.08rem !important; }
      small, sub, sup { font-size: 0.8em !important; }
      p, li, dd, dt, blockquote, div { line-height: 1.72 !important; }
      p { margin-top: 0 !important; margin-bottom: 0.9em !important; widows: 2; orphans: 2; }
      h1, h2, h3, h4, h5, h6 { line-height: 1.3 !important; margin: 1.2em 0 0.65em !important; break-after: avoid; }
      /* Nothing wider than the page: it would run over the next page's text. */
      body * { max-width: 100% !important; }
      img, svg, video { max-height: ${textH}px !important; height: auto; object-fit: contain; break-inside: avoid; }
      table { width: auto !important; table-layout: auto !important; }
      td, th { overflow-wrap: anywhere; }
      pre { white-space: pre-wrap !important; }
      ${L.dark ? 'body * { color: inherit !important; background-color: transparent !important; }' : ''}
      a:link, a:visited { color: ${L.link} !important; }
      aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none !important; }
      ::selection { background: ${L.dark ? 'rgba(124, 184, 255, .35)' : 'rgba(0, 112, 243, .2)'}; }
      ${Object.entries(HL_RGB).map(([c, rgb]) => `::highlight(irb-${c}) { background-color: rgba(${rgb}, ${a}); }`).join('\n')}
      ::highlight(irb-search) { background-color: rgba(255, 170, 0, ${L.dark ? 0.26 : 0.3}); }
      ::highlight(irb-search-current) { background-color: rgba(255, 140, 0, ${L.dark ? 0.6 : 0.62}); }
      html.irb-nocursor, html.irb-nocursor * { cursor: none !important; }
      html.irb-lookup, html.irb-lookup * { cursor: help !important; }
    `
  }

  /** Fixed-layout pages keep their design: only what lets them sit in the frame. */
  private fixedCss() {
    return `
      html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      html.irb-nocursor, html.irb-nocursor * { cursor: none !important; }
    `
  }

  private styleDoc(doc: Document) {
    let st = doc.getElementById('irb-style') as HTMLStyleElement | null
    if (!st) {
      st = doc.createElement('style')
      st.id = 'irb-style'
      ;(doc.head ?? doc.documentElement).append(st)
    }
    st.textContent = this.fixed ? this.fixedCss() : this.docCss()
    const root = doc.documentElement
    if (!root.lang) root.lang = ([this.book.metadata?.language].flat()[0] as string | undefined) ?? ''
    if (!root.dir && this.book.dir) root.dir = this.book.dir
    root.classList.toggle('irb-nocursor', this.cursorHidden)
  }

  /** A fixed-layout page, scaled to fit its place on the desk. */
  private fitFixed(m: Mounted, doc: Document) {
    const vp = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''
    const num = (k: string) => Number(new RegExp(`${k}\\s*=\\s*([\\d.]+)`).exec(vp)?.[1] ?? 0)
    const se = doc.scrollingElement ?? doc.documentElement
    const img = doc.querySelector('img') as HTMLImageElement | null
    const w = num('width') || img?.naturalWidth || se.scrollWidth || this.geo.pageW
    const h = num('height') || img?.naturalHeight || se.scrollHeight || this.geo.pageH
    const scale = Math.min(this.geo.pageW / w, this.geo.pageH / h)
    m.frame.style.width = `${w}px`
    m.frame.style.height = `${h}px`
    m.frame.style.left = `${Math.round((this.geo.pageW - w * scale) / 2)}px`
    m.frame.style.top = `${Math.round((this.geo.pageH - h * scale) / 2)}px`
    m.frame.style.transformOrigin = 'top left'
    m.frame.style.transform = `scale(${scale})`
  }

  private rtl(doc: Document) {
    return getComputedStyle(doc.body ?? doc.documentElement).direction === 'rtl'
  }

  /** Show column `p` of a laid-out chapter. */
  private showColumn(doc: Document, p: number) {
    if (this.fixed) return
    const se = doc.scrollingElement ?? doc.documentElement
    const step = this.geo.textW + this.geo.colGap
    se.scrollTop = 0
    se.scrollLeft = (this.rtl(doc) ? -1 : 1) * p * step
  }

  private columnsOf(doc: Document) {
    const se = doc.scrollingElement ?? doc.documentElement
    return Math.max(1, Math.round((se.scrollWidth + this.geo.colGap) / (this.geo.textW + this.geo.colGap)))
  }

  /** Which column (page) a spot in a laid-out chapter is on, and how far down it. `rect` is from column 0's corner. */
  private columnOf(doc: Document, rect: DOMRect) {
    const step = this.geo.textW + this.geo.colGap
    const k = this.rtl(doc) ? Math.floor((-rect.left + this.geo.textW) / step) : Math.floor(rect.left / step)
    return { p: Math.max(0, k), y: Math.max(0, rect.top) }
  }

  private async urlOf(index: number) {
    if (!this.urls.has(index)) {
      try {
        this.urls.set(index, (await (this.book.sections[index] as unknown as { load: () => Promise<string | null> }).load()) ?? null)
      } catch {
        this.urls.set(index, null)
      }
    }
    return this.urls.get(index) ?? null
  }

  /** A section's text as it's shown (cleaned), in a document that isn't laid out: for searching and for notes. */
  private async parsed(index: number) {
    const url = await this.urlOf(index)
    if (!url) return null
    try {
      const res = await fetch(url)
      const type = (res.headers.get('content-type') ?? 'application/xhtml+xml').split(';')[0].trim() as DOMParserSupportedType
      const text = await res.text()
      const doc = new DOMParser().parseFromString(text, type)
      return doc.querySelector('parsererror') ? new DOMParser().parseFromString(text, 'text/html') : doc
    } catch {
      return null
    }
  }

  private loadFrame(frame: HTMLIFrameElement, url: string) {
    return new Promise<Document | null>((resolve) => {
      const done = () => {
        frame.removeEventListener('load', done)
        resolve(frame.contentDocument)
      }
      frame.addEventListener('load', done)
      // replace, not src: each new src would add a step to the browser's history, and Back
      // (the reader's button, Android's) would step through the hidden frame instead of leaving.
      if (frame.contentWindow) frame.contentWindow.location.replace(url)
      else frame.src = url
    })
  }

  // ── Measuring chapters ────────────────────────────────────────────────
  /** Lays a chapter out in the hidden frame and counts its pages. Call it through inMeasurer. */
  private async measure(k: number): Promise<Document | null> {
    const s = this.sections[k]
    if (!s || this.fixed) return null
    if (this.measuredDoc?.index === s.index && s.measured) return this.measuredDoc.doc
    const gen = this.layoutGen
    const url = await this.urlOf(s.index)
    if (!url || this.closed) return null
    const { textW, textH } = this.geo
    this.measurer.style.width = `${textW}px`
    this.measurer.style.height = `${textH}px`
    this.measuredDoc = null
    const doc = await this.loadFrame(this.measurer, url)
    if (!doc || this.closed) return null
    this.styleDoc(doc)
    await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, 800))])
    // The size or the screen changed meanwhile: this count is for the old layout.
    if (gen !== this.layoutGen || this.closed) return null
    const pages = this.columnsOf(doc)
    this.measuredDoc = { index: s.index, doc }
    this.placeToc(s, doc)
    const changed = s.pages !== pages
    if (!s.measured || changed) {
      const a = this.anchorNow()
      s.pages = pages
      s.measured = true
      if (changed) {
        this.estimate()
        this.applyHeights()
        this.restoreAnchor(a)
        this.reposition()
      }
    }
    return doc
  }

  /**
   * Use a chapter's laid-out document. The hidden frame shows one chapter at a time: a second load
   * would take over the first's frame (and the first would count the wrong chapter's pages), so its
   * users take turns. A jump that's been overtaken by a newer one doesn't load anything.
   */
  private inMeasurer<T>(k: number, use: (doc: Document | null) => T, jump?: number): Promise<T> {
    const turn = this.measurerTurn.then(async () => use(jump != null && jump !== this.jump ? null : await this.measure(k)))
    this.measurerTurn = turn.catch(() => {})
    return turn
  }

  /**
   * For a jump: where a spot falls depends on how many pages its chapter really has, and a new layout
   * meanwhile throws the count away. Landing on a guessed length would put you pages off, so count again.
   */
  private async whenMeasured<T>(k: number, use: (doc: Document | null) => T, jump: number) {
    let out = await this.inMeasurer(k, use, jump)
    for (let tries = 0; tries < 3 && jump === this.jump && !this.closed && !this.sections[k]?.measured; tries++) {
      out = await this.inMeasurer(k, use, jump)
    }
    return out
  }

  /** Where this chapter's contents entries are (one file can hold many chapters). */
  private placeToc(s: Section, doc: Document) {
    for (const t of this.tocBySection.get(s.index) ?? []) {
      if (!t.href.includes('#')) continue
      try {
        const a = t.anchor(doc)
        if (!a || typeof a !== 'object') {
          t.pos = 0
          continue
        }
        const { p, y } = this.columnOf(doc, rectOf(a))
        t.pos = p + y / this.geo.textH
      } catch {
        t.pos = 0
      }
    }
  }

  /** Measure every chapter, the ones near you first, a little at a time. */
  measureAll() {
    if (this.fixed) return
    const here = this.lastLocation ? (this.pos.get(this.lastLocation.section.current) ?? 0) : 0
    const order = this.sections.map((_, k) => k).sort((a, b) => Math.abs(a - here) - Math.abs(b - here))
    this.queue = order
    void this.runQueue()
  }

  private async runQueue() {
    if (this.measuring) return
    this.measuring = true
    while (this.queue.length && !this.closed) {
      const k = this.queue.shift()!
      if (!this.sections[k].measured) await this.inMeasurer(k, () => {})
      await new Promise((r) => setTimeout(r, 15))
    }
    this.measuring = false
  }

  // ── Pages on screen ───────────────────────────────────────────────────
  private onScroll() {
    if (this.frameT) return
    this.frameT = requestAnimationFrame(() => {
      this.frameT = 0
      this.render()
    })
    clearTimeout(this.relocT)
    this.relocT = setTimeout(() => this.relocate(), 120)
  }

  private drop(m: Mounted) {
    m.gone = true
    m.el.remove()
  }

  /** Mount the pages near the screen; let go of the rest. */
  render() {
    if (this.closed || !this.totalPages) return
    const { pageH } = this.geo
    const y = this.el.scrollTop
    const h = this.el.clientHeight || window.innerHeight
    const first = Math.max(0, Math.floor((y - h * 0.75 - PAD_TOP) / (pageH + GAP)))
    const last = Math.min(this.totalPages - 1, Math.floor((y + h * 1.75 - PAD_TOP) / (pageH + GAP)))
    // A page leaving the screen can show the next page of its chapter, with nothing to load (in a
    // long chapter, loading is what you'd feel).
    const spare: Mounted[] = []
    for (const [g, m] of this.mounted) {
      if (g < first - 1 || g > last + 1) {
        this.mounted.delete(g)
        spare.push(m)
      }
    }
    const wanted: number[] = []
    for (let g = first; g <= last; g++) if (!this.mounted.has(g)) wanted.push(g)
    // What's on screen first.
    const mid = (y + h / 2 - PAD_TOP) / (pageH + GAP)
    wanted.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
    for (const g of wanted) this.place(g, spare)
    for (const m of spare) this.drop(m)
  }

  private place(g: number, spare: Mounted[]) {
    const { k, p } = this.where(g)
    const i = spare.findIndex((m) => m.s === this.sections[k].index)
    if (i < 0) return void this.mount(g, k, p)
    const [m] = spare.splice(i, 1)
    m.doc?.getSelection()?.removeAllRanges()
    m.p = p
    m.el.style.top = `${this.pageTop(g)}px`
    this.mounted.set(g, m)
    if (m.doc) this.showColumn(m.doc, p)
  }

  /** After a chapter's page count changed: pages already up move to their new place. */
  private reposition() {
    const next = new Map<number, Mounted>()
    for (const m of this.mounted.values()) {
      const k = this.pos.get(m.s)!
      if (m.p >= this.sections[k].pages) {
        this.drop(m)
        continue
      }
      const g = this.starts[k] + m.p
      m.el.style.top = `${this.pageTop(g)}px`
      next.set(g, m)
    }
    this.mounted = next
    this.render()
  }

  private async mount(g: number, k: number, p: number) {
    const s = this.sections[k]
    const { pageW, pageH, padX, padY, textW, textH, left } = this.geo
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:${left}px;top:${this.pageTop(g)}px;width:${pageW}px;height:${pageH}px;overflow:hidden;background:${this.look.page};border-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 6px 22px rgba(0,0,0,.07)`
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin')
    frame.setAttribute('scrolling', 'no')
    frame.title = 'Book page'
    frame.style.cssText = `position:absolute;left:${padX}px;top:${padY}px;width:${textW}px;height:${textH}px;border:0;opacity:0;transition:opacity .15s ease`
    el.append(frame)
    const m: Mounted = { el, frame, s: s.index, p }
    this.mounted.set(g, m)
    this.content.append(el)
    // You got here before the background count did: this chapter's next.
    if (!s.measured) {
      this.queue.unshift(k)
      void this.runQueue()
    }
    const url = await this.urlOf(s.index)
    if (!url || m.gone) return
    const doc = await this.loadFrame(frame, url)
    if (!doc || m.gone) return
    this.styleDoc(doc)
    if (this.fixed) this.fitFixed(m, doc)
    this.wire(doc, s.index, m)
    this.showColumn(doc, m.p)
    m.doc = doc
    this.paint(doc, s.index)
    frame.style.opacity = '1'
    // Fonts arriving late can shift the columns: show the right one again.
    void doc.fonts?.ready.then(() => !m.gone && this.showColumn(doc, m.p))
    this.dispatchEvent(new CustomEvent('load', { detail: { doc, index: s.index } }))
    // Your exact spot can be read once the page at the top of the screen is up.
    if (!this.lastLocation?.cfi) this.relocate()
  }

  /** Links, highlights and keeping to its column, in a book page. */
  private wire(doc: Document, index: number, m: Mounted) {
    // Dragging a selection past the edge (or tabbing to a link) would slide the next column into this page.
    doc.addEventListener('scroll', () => {
      if (!m.gone) this.showColumn(doc, m.p)
    })
    doc.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (a) {
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(blob|data):/i.test(href)) {
          if (/^(https?|mailto):/i.test(href)) window.open(href, '_blank', 'noopener')
          return
        }
        const sec = this.book.sections[index] as unknown as { resolveHref?: (h: string) => string }
        const target = sec.resolveHref?.(href) ?? href
        void this.link(target, { a, doc, index }).then((r) => {
          if (r?.note) this.dispatchEvent(new CustomEvent('note', { detail: r.note }))
          else if (r?.inFlow) this.dispatchEvent(new CustomEvent('link', { detail: { target } }))
        })
        return
      }
      // A highlight under the tap opens its card.
      const at = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (!at) return
      const hit = (this.marks.get(doc) ?? []).find((x) => x.range.isPointInRange(at.startContainer, at.startOffset))
      if (hit) this.dispatchEvent(new CustomEvent('show-annotation', { detail: { value: hit.cfi, range: hit.range, index } }))
    })
  }

  /**
   * What a link or a contents entry leads to: a note to show in a card, or a place in the
   * scroll. A section outside the reading order (notes, often) can only be shown in a card.
   */
  async link(href: string, from?: { a: Element; doc: Document; index: number }): Promise<{ note?: NoteCard; inFlow: boolean } | null> {
    const r = (this.book as unknown as { resolveHref: (h: string) => { index: number; anchor: Anchor } | null }).resolveHref(href)
    if (!r || r.index < 0) return null
    const inFlow = this.pos.has(r.index)
    if (inFlow && !from) return { inFlow }
    const doc = from && from.index === r.index ? from.doc : await this.parsed(r.index)
    if (!doc) return { inFlow }
    const a = r.anchor(doc)
    const el = a && typeof a === 'object' && !('startContainer' in a) ? a : null
    const said = !!from && saysNoteRef(from.a)
    const looks = !!from && looksLikeNoteRef(from.a)
    if (inFlow && !said && !looks && !isNoteTarget(el)) return { inFlow }
    const text = noteText(el ? noteBox(el) : (doc.body ?? doc.documentElement))
    // A raised number that leads to a whole section isn't a note: go there.
    if (!text || (inFlow && !said && !isNoteTarget(el) && text.length > NOTE_MAX)) return { inFlow }
    // A note hidden in its page (an aside) or outside the reading order has nowhere to go to.
    const hidden = !!el?.closest('aside') && isNoteTarget(el)
    return { inFlow, note: { text, target: inFlow && !hidden ? href : null } }
  }

  // ── Highlights and search marks (the CSS Custom Highlight API: the book's text isn't touched) ──
  addAnnotation({ value, color }: { value: string; color?: HighlightColor }) {
    this.annotations.set(value, color ?? 'yellow')
    this.repaint(value)
    return Promise.resolve(undefined)
  }

  deleteAnnotation({ value }: { value: string }) {
    this.annotations.delete(value)
    this.repaint(value)
    return Promise.resolve(undefined)
  }

  private repaint(cfi?: string | null) {
    let index: number | undefined
    try {
      if (cfi) index = this.resolveCFI(cfi).index
    } catch {
      /* repaint everything */
    }
    for (const m of this.mounted.values()) if (m.doc && (index == null || m.s === index)) this.paint(m.doc, m.s)
  }

  private rangesIn(doc: Document, index: number, cfis: Iterable<string>) {
    const out: { cfi: string; range: Range }[] = []
    for (const cfi of cfis) {
      try {
        const r = this.resolveCFI(cfi)
        if (r.index !== index) continue
        const a = r.anchor(doc)
        if (!a) continue
        let range: Range
        if ('startContainer' in a) range = a
        else {
          range = doc.createRange()
          range.selectNodeContents(a)
        }
        out.push({ cfi, range })
      } catch {
        /* doesn't resolve in this copy of the book */
      }
    }
    return out
  }

  private paint(doc: Document, index: number) {
    const win = doc.defaultView as (Window & { CSS: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => { priority: number } }) | null
    const reg = win?.CSS?.highlights
    const H = win?.Highlight
    if (!reg || !H) return
    const marks = this.rangesIn(doc, index, this.annotations.keys())
    this.marks.set(doc, marks)
    for (const c of Object.keys(HL_RGB) as HighlightColor[]) {
      const rs = marks.filter((m) => this.annotations.get(m.cfi) === c).map((m) => m.range)
      if (rs.length) reg.set(`irb-${c}`, new H(...rs))
      else reg.delete(`irb-${c}`)
    }
    const hits = this.rangesIn(doc, index, (this.searchHits.get(index) ?? []).slice(0, 3000)).map((m) => m.range)
    if (hits.length) reg.set('irb-search', new H(...hits))
    else reg.delete('irb-search')
    const cur = this.searchCurrent ? this.rangesIn(doc, index, [this.searchCurrent]).map((m) => m.range) : []
    if (cur.length) {
      const h = new H(...cur)
      h.priority = 1
      reg.set('irb-search-current', h)
    } else reg.delete('irb-search-current')
  }

  async *search(opts: { query: string }): AsyncGenerator<{ label?: string; subitems?: SearchHit[]; progress?: number } | 'done'> {
    this.clearSearch()
    const id = this.searchId
    const [{ searchMatcher }, { textWalker }] = await Promise.all([import('foliate-js/search.js'), import('foliate-js/text-walker.js')])
    const lang = [this.book.metadata?.language].flat()[0]
    const matcher = (searchMatcher as (w: unknown, o: unknown) => (doc: Document, q: string) => Iterable<{ range: Range; excerpt: { pre: string; match: string; post: string } }>)(textWalker, { defaultLocale: typeof lang === 'string' ? lang : 'en' })
    const total = Math.max(1, Math.ceil(this.totalSize / CHARS_PER_LOC))
    for (const [k, s] of this.sections.entries()) {
      // What's marked comes from what's shown, so a hit's CFI points at the same words in the page.
      const doc = await this.parsed(s.index)
      if (id !== this.searchId) return
      const subitems: SearchHit[] = []
      if (doc) {
        // How far through the section's text each hit is: its location, near enough.
        const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT)
        const before = new Map<Node, number>()
        let chars = 0
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          before.set(n, chars)
          chars += n.nodeValue?.length ?? 0
        }
        for (const { range, excerpt } of matcher(doc, opts.query)) {
          const at = (before.get(range.startContainer) ?? 0) + range.startOffset
          const page = Math.min(total - 1, Math.floor((s.before + (at / Math.max(1, chars)) * s.size) / CHARS_PER_LOC))
          subitems.push({ cfi: this.getCFI(s.index, range), excerpt, page })
        }
      }
      yield { progress: (k + 1) / this.sections.length }
      if (id !== this.searchId) return
      if (subitems.length) {
        this.searchHits.set(s.index, subitems.map((x) => x.cfi))
        this.repaintSection(s.index)
        yield { label: this.chapterAt(subitems[0].page), subitems }
      }
    }
    yield 'done'
  }

  clearSearch() {
    this.searchId++
    if (!this.searchHits.size && !this.searchCurrent) return
    this.searchHits.clear()
    this.searchCurrent = null
    this.repaint()
  }

  /** The search hit you're on stands out from the others. */
  setSearchCurrent(cfi: string | null) {
    const was = this.searchCurrent
    this.searchCurrent = cfi
    if (was && was !== cfi) this.repaint(was)
    this.repaint(cfi)
  }

  private repaintSection(index: number) {
    for (const m of this.mounted.values()) if (m.doc && m.s === index) this.paint(m.doc, m.s)
  }

  /**
   * Finds highlights that have no exact place by their words: the copy nearest the page each was
   * on, in its own chapter first. Calls `found` with the place of each one it finds.
   */
  async locate(items: { id: string; text: string; page: number }[], found: (id: string, cfi: string) => unknown) {
    const flats = new Map<number, ReturnType<typeof flatten> | null>()
    for (const item of items) {
      const words = item.text.replace(/\s+/g, ' ').trim()
      if (!words) continue
      const chars = item.page * CHARS_PER_LOC
      const { k } = this.charsAt(chars)
      const order = this.sections.map((_, i) => i).sort((a, b) => Math.abs(a - k) - Math.abs(b - k))
      for (const i of order) {
        const s = this.sections[i]
        if (!flats.has(s.index)) {
          const doc = await this.parsed(s.index)
          flats.set(s.index, doc && flatten(doc))
        }
        if (this.closed) return
        const f = flats.get(s.index)
        if (!f) continue
        const aim = ((chars - s.before) / Math.max(1, s.size)) * f.text.length
        let best = -1
        for (let at = f.text.indexOf(words); at >= 0; at = f.text.indexOf(words, at + 1)) {
          if (best < 0 || Math.abs(at - aim) < Math.abs(best - aim)) best = at
        }
        if (best < 0) continue
        const last = best + words.length - 1
        const range = f.doc.createRange()
        range.setStart(f.nodes[f.nodeAt[best]], f.offsetAt[best])
        range.setEnd(f.nodes[f.nodeAt[last]], f.offsetAt[last] + 1)
        await found(item.id, this.getCFI(s.index, range))
        break
      }
    }
  }

  /** Is this spot comfortably on screen right now, clear of the bars? */
  isOnScreen(cfi: string) {
    try {
      const r = this.resolveCFI(cfi)
      const top = this.el.getBoundingClientRect().top
      for (const m of this.mounted.values()) {
        if (m.s !== r.index || !m.doc) continue
        const rect = rectOf(r.anchor(m.doc))
        if (rect.left < 0 || rect.left >= this.geo.textW) continue
        const y = m.frame.getBoundingClientRect().top + rect.top - top
        return y > 80 && y < this.el.clientHeight - 140
      }
    } catch {
      /* not in this copy of the book */
    }
    return false
  }

  // ── Positions ─────────────────────────────────────────────────────────
  getCFI(index: number, range?: Range) {
    const C = this.cfi!
    const base = (this.book.sections[index] as unknown as { cfi?: string }).cfi ?? C.fake.fromIndex(index)
    return range ? C.joinIndir(base, C.fromRange(range)) : base
  }

  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range | Element } {
    return (this.book as unknown as { resolveCFI: (c: string) => { index: number; anchor: (doc: Document) => Range | Element } }).resolveCFI(cfi)
  }

  /** The contents entry a spot (`pos` pages into the chapter at `k`) comes under. */
  private tocAt(k: number, pos: number): TocEntry | null {
    for (let i = k; i >= 0; i--) {
      const list = this.tocBySection.get(this.sections[i].index)
      if (!list?.length) continue
      if (i < k) return list[list.length - 1]
      // Partway-through entries aren't placed until the chapter's laid out; until then, it's the first.
      if (list.every((t) => t.pos == null)) return list[0]
      let best: TocEntry | null = null
      for (const t of list) if (t.pos != null && t.pos <= pos + 0.06) best = t
      if (best) return best
    }
    return null
  }

  private charsAt(chars: number) {
    let k = this.sections.findIndex((s) => chars < s.before + s.size)
    if (k < 0) k = this.sections.length - 1
    const s = this.sections[k]
    return { k, s, within: Math.max(0, Math.min(0.9999, (chars - s.before) / s.size)) * s.pages }
  }

  /** The chapter a location is in. */
  chapterAt(page: number) {
    const { k, within } = this.charsAt(page * CHARS_PER_LOC)
    return this.tocAt(k, within)?.label
  }

  /** The location (the book's "page", for progress) a range in a book page is at. */
  locationOf(doc: Document, index: number, range: Range) {
    const s = this.sections[this.pos.get(index) ?? 0]
    const se = doc.scrollingElement ?? doc.documentElement
    const r = rectOf(range)
    const { p, y } = this.columnOf(doc, new DOMRect(r.left + se.scrollLeft, r.top + se.scrollTop, r.width, r.height))
    const chars = s.before + ((p + y / this.geo.textH) / s.pages) * s.size
    return Math.min(Math.max(1, Math.ceil(this.totalSize / CHARS_PER_LOC)) - 1, Math.floor(chars / CHARS_PER_LOC))
  }

  /** Where you are, as the PDF reader reports it: from the top of the screen. */
  relocate() {
    if (this.closed || !this.totalPages) return
    const { pageH } = this.geo
    const y = this.el.scrollTop
    const h = this.el.clientHeight || window.innerHeight
    const at = (yy: number) => {
      const g = Math.max(0, Math.min(this.totalPages - 1, Math.floor((yy - PAD_TOP) / (pageH + GAP))))
      const { k, p } = this.where(g)
      const s = this.sections[k]
      const within = Math.max(0, Math.min(1, (yy - this.pageTop(g)) / pageH))
      return { g, k, p, within, chars: s.before + ((p + within) / s.pages) * s.size }
    }
    const top = at(y + 8)
    const bottom = at(y + h - 8)
    const s = this.sections[top.k]
    // The first words on the screen, exactly (when that page is up).
    let cfi = ''
    const m = this.mounted.get(top.g)
    if (m?.doc) {
      const yy = Math.max(0, Math.min(this.geo.textH - 2, y + 8 - this.pageTop(top.g) - this.geo.padY))
      const r = this.fixed ? null : m.doc.caretRangeFromPoint?.(this.rtl(m.doc) ? this.geo.textW - 2 : 2, yy)
      try {
        cfi = r ? this.getCFI(s.index, r) : this.getCFI(s.index)
      } catch {
        cfi = ''
      }
    }
    const total = Math.max(1, Math.ceil(this.totalSize / CHARS_PER_LOC))
    const here = top.p + top.within
    const entry = this.tocAt(top.k, here)
    // To the end of this chapter: the next contents entry in the file, or the file's end.
    const nextPos = (this.tocBySection.get(s.index) ?? []).map((t) => t.pos).find((p): p is number => p != null && p > here + 0.06)
    const leftInChapter = (((nextPos ?? s.pages) - here) / s.pages) * s.size
    this.lastLocation = {
      fraction: top.chars / this.totalSize,
      location: { current: Math.min(total - 1, Math.floor(top.chars / CHARS_PER_LOC)), next: Math.min(total, Math.floor(bottom.chars / CHARS_PER_LOC) + 1), total },
      section: { current: s.index, total: this.book.sections.length },
      time: { section: leftInChapter / 1600 },
      tocItem: entry ? { label: entry.label, href: entry.href } : null,
      cfi,
    }
    this.dispatchEvent(new CustomEvent('relocate', { detail: this.lastLocation }))
  }

  // ── Going places ──────────────────────────────────────────────────────
  private async scrollToSpot(k: number, anchor: Anchor | undefined, at: Landing, jump: number) {
    if (!this.sections[k]) return
    const spot = anchor
      ? await this.whenMeasured(
          k,
          (doc) => {
            const a = doc && anchor(doc)
            if (!doc || !a || typeof a !== 'object') return null
            const rect = rectOf(a)
            // Hidden by the book (or by us): there's no place on a page to take you to.
            return rect.width || rect.height ? this.columnOf(doc, rect) : null
          },
          jump,
        )
      : null
    if (jump !== this.jump || this.closed) return
    const s = this.sections[k]
    const p = Math.min(spot?.p ?? 0, s.pages - 1)
    const offset = at === 'top' ? 8 : at === 'bar' ? 84 : Math.round(this.el.clientHeight * 0.35)
    const d = this.geo.padY + (spot?.y ?? 0) - offset
    this.el.scrollTop = this.pageTop(this.starts[k] + p) + (at === 'middle' ? d : Math.max(0, d))
    this.render()
    this.relocate()
  }

  /** A CFI, an href in the book, or a section index. */
  async goTo(target: string | number, at: Landing = 'bar') {
    const jump = ++this.jump
    try {
      if (typeof target === 'number') {
        const k = this.pos.get(target)
        if (k != null) await this.scrollToSpot(k, undefined, at, jump)
        return
      }
      if (this.cfi?.isCFI.test(target)) {
        const r = this.resolveCFI(target)
        const k = this.pos.get(r.index)
        if (k != null) await this.scrollToSpot(k, r.anchor, at, jump)
        return
      }
      const r = (this.book as unknown as { resolveHref: (h: string) => { index: number; anchor: Anchor } | null }).resolveHref(target)
      const k = r ? this.pos.get(r.index) : undefined
      if (r && k != null) await this.scrollToSpot(k, r.anchor, at, jump)
    } catch (e) {
      console.error(e)
    } finally {
      if (jump === this.jump) this.settled = jump
    }
  }

  private async goToChars(chars: number) {
    const jump = ++this.jump
    try {
      const { k } = this.charsAt(chars)
      await this.whenMeasured(k, () => {}, jump)
      if (jump !== this.jump || this.closed) return
      const { within } = this.charsAt(chars)
      const p = Math.floor(within)
      this.el.scrollTop = this.pageTop(this.starts[k] + p) + (within - p) * this.geo.pageH
      this.render()
      this.relocate()
    } finally {
      if (jump === this.jump) this.settled = jump
    }
  }

  goToFraction(f: number) {
    return this.goToChars(Math.max(0, Math.min(1, f)) * this.totalSize)
  }

  /** A location (a bookmark, a saved spot, "page N"): exactly there, not just near it. */
  goToLocation(page: number) {
    return this.goToChars(Math.max(0, page) * CHARS_PER_LOC + 1)
  }

  /** The start of the text (past the cover and front matter, if the book says where that is). */
  async goToTextStart() {
    const lm = (this.book as unknown as { landmarks?: { type?: string[]; href: string }[] }).landmarks
    const start = lm?.find((m) => m.type?.includes('bodymatter') || m.type?.includes('text'))?.href
    if (start) await this.goTo(start)
    else await this.goToFraction(0)
  }

  /** A screen down (or up), like Space in the PDF reader. */
  next() {
    this.el.scrollBy({ top: this.el.clientHeight - 80, behavior: 'smooth' })
    return Promise.resolve()
  }
  prev() {
    this.el.scrollBy({ top: -(this.el.clientHeight - 80), behavior: 'smooth' })
    return Promise.resolve()
  }
  scrollBy(dy: number) {
    this.el.scrollBy({ top: dy, behavior: 'smooth' })
  }

  setCursorHidden(hidden: boolean) {
    if (hidden === this.cursorHidden) return
    this.cursorHidden = hidden
    this.el.style.cursor = hidden ? 'none' : ''
    for (const m of this.mounted.values()) m.doc?.documentElement.classList.toggle('irb-nocursor', hidden)
  }
}
