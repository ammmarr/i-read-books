import type { FoliateBook, FoliateTocItem } from 'foliate-js/view.js'
import type { HighlightColor } from '../db/db'
import { CHARS_PER_LOC } from '../lib/epub'

/**
 * An EPUB shown the way the PDF reader shows a PDF: pages one below another,
 * on the desk, in one scroll through the whole book.
 *
 * Each chapter is laid out in page-sized columns (CSS columns, so lines never
 * split across pages), and each page on screen is a frame onto one column. Only
 * the pages near the screen are mounted, like the PDF reader's. Chapters are
 * measured in the background (a hidden frame) to know their page counts; until
 * then they're estimated, and the scroll stays put when a count corrects.
 *
 * foliate-js still reads the book (sections, contents, CFIs, search); this
 * replaces only its renderer. Book pages run in sandboxed frames without
 * scripts, on top of the cleaning in lib/epub.ts.
 */

export interface PageLook {
  /** Text size, % of the default (17.5 px). */
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

interface Section {
  index: number
  size: number
  /** Characters before it (linear sections only). */
  before: number
  pages: number
  measured: boolean
  url?: string | null
}

interface Mounted {
  el: HTMLDivElement
  frame: HTMLIFrameElement
  s: number
  p: number
  doc?: Document
}

type Anchor = (doc: Document) => Range | Element | number | null | undefined

const GAP = 18 // between pages
/** Room above the first page and below the last, clear of the bars (as in the PDF reader). */
const PAD_TOP = 64
const PAD_BOTTOM = 96
const BASE_PX = 17.5
const HL_RGB: Record<HighlightColor, string> = {
  yellow: '252, 211, 77',
  green: '110, 231, 160',
  blue: '124, 184, 255',
  pink: '249, 154, 200',
  purple: '185, 164, 251',
}

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
  private sections: Section[] = []
  /** Section index → position in `sections`. */
  private pos = new Map<number, number>()
  private totalSize = 0
  private starts: number[] = []
  private totalPages = 0
  private geo = { pageW: 600, pageH: 840, padX: 48, padY: 56, textW: 504, textH: 728, colGap: 40, left: 0 }
  private mounted = new Map<number, Mounted>()
  private queue: number[] = []
  private measuring = false
  private measuredDoc: { index: number; doc: Document } | null = null
  private annotations = new Map<string, HighlightColor>()
  private searchCfis: string[] = []
  private marks = new WeakMap<Document, { cfi: string; range: Range }[]>()
  private cfi?: CFIModule
  private tocBySection = new Map<number, { label: string; href: string }>()
  private ro: ResizeObserver
  private frameT = 0
  private relocT: ReturnType<typeof setTimeout> | undefined
  private width = 0
  private cursorHidden = false
  private closed = false
  lastLocation: ScrollLocation | null = null

  constructor(host: HTMLElement, book: FoliateBook, look: PageLook) {
    super()
    this.book = book
    this.look = look
    this.el = document.createElement('div')
    this.el.style.cssText = `position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;background:${look.desk}`
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
        const sec: Section = { index, size: s.size, before: at, pages: 1, measured: false }
        at += s.size
        return sec
      })
    this.sections.forEach((s, i) => this.pos.set(s.index, i))
    this.totalSize = Math.max(1, at)

    this.el.addEventListener('scroll', () => this.onScroll(), { passive: true })
    this.ro = new ResizeObserver(() => {
      const w = this.el.clientWidth
      if (w && Math.abs(w - this.width) > 1) this.relayout()
    })
  }

  // ── Opening ───────────────────────────────────────────────────────────
  async open() {
    this.cfi = (await import('foliate-js/epubcfi.js')) as unknown as CFIModule
    await this.buildToc()
    this.layoutGeometry()
    this.estimate()
    this.applyHeights()
    this.ro.observe(this.el)
  }

  close() {
    this.closed = true
    this.ro.disconnect()
    for (const m of this.mounted.values()) m.el.remove()
    this.mounted.clear()
    this.el.remove()
  }

  private async buildToc() {
    const flat: FoliateTocItem[] = []
    const walk = (xs: FoliateTocItem[] | null | undefined) => (xs ?? []).forEach((x) => (flat.push(x), walk(x.subitems)))
    walk(this.book.toc)
    const book = this.book as FoliateBook & { resolveHref?: (h: string) => { index: number } | null }
    for (const it of flat) {
      try {
        const r = it.href ? book.resolveHref?.(it.href) : null
        if (r && r.index >= 0 && !this.tocBySection.has(r.index)) this.tocBySection.set(r.index, { label: it.label?.trim() ?? '', href: it.href })
      } catch {
        /* a broken contents entry */
      }
    }
  }

  // ── Look and geometry ─────────────────────────────────────────────────
  setLook(look: PageLook) {
    const relayout = look.size !== this.look.size || look.wide !== this.look.wide
    this.look = look
    this.el.style.background = look.desk
    for (const m of this.mounted.values()) {
      m.el.style.background = look.page
      if (m.doc) this.styleDoc(m.doc)
    }
    if (relayout) this.relayout()
  }

  private layoutGeometry() {
    const w = this.el.clientWidth || window.innerWidth
    this.width = w
    const side = w < 600 ? 10 : 28
    const pageW = Math.round(this.look.wide ? w - side * 2 : Math.min(w - side * 2, 760))
    const pageH = Math.round(pageW * (this.look.wide ? 1.15 : 1.414))
    const padX = Math.round(Math.max(22, Math.min(76, pageW * 0.09)))
    const padY = Math.round(Math.max(30, Math.min(84, pageH * 0.065)))
    this.geo = { pageW, pageH, padX, padY, textW: pageW - padX * 2, textH: pageH - padY * 2, colGap: padX * 2, left: Math.round((w - pageW) / 2) }
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

  /** Text size, width or the screen changed: everything is laid out again, and you stay where you were. */
  private relayout() {
    const cfi = this.lastLocation?.cfi
    const frac = this.lastLocation?.fraction
    this.layoutGeometry()
    for (const s of this.sections) s.measured = false
    this.measuredDoc = null
    for (const m of this.mounted.values()) m.el.remove()
    this.mounted.clear()
    this.estimate()
    this.applyHeights()
    if (cfi) void this.goTo(cfi)
    else if (frac != null) void this.goToFraction(frac)
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
        font-size: ${(BASE_PX * L.size) / 100}px !important; -webkit-text-size-adjust: none; text-size-adjust: none;
        background: transparent !important; color: ${L.fg} !important; color-scheme: ${L.dark ? 'dark' : 'light'};
      }
      body { margin: 0 !important; padding: 0 !important; background: transparent !important; color: inherit !important; line-height: 1.72 !important; }
      p, li, dd, dt, blockquote, div { line-height: 1.72 !important; }
      p { margin-top: 0 !important; margin-bottom: 0.9em !important; widows: 2; orphans: 2; }
      h1, h2, h3, h4, h5, h6 { line-height: 1.3 !important; margin: 1.2em 0 0.65em !important; break-after: avoid; }
      img, svg, video { max-width: 100% !important; max-height: ${textH}px !important; height: auto; object-fit: contain; break-inside: avoid; }
      table { max-width: 100%; }
      pre { white-space: pre-wrap !important; }
      ${L.dark ? 'body * { color: inherit !important; background-color: transparent !important; }' : ''}
      a:link, a:visited { color: ${L.link} !important; }
      aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none !important; }
      ::selection { background: ${L.dark ? 'rgba(124, 184, 255, .35)' : 'rgba(0, 112, 243, .2)'}; }
      ${Object.entries(HL_RGB).map(([c, rgb]) => `::highlight(irb-${c}) { background-color: rgba(${rgb}, ${a}); }`).join('\n')}
      ::highlight(irb-search) { background-color: rgba(0, 112, 243, ${L.dark ? 0.35 : 0.22}); }
      html.irb-nocursor, html.irb-nocursor * { cursor: none !important; }
      html.irb-lookup, html.irb-lookup * { cursor: help !important; }
    `
  }

  private styleDoc(doc: Document) {
    let st = doc.getElementById('irb-style') as HTMLStyleElement | null
    if (!st) {
      st = doc.createElement('style')
      st.id = 'irb-style'
      ;(doc.head ?? doc.documentElement).append(st)
    }
    st.textContent = this.docCss()
    const root = doc.documentElement
    if (!root.lang) root.lang = (this.book.metadata?.language as string | undefined) ?? ''
    if (!root.dir && this.book.dir) root.dir = this.book.dir
    root.classList.toggle('irb-nocursor', this.cursorHidden)
  }

  private rtl(doc: Document) {
    return getComputedStyle(doc.body ?? doc.documentElement).direction === 'rtl'
  }

  /** Show column `p` of a laid-out chapter. */
  private showColumn(doc: Document, p: number) {
    const se = doc.scrollingElement ?? doc.documentElement
    const step = this.geo.textW + this.geo.colGap
    se.scrollLeft = (this.rtl(doc) ? -1 : 1) * p * step
  }

  private columnsOf(doc: Document) {
    const se = doc.scrollingElement ?? doc.documentElement
    return Math.max(1, Math.round((se.scrollWidth + this.geo.colGap) / (this.geo.textW + this.geo.colGap)))
  }

  /** Which column (page) a spot in a laid-out chapter is on, and how far down it. */
  private columnOf(doc: Document, rect: DOMRect) {
    const step = this.geo.textW + this.geo.colGap
    const k = this.rtl(doc) ? Math.floor((-rect.left + this.geo.textW) / step) : Math.floor(rect.left / step)
    return { p: Math.max(0, k), y: Math.max(0, rect.top) }
  }

  private async urlOf(s: Section) {
    if (s.url === undefined) {
      try {
        s.url = (await (this.book.sections[s.index] as unknown as { load: () => Promise<string | null> }).load()) ?? null
      } catch {
        s.url = null
      }
    }
    return s.url
  }

  private loadFrame(frame: HTMLIFrameElement, url: string) {
    return new Promise<Document | null>((resolve) => {
      const done = () => {
        frame.removeEventListener('load', done)
        resolve(frame.contentDocument)
      }
      frame.addEventListener('load', done)
      frame.src = url
    })
  }

  // ── Measuring chapters ────────────────────────────────────────────────
  /** Lays a chapter out in the hidden frame and counts its pages. */
  private async measure(k: number): Promise<Document | null> {
    const s = this.sections[k]
    if (!s) return null
    if (this.measuredDoc?.index === s.index && s.measured) return this.measuredDoc.doc
    const url = await this.urlOf(s)
    if (!url || this.closed) return null
    const { textW, textH } = this.geo
    this.measurer.style.width = `${textW}px`
    this.measurer.style.height = `${textH}px`
    const doc = await this.loadFrame(this.measurer, url)
    if (!doc || this.closed) return null
    this.styleDoc(doc)
    await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, 800))])
    const pages = this.columnsOf(doc)
    this.measuredDoc = { index: s.index, doc }
    if (!s.measured || s.pages !== pages) {
      const a = this.anchorNow()
      const changed = s.pages !== pages
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

  /** Measure every chapter, the ones near you first, a little at a time. */
  measureAll() {
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
      if (!this.sections[k].measured) await this.measure(k)
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

  /** Mount the pages near the screen; let go of the rest. */
  render() {
    if (this.closed || !this.totalPages) return
    const { pageH } = this.geo
    const y = this.el.scrollTop
    const h = this.el.clientHeight || window.innerHeight
    const first = Math.max(0, Math.floor((y - h * 0.75 - PAD_TOP) / (pageH + GAP)))
    const last = Math.min(this.totalPages - 1, Math.floor((y + h * 1.75 - PAD_TOP) / (pageH + GAP)))
    for (const [g, m] of this.mounted) {
      if (g < first - 1 || g > last + 1) {
        m.el.remove()
        this.mounted.delete(g)
      }
    }
    for (let g = first; g <= last; g++) if (!this.mounted.has(g)) void this.mount(g)
  }

  /** After a chapter's page count changed: pages already up move to their new place. */
  private reposition() {
    const next = new Map<number, Mounted>()
    for (const m of this.mounted.values()) {
      const k = this.pos.get(m.s)!
      if (m.p >= this.sections[k].pages) {
        m.el.remove()
        continue
      }
      const g = this.starts[k] + m.p
      m.el.style.top = `${this.pageTop(g)}px`
      next.set(g, m)
    }
    this.mounted = next
    this.render()
  }

  private async mount(g: number) {
    const { k, p } = this.where(g)
    const s = this.sections[k]
    const { pageW, pageH, padX, padY, textW, textH, left } = this.geo
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:${left}px;top:${this.pageTop(g)}px;width:${pageW}px;height:${pageH}px;background:${this.look.page};border-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 6px 22px rgba(0,0,0,.07)`
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin')
    frame.setAttribute('scrolling', 'no')
    frame.title = 'Book page'
    frame.style.cssText = `position:absolute;left:${padX}px;top:${padY}px;width:${textW}px;height:${textH}px;border:0;opacity:0;transition:opacity .15s ease`
    el.append(frame)
    const m: Mounted = { el, frame, s: s.index, p }
    this.mounted.set(g, m)
    this.content.append(el)
    const url = await this.urlOf(s)
    if (!url || this.mounted.get(g) !== m) return
    const doc = await this.loadFrame(frame, url)
    if (!doc || this.mounted.get(g) !== m) return
    this.styleDoc(doc)
    this.wire(doc, s.index)
    this.showColumn(doc, m.p)
    m.doc = doc
    this.paint(doc, s.index)
    frame.style.opacity = '1'
    // Fonts arriving late can shift the columns: show the right one again.
    void doc.fonts?.ready.then(() => this.mounted.get(g) === m && this.showColumn(doc, m.p))
    this.dispatchEvent(new CustomEvent('load', { detail: { doc, index: s.index } }))
    if (!this.lastLocation) this.relocate()
  }

  /** Links and highlights in a book page. */
  private wire(doc: Document, index: number) {
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
        void this.goTo(sec.resolveHref?.(href) ?? href, true)
        return
      }
      // A highlight under the tap opens its card.
      const at = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (!at) return
      const hit = (this.marks.get(doc) ?? []).find((m) => m.range.isPointInRange(at.startContainer, at.startOffset))
      if (hit) this.dispatchEvent(new CustomEvent('show-annotation', { detail: { value: hit.cfi, range: hit.range, index } }))
    })
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

  private repaint(cfi?: string) {
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
    const win = doc.defaultView as (Window & { CSS: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown }) | null
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
    const hits = this.rangesIn(doc, index, this.searchCfis).map((m) => m.range)
    if (hits.length) reg.set('irb-search', new H(...hits))
    else reg.delete('irb-search')
  }

  async *search(opts: { query: string }): AsyncGenerator<{ label?: string; subitems?: { cfi: string; excerpt: { pre: string; match: string; post: string } }[]; progress?: number } | 'done'> {
    this.clearSearch()
    const [{ searchMatcher }, { textWalker }] = await Promise.all([import('foliate-js/search.js'), import('foliate-js/text-walker.js')])
    const lang = typeof this.book.metadata?.language === 'string' ? this.book.metadata.language : 'en'
    const matcher = (searchMatcher as (w: unknown, o: unknown) => (doc: Document, q: string) => Iterable<{ range: Range; excerpt: { pre: string; match: string; post: string } }>)(textWalker, { defaultLocale: lang })
    for (const [k, s] of this.sections.entries()) {
      const sec = this.book.sections[s.index] as unknown as { createDocument?: () => Promise<Document> }
      if (!sec.createDocument) continue
      const doc = await sec.createDocument()
      const subitems = Array.from(matcher(doc, opts.query), ({ range, excerpt }) => ({ cfi: this.getCFI(s.index, range), excerpt }))
      yield { progress: (k + 1) / this.sections.length }
      if (subitems.length) {
        this.searchCfis.push(...subitems.map((x) => x.cfi))
        this.repaintSection(s.index)
        yield { label: this.tocLabel(s.index), subitems }
      }
    }
    yield 'done'
  }

  clearSearch() {
    if (!this.searchCfis.length) return
    this.searchCfis = []
    this.repaint()
  }

  private repaintSection(index: number) {
    for (const m of this.mounted.values()) if (m.doc && m.s === index) this.paint(m.doc, m.s)
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

  private tocLabel(index: number) {
    for (let i = index; i >= 0; i--) {
      const t = this.tocBySection.get(i)
      if (t) return t.label
    }
    return ''
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
      const r = m.doc.caretRangeFromPoint?.(2, yy)
      try {
        cfi = r ? this.getCFI(s.index, r) : this.getCFI(s.index)
      } catch {
        cfi = ''
      }
    }
    const total = Math.max(1, Math.ceil(this.totalSize / CHARS_PER_LOC))
    const leftInSection = (1 - (top.p + top.within) / s.pages) * s.size
    const t = this.tocBySection.get(s.index) ?? null
    const label = this.tocLabel(s.index)
    this.lastLocation = {
      fraction: top.chars / this.totalSize,
      location: { current: Math.min(total - 1, Math.floor(top.chars / CHARS_PER_LOC)), next: Math.min(total, Math.floor(bottom.chars / CHARS_PER_LOC) + 1), total },
      section: { current: s.index, total: this.book.sections.length },
      time: { section: leftInSection / 1600 },
      tocItem: label ? { label, href: t?.href ?? '' } : null,
      cfi,
    }
    this.dispatchEvent(new CustomEvent('relocate', { detail: this.lastLocation }))
  }

  // ── Going places ──────────────────────────────────────────────────────
  private async scrollToSpot(k: number, anchor?: Anchor) {
    const s = this.sections[k]
    if (!s) return
    let p = 0
    let yIn = 0
    const doc = anchor ? await this.measure(k) : null
    if (doc && anchor) {
      const a = anchor(doc)
      let rect: DOMRect | null = null
      if (a && typeof a === 'object') {
        if ('startContainer' in a) rect = a.getClientRects()[0] ?? a.getBoundingClientRect()
        else rect = (a as Element).getBoundingClientRect()
      }
      if (rect) ({ p, y: yIn } = this.columnOf(doc, rect))
      p = Math.min(p, s.pages - 1)
    }
    const top = this.pageTop(this.starts[k] + p) + (yIn ? Math.max(0, this.geo.padY + yIn - 24) : 0)
    this.el.scrollTop = top
    this.render()
    this.relocate()
  }

  /** A CFI, an href in the book, or a section index. `user`: following a link. */
  async goTo(target: string | number, user = false) {
    void user
    try {
      if (typeof target === 'number') {
        const k = this.pos.get(target)
        if (k != null) await this.scrollToSpot(k)
        return
      }
      if (this.cfi?.isCFI.test(target)) {
        const r = this.resolveCFI(target)
        const k = this.pos.get(r.index)
        if (k != null) await this.scrollToSpot(k, r.anchor)
        return
      }
      const r = (this.book as unknown as { resolveHref: (h: string) => { index: number; anchor: Anchor } | null }).resolveHref(target)
      if (!r) return
      const k = this.pos.get(r.index) ?? this.nearestLinear(r.index)
      if (k != null) await this.scrollToSpot(k, r.anchor)
    } catch (e) {
      console.error(e)
    }
  }

  private nearestLinear(index: number) {
    let best: number | undefined
    for (const [i, k] of this.pos) if (i <= index) best = k
    return best
  }

  async goToFraction(f: number) {
    const chars = Math.max(0, Math.min(1, f)) * this.totalSize
    let k = this.sections.findIndex((s) => chars < s.before + s.size)
    if (k < 0) k = this.sections.length - 1
    await this.measure(k)
    const s = this.sections[k]
    const within = Math.max(0, Math.min(0.9999, (chars - s.before) / s.size)) * s.pages
    const p = Math.floor(within)
    this.el.scrollTop = this.pageTop(this.starts[k] + p) + (within - p) * this.geo.pageH
    this.render()
    this.relocate()
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
    this.cursorHidden = hidden
    for (const m of this.mounted.values()) m.doc?.documentElement.classList.toggle('irb-nocursor', hidden)
  }
}
