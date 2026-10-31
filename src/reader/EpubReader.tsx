import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, BookA, Bookmark as BookmarkIcon, ChevronLeft, ChevronRight, CornerUpLeft, FoldHorizontal, Keyboard, List, Maximize, Minimize, Minus, Plus, Search, Trash2, Trophy, Type, UnfoldHorizontal } from 'lucide-react'
import type { FoliateBook, FoliateLocation, FoliateTocItem, View } from 'foliate-js/view.js'
import { db, uid, type Book, type Bookmark, type Highlight, type HighlightColor } from '../db/db'
import { setStatus } from '../db/books'
import { IconButton } from '../components/ui/Button'
import { Sheet } from '../components/ui/Sheet'
import { useToast } from '../components/ui/Toast'
import { dailyGoal, updateSettings, useSettings, type PageTheme } from '../lib/settings'
import { useIsDark } from '../lib/theme'
import { useIsTouch, vibrate } from '../lib/hooks'
import { formatDuration } from '../lib/format'
import { CHARS_PER_LOC } from '../lib/epub'
import { dwellFor as dwellFor_, formatPages, readPagesOf } from '../lib/pages'
import { noteOwnPosition, syncNow } from '../lib/sync'
import { isNative, keepScreenOn, setImmersive, setSystemBarsDark } from '../lib/native'
import { wordFrom } from '../lib/dictionary'
import { noteText, openXPost, xPostText } from '../lib/share'
import { SubstackNoteSheet } from '../components/ShareQuote'
import { Segmented } from '../components/ui/Segmented'
import { useReadingSession } from './useReadingSession'
import { StillReading } from './StillReading'
import { HL_COLORS, HighlightPopover, SelectionToolbar, swatchOf, type ShareTo } from './HighlightTools'
import { DefinePopover, type DefineTarget } from './DefinePopover'
import { sentenceAround } from './wordAt'
import type { OpenAt } from './Reader'

// ── How it looks ────────────────────────────────────────────────────────

interface Palette {
  bg: string
  fg: string
  link: string
  dark: boolean
}
const PALETTES = {
  paper: { bg: '#fdfdfb', fg: '#1b1b1b', link: '#0b62d6', dark: false },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', link: '#8a5a1c', dark: false },
  sepiaDark: { bg: '#2a2620', fg: '#e6dcc6', link: '#e2b36c', dark: true },
  night: { bg: '#111111', fg: '#d6d3cd', link: '#7cb8ff', dark: true },
} satisfies Record<string, Palette>

/** The book's own styles, nudged to the page theme and your text size. */
function bookCss(p: Palette, size: number, lookup = false) {
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    ${lookup ? 'html, body, * { cursor: help !important; }' : ''}
    html { color-scheme: ${p.dark ? 'dark' : 'light'}; font-size: ${size}% !important; }
    html, body { background: ${p.bg} !important; color: ${p.fg} !important; }
    ${p.dark ? 'body * { color: inherit !important; background-color: transparent !important; }' : ''}
    a:link, a:visited { color: ${p.link} !important; }
    p, li, blockquote, dd { line-height: 1.6; -webkit-hyphens: auto; hyphens: auto; widows: 2; orphans: 2; }
    [align="left"] { text-align: left; } [align="right"] { text-align: right; } [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
    ::selection { background: ${p.dark ? 'rgba(124, 184, 255, .35)' : 'rgba(0, 112, 243, .2)'}; }
  `
}

type Flow = 'paginated' | 'scrolled'
interface TypePrefs {
  /** Text size, % of the book's own. */
  size: number
  /** Scroll (like the PDF reader: down through the whole book) or turn pages. */
  flow: Flow
  /** Text across the whole screen (Ctrl F), not a comfortable column. */
  wide: boolean
}
const TYPE_KEY = 'irb-epub-type-2'
const TYPE_DEFAULT: TypePrefs = { size: 100, flow: 'scrolled', wide: false }
function loadType(): TypePrefs {
  try {
    return { ...TYPE_DEFAULT, ...JSON.parse(localStorage.getItem(TYPE_KEY) || '{}') }
  } catch {
    return TYPE_DEFAULT
  }
}
const SIZE_MIN = 70
const SIZE_MAX = 240
/** How the text sits on the screen. */
function layoutOf(t: TypePrefs) {
  return {
    flow: t.flow,
    margin: '48px',
    gap: t.wide ? '3%' : '6%',
    'max-inline-size': t.wide ? '4000px' : '680px',
    'max-column-count': t.wide ? '1' : '2',
  }
}

/** This device's exact spot (a CFI) — used while it's still where the book says you are. */
const spotKey = (id: string) => `irb-epub-spot-${id}`
function loadSpot(id: string): { cfi: string; page: number } | null {
  try {
    return JSON.parse(localStorage.getItem(spotKey(id)) || 'null')
  } catch {
    return null
  }
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
const NO_HIGHLIGHTS: Highlight[] = []
const NO_BOOKMARKS: Bookmark[] = []

// ── Ranges in a book page (all within one section's document) ───────────
/** Is point (n2, o2) after point (n1, o1)? */
function after(doc: Document, n1: Node, o1: number, n2: Node, o2: number) {
  const r = doc.createRange()
  r.setStart(n1, o1)
  return r.comparePoint(n2, o2) > 0
}
const overlaps = (doc: Document, a: Range, b: Range) =>
  after(doc, a.startContainer, a.startOffset, b.endContainer, b.endOffset) && after(doc, b.startContainer, b.startOffset, a.endContainer, a.endOffset)
function union(doc: Document, a: Range, b: Range) {
  const r = doc.createRange()
  const startA = !after(doc, a.startContainer, a.startOffset, b.startContainer, b.startOffset)
  r.setStart(startA ? b.startContainer : a.startContainer, startA ? b.startOffset : a.startOffset)
  const endB = after(doc, a.endContainer, a.endOffset, b.endContainer, b.endOffset)
  r.setEnd(endB ? b.endContainer : a.endContainer, endB ? b.endOffset : a.endOffset)
  return r
}
const asRange = (doc: Document, x: Range | Element) => {
  // A range from the page's own window isn't `instanceof` this window's Range: check its shape.
  if ('startContainer' in x) return x
  const r = doc.createRange()
  r.selectNodeContents(x as Element)
  return r
}
/** A rectangle inside a book page, in the app's coordinates. */
function toApp(doc: Document, r: DOMRect) {
  const f = doc.defaultView?.frameElement?.getBoundingClientRect()
  return new DOMRect(r.left + (f?.left ?? 0), r.top + (f?.top ?? 0), r.width, r.height)
}
/** The word under a point in a book page, as a range. */
function wordAtDocPoint(doc: Document, x: number, y: number) {
  const d = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  let node: Node | null = null
  let at = 0
  if (doc.caretRangeFromPoint) {
    const c = doc.caretRangeFromPoint(x, y)
    if (c) (node = c.startContainer), (at = c.startOffset)
  } else if (d.caretPositionFromPoint) {
    const c = d.caretPositionFromPoint(x, y)
    if (c) (node = c.offsetNode), (at = c.offset)
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const t = node.textContent ?? ''
  const isW = (ch: string | undefined) => !!ch && /[\p{L}\p{M}\p{N}'’-]/u.test(ch)
  let a = at
  let b = at
  while (a > 0 && isW(t[a - 1])) a--
  while (b < t.length && isW(t[b])) b++
  const word = b > a ? wordFrom(t.slice(a, b)) : null
  if (!word) return null
  const range = doc.createRange()
  range.setStart(node, a)
  range.setEnd(node, b)
  return { word, range }
}
/** The paragraph a range starts in, as text (for the Words page's "where you saw it"). */
const paragraphOf = (r: Range) => {
  const n = r.startContainer
  const el = n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element)
  return (el?.closest('p, li, blockquote, dd, h1, h2, h3, h4, div')?.textContent ?? '').replace(/\s+/g, ' ')
}

/**
 * An EPUB, read with foliate-js: reflowable text in your page theme, turned
 * a screen at a time (or scrolled). Its "pages" are locations of 1,500
 * characters (lib/epub.ts), so your place, pages read, reading time,
 * "Still reading?" and sync work as they do for PDFs.
 */
export function EpubReader({ book, ebook, openAt }: { book: Book; ebook: FoliateBook; openAt?: OpenAt }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const settings = useSettings()
  const dark = useIsDark()
  const touch = useIsTouch()

  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const [ready, setReady] = useState(false)
  const [loc, setLoc] = useState<FoliateLocation | null>(null)
  const locRef = useRef<FoliateLocation | null>(null)
  const [chrome, setChrome] = useState(true)
  const [tocOpen, setTocOpen] = useState(false)
  const [tocTab, setTocTab] = useState<'contents' | 'highlights' | 'bookmarks'>('contents')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [typeOpen, setTypeOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [type, setType] = useState<TypePrefs>(loadType)
  const [scrub, setScrub] = useState<number | null>(null)

  const pageTheme: PageTheme = settings.pageTheme === 'auto' ? (dark ? 'night' : 'paper') : settings.pageTheme
  const pal: Palette = pageTheme === 'night' ? PALETTES.night : pageTheme === 'sepia' ? (dark ? PALETTES.sepiaDark : PALETTES.sepia) : PALETTES.paper
  const total = loc?.location.total ?? book.pageCount
  const lockChrome = tocOpen || typeOpen || searchOpen || shortcutsOpen || !settings.autoHideChrome

  // ── Highlights, notes, words ────────────────────────────────────────
  const highlights = useLiveQuery(() => db.highlights.where('bookId').equals(book.id).toArray(), [book.id]) ?? NO_HIGHLIGHTS
  const marks = useMemo(() => highlights.filter((h) => h.cfi), [highlights])
  const marksRef = useRef(marks)
  marksRef.current = marks
  /** Which section each loaded page document is. */
  const docIndex = useRef(new WeakMap<Document, number>())
  /** What's selected in the book (it lives inside a page's frame, not the app). */
  const selRef = useRef<{ doc: Document; index: number; range: Range; text: string } | null>(null)
  const [selAnchor, setSelAnchor] = useState<{ rect: DOMRect; below?: boolean; word: string | null; under: Highlight[] } | null>(null)
  const [active, setActive] = useState<{ id: string; rect: DOMRect; focusNote?: boolean } | null>(null)
  const activeHighlight = active ? (highlights.find((h) => h.id === active.id) ?? null) : null
  const [defineAt, setDefineAt] = useState<DefineTarget | null>(null)
  /** "Look up words": tap a word for its meaning (the tablet way; Shift-click does it on a PC). */
  const [lookupOn, setLookupOn] = useState(false)
  const lookupRef = useRef(lookupOn)
  lookupRef.current = lookupOn
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  /** A tap that landed on a highlight opens it — it doesn't also turn the page. */
  const annotationTap = useRef(0)
  const clearPops = () => {
    setSelAnchor(null)
    setActive(null)
    setDefineAt(null)
  }

  /** Highlights in this page's section that a range runs into (optionally just one colour). */
  const highlightsIn = (doc: Document, index: number, range: Range, color?: HighlightColor) => {
    const v = viewRef.current
    if (!v) return []
    const out: { h: Highlight; r: Range }[] = []
    for (const h of marksRef.current) {
      if (color && h.color !== color) continue
      try {
        const res = v.resolveCFI(h.cfi!)
        if (res.index !== index) continue
        const r = asRange(doc, res.anchor(doc))
        if (overlaps(doc, range, r)) out.push({ h, r })
      } catch {
        /* a highlight from an older copy of the book that no longer resolves */
      }
    }
    return out
  }

  const readSelection = (doc: Document) => {
    const sel = doc.getSelection()
    const index = docIndex.current.get(doc)
    if (!sel || sel.isCollapsed || !sel.rangeCount || index == null) {
      if (selRef.current?.doc === doc) {
        selRef.current = null
        setSelAnchor(null)
      }
      return
    }
    const range = sel.getRangeAt(0)
    const text = sel.toString().replace(/\s+/g, ' ').trim()
    if (!text) return
    selRef.current = { doc, index, range: range.cloneRange(), text }
    setSelAnchor({ rect: toApp(doc, range.getBoundingClientRect()), below: touch, word: wordFrom(text), under: highlightsIn(doc, index, range).map((x) => x.h) })
  }
  const dropSelection = () => {
    selRef.current?.doc.getSelection()?.removeAllRanges()
    selRef.current = null
    setSelAnchor(null)
  }

  const createHighlight = async (color: HighlightColor, withNote = false) => {
    const s = selRef.current
    const v = viewRef.current
    if (!s || !v) return
    // Over a highlight of the same colour: one highlight covering both, not a second, darker layer.
    const same = highlightsIn(s.doc, s.index, s.range, color)
    let range = s.range
    for (const { r } of same) range = union(s.doc, range, r)
    const now = Date.now()
    const notes = same.map((x) => x.h.note?.trim()).filter(Boolean)
    const h: Highlight = {
      id: uid(),
      bookId: book.id,
      page: locRef.current?.location.current ?? book.currentPage,
      color,
      text: range.toString().replace(/\s+/g, ' ').trim(),
      rects: [],
      cfi: v.getCFI(s.index, range),
      note: notes.length ? notes.join(String.fromCharCode(10, 10)) : undefined,
      createdAt: same.length ? Math.min(...same.map((x) => x.h.createdAt)) : now,
      updatedAt: now,
    }
    const rect = toApp(s.doc, range.getBoundingClientRect())
    await db.transaction('rw', db.highlights, async () => {
      if (same.length) await db.highlights.bulkDelete(same.map((x) => x.h.id))
      await db.highlights.add(h)
    })
    dropSelection()
    vibrate(12)
    try {
      localStorage.setItem('irb-last-color', color)
    } catch {
      /* ignore */
    }
    if (withNote) setActive({ id: h.id, rect, focusNote: true })
  }
  const lastColor = (): HighlightColor => {
    try {
      return (localStorage.getItem('irb-last-color') as HighlightColor) || 'yellow'
    } catch {
      return 'yellow'
    }
  }

  /** Remove highlights (with Undo). */
  const removeHighlights = async (hs: Highlight[]) => {
    if (!hs.length) return
    dropSelection()
    setActive(null)
    await db.highlights.bulkDelete(hs.map((h) => h.id))
    toast({ message: hs.length === 1 ? 'Highlight removed' : `${hs.length} highlights removed`, action: { label: 'Undo', onClick: () => void db.highlights.bulkPut(hs) } })
  }

  // Sharing a quote: X opens its post screen; Substack gets a Note to check first.
  const shareQuote = (text: string, to: ShareTo) => {
    if (!text.trim()) return
    if (to === 'x') openXPost(xPostText(text, book))
    else setNoteDraft(noteText(text, book))
  }
  const copyText = async (text: string) => {
    if (!text) return
    await navigator.clipboard?.writeText(text).catch(() => {})
    toast({ id: 'copy', message: 'Copied to clipboard', duration: 1500 })
  }

  /** A word's meaning, by the word — and it goes on the Words page, with its sentence. */
  const define = (doc: Document, word: string, range: Range) => {
    setDefineAt({
      word,
      rect: toApp(doc, range.getBoundingClientRect()),
      below: touch,
      source: { bookId: book.id, page: locRef.current?.location.current ?? book.currentPage, context: sentenceAround(paragraphOf(range), word) },
    })
  }

  // ── Search in the book ──────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ label: string; items: { cfi: string; excerpt: { pre: string; match: string; post: string } }[] }[]>([])
  const [scanned, setScanned] = useState<number | null>(null)
  useEffect(() => {
    const v = viewRef.current
    if (!searchOpen || !v || !ready) return
    const q = query.trim()
    if (q.length < 2) {
      v.clearSearch()
      setResults([])
      setScanned(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const out: typeof results = []
      setResults([])
      setScanned(0)
      try {
        for await (const r of v.search({ query: q })) {
          if (cancelled || r === 'done') break
          if (r.subitems) {
            out.push({ label: r.label ?? '', items: r.subitems })
            setResults([...out])
          } else if (typeof r.progress === 'number') setScanned(r.progress)
        }
      } catch (e) {
        console.error(e)
      }
      if (!cancelled) setScanned(null)
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, searchOpen, ready])
  const hits = results.reduce((a, g) => a + g.items.length, 0)

  // ── Your place ──────────────────────────────────────────────────────
  /** Only a spot you moved to is saved: opening, restoring, resizing or the book settling its layout don't count. */
  const movable = useRef(false)
  /** When you last did something (a tap, key, swipe, the bars) — a relocation soon after is you moving. */
  const lastInput = useRef(0)
  const touched = () => (lastInput.current = performance.now())
  const myPositionAt = useRef(book.positionAt ?? 0)
  const movedHere = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const persist = useCallback(() => {
    const d = locRef.current
    if (!d || !movedHere.current) return
    const at = Date.now()
    myPositionAt.current = at
    noteOwnPosition(at)
    try {
      localStorage.setItem(spotKey(book.id), JSON.stringify({ cfi: d.cfi, page: d.location.current }))
    } catch {
      /* storage full: the location below still gets you close */
    }
    return db.books.update(book.id, { currentPage: d.location.current, pageOffset: 0, positionAt: at, lastOpenedAt: at })
  }, [book.id])

  // Opening a book makes it "currently reading"; this spot is where this device's reading grows from.
  useEffect(() => {
    db.books.update(book.id, { positionBase: book.positionAt ?? 0, lastOpenedAt: Date.now() })
    if (book.status === 'queued' || book.status === 'none') setStatus(book.id, 'reading')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  // ── Pages (locations) actually read ─────────────────────────────────
  const readSet = useRef<Set<number>>(readPagesOf(book))
  const readSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const finishOffered = useRef(book.status === 'finished')
  const flushRead = useCallback(() => {
    const set = readSet.current
    if (set.size) db.books.update(book.id, { readPages: formatPages(set), furthestPage: Math.max(0, ...set) })
  }, [book.id])
  const onPageRead = useCallback(
    (page: number) => {
      // The whole screen counts: every location it shows.
      const end = Math.max(page, (locRef.current?.location.next ?? page + 1) - 1)
      let grew = false
      for (let p = page; p <= end; p++) if (!readSet.current.has(p)) (readSet.current.add(p), (grew = true))
      if (!grew) return
      clearTimeout(readSaveTimer.current)
      readSaveTimer.current = setTimeout(flushRead, 1500)
      const n = locRef.current?.location.total ?? book.pageCount
      if (!finishOffered.current && end >= n - 1 && n > 1 && readSet.current.size / n >= 0.75) {
        finishOffered.current = true
        toast({
          message: 'You reached the end',
          description: `Mark “${book.title}” as finished?`,
          action: { label: 'Finished', onClick: () => setStatus(book.id, 'finished') },
          duration: 10000,
        })
      }
    },
    [book.id, book.pageCount, book.title, flushRead, toast],
  )
  // Read on another device (sync) joins ours — unless progress was set by hand, which replaces it.
  const setAtSeen = useRef(book.readPagesSetAt ?? 0)
  useEffect(() => {
    const theirs = readPagesOf(book)
    if ((book.readPagesSetAt ?? 0) > setAtSeen.current) {
      setAtSeen.current = book.readPagesSetAt ?? 0
      readSet.current = theirs
      return
    }
    for (const p of theirs) readSet.current.add(p)
  }, [book.readPages, book.readPagesSetAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reading time ────────────────────────────────────────────────────
  const goalMin = dailyGoal(settings)
  const { sessionSeconds, idle, asking, away, stillHere, countAway, dismissAway } = useReadingSession({
    bookId: book.id,
    currentPage: loc?.location.current ?? book.currentPage,
    enabled: ready,
    goalSeconds: goalMin * 60,
    onGoalReached: () => {
      vibrate(20)
      toast({ message: <span className="inline-flex items-center gap-1.5"><Trophy className="size-4 text-warning" /> Daily goal reached</span>, description: `${goalMin} minutes of reading today. Keep the streak going.`, duration: 5000 })
    },
    // A location is 1,500 characters; the screen takes as long as the locations it shows.
    dwellFor: () => dwellFor_(CHARS_PER_LOC),
    pageSeconds: () => {
      const l = locRef.current?.location
      return Math.max(30, Math.min(600, Math.max(1, (l?.next ?? 1) - (l?.current ?? 0)) * 60))
    },
    onPageRead,
  })
  // Taps, keys and swipes inside the book's frames don't reach the window: tell the clock they're you.
  const poke = useRef(stillHere)
  poke.current = stillHere

  // ── Opening and restoring ───────────────────────────────────────────
  /** Opened at a note or a word (not "continue from"): your spot stays until you read on, and you can go back to it. */
  const [peek, setPeek] = useState(!!openAt && !openAt.move)
  /** What the page listeners call — always this render's version. */
  const live = useRef({ readSelection, define, clearPops, showAnnotation: (_: { value: string; range: Range }) => {} })
  live.current = {
    readSelection,
    define,
    clearPops,
    showAnnotation: ({ value, range }) => {
      const h = marksRef.current.find((m) => m.cfi === value)
      const doc = range?.startContainer?.ownerDocument
      if (!h || !doc) return
      setSelAnchor(null)
      setActive({ id: h.id, rect: toApp(doc, range.getBoundingClientRect()) })
    },
  }
  const touchRef = useRef(touch)
  touchRef.current = touch
  const chromeRef = useRef({ lock: lockChrome })
  chromeRef.current.lock = lockChrome
  const flowRef = useRef(type.flow)
  flowRef.current = type.flow
  const typeRef = useRef(type)
  typeRef.current = type
  /** Text bigger (+1) or smaller (−1), from the keys, Ctrl+wheel or the panel. */
  const zoom = (dir: 1 | -1) => setType((t) => ({ ...t, size: Math.max(SIZE_MIN, Math.min(SIZE_MAX, t.size + dir * 10)) }))
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  useEffect(() => {
    const el = document.createElement('foliate-view') as View
    el.style.cssText = 'display:block;width:100%;height:100%'
    host.current!.append(el)
    viewRef.current = el
    let alive = true

    const prevFraction = { current: null as number | null }
    const onRelocate = (e: Event) => {
      const d = (e as CustomEvent<FoliateLocation>).detail
      // Somewhere else now: cards and toolbars pinned to the old screen go.
      if (locRef.current && locRef.current.cfi !== d.cfi) live.current.clearPops()
      locRef.current = d
      setLoc(d)
      if (!movable.current || performance.now() - lastInput.current > 2500) return
      poke.current()
      movedHere.current = true
      setPeek(false)
      // Like the PDF reader: the bars go as you read on, and come back when you go back up.
      const back = prevFraction.current != null && d.fraction < prevFraction.current - 0.0005
      prevFraction.current = d.fraction
      if (back) setChrome(true)
      else if (!chromeRef.current.lock) setChrome(false)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(persist, 500)
    }
    let lastMove = 0
    const onDocLoad = (e: Event) => {
      const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail
      docIndex.current.set(doc, index)
      let selT: ReturnType<typeof setTimeout> | undefined
      doc.addEventListener('selectionchange', () => {
        clearTimeout(selT)
        selT = setTimeout(() => live.current.readSelection(doc), touchRef.current ? 250 : 80)
      })
      // A tap in the book closes an open highlight card or meaning (they live outside the page).
      doc.addEventListener('pointerdown', () => {
        setActive(null)
        setDefineAt(null)
      })
      const active = () => {
        touched()
        poke.current()
      }
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) doc.addEventListener(ev, active, { passive: true })
      doc.addEventListener('pointermove', (m: PointerEvent) => {
        if (!m.movementX && !m.movementY) return
        const t = performance.now()
        if (t - lastMove < 1000) return
        lastMove = t
        active()
      })
      doc.addEventListener('keydown', (k) => keyRef.current(k))
      // Ctrl + wheel (and a trackpad pinch): text size, as zoom is in the PDF reader.
      doc.addEventListener(
        'wheel',
        (w: WheelEvent) => {
          if (w.ctrlKey || w.metaKey) {
            w.preventDefault()
            zoomRef.current(w.deltaY < 0 ? 1 : -1)
          }
        },
        { passive: false },
      )
      // Scrolling: a chapter is one long page; keep scrolling at its end (or start) and the
      // next (or previous) one follows, so the book scrolls through like a PDF.
      let over = 0
      let overT: ReturnType<typeof setTimeout> | undefined
      const overscroll = (dy: number) => {
        const r = el.renderer as unknown as { start: number; end: number; viewSize: number }
        if (flowRef.current !== 'scrolled' || !r) return
        const atBottom = r.viewSize - r.end <= 2
        const atTop = r.start <= 0
        if ((dy > 0 && !atBottom) || (dy < 0 && !atTop)) return void (over = 0)
        over += dy
        clearTimeout(overT)
        overT = setTimeout(() => (over = 0), 400)
        if (Math.abs(over) < 140) return
        over = 0
        touched()
        void (dy > 0 ? el.next() : el.prev())
      }
      doc.addEventListener('wheel', (w: WheelEvent) => !w.ctrlKey && !w.metaKey && overscroll(w.deltaMode === 1 ? w.deltaY * 20 : w.deltaY), { passive: true })
      let touchY: number | null = null
      doc.addEventListener('touchstart', (t: TouchEvent) => (touchY = t.touches[0]?.clientY ?? null), { passive: true })
      doc.addEventListener(
        'touchmove',
        (t: TouchEvent) => {
          const y = t.touches[0]?.clientY
          if (touchY == null || y == null) return
          overscroll((touchY - y) * 1.5)
          touchY = y
        },
        { passive: true },
      )
      // Paged: tap the left or right edge to turn, the middle for the bars.
      doc.addEventListener('click', (c: MouseEvent) => {
        if ((c.target as Element | null)?.closest?.('a[href]')) return
        if (doc.getSelection()?.isCollapsed === false) return
        // Looking words up (the toggle, or Shift-click): the tap is for the word under it.
        if (lookupRef.current || c.shiftKey) {
          const w = wordAtDocPoint(doc, c.clientX, c.clientY)
          if (w) live.current.define(doc, w.word, w.range)
          return
        }
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
        const box = el.getBoundingClientRect()
        const x = ((frame?.left ?? 0) + c.clientX - box.left) / box.width
        // A highlight under the tap opens instead (foliate says so right after this).
        setTimeout(() => {
          if (performance.now() - annotationTap.current < 300) return
          if (flowRef.current === 'paginated' && x < 0.28) void el.goLeft()
          else if (flowRef.current === 'paginated' && x > 0.72) void el.goRight()
          else setChrome((v) => !v)
        }, 0)
      })
    }
    // Highlights: drawn by foliate's overlay, each time a section's page loads.
    let Overlayer: typeof import('foliate-js/overlayer.js').Overlayer | null = null
    const onCreateOverlay = (e: Event) => {
      const { index } = (e as CustomEvent<{ index: number }>).detail
      for (const h of marksRef.current) {
        try {
          if (el.resolveCFI(h.cfi!).index === index) void el.addAnnotation({ value: h.cfi!, color: h.color })
        } catch {
          /* doesn't resolve in this copy of the book */
        }
      }
    }
    const onDraw = (e: Event) => {
      const { draw, annotation } = (e as CustomEvent<{ draw: (f: unknown, o: unknown) => void; annotation: { color: HighlightColor } }>).detail
      if (Overlayer) draw(Overlayer.highlight, { color: swatchOf(annotation.color) })
    }
    const onShowAnnotation = (e: Event) => {
      annotationTap.current = performance.now()
      live.current.showAnnotation((e as CustomEvent<{ value: string; range: Range }>).detail)
    }
    el.addEventListener('create-overlay', onCreateOverlay)
    el.addEventListener('draw-annotation', onDraw)
    el.addEventListener('show-annotation', onShowAnnotation)
    el.addEventListener('relocate', onRelocate)
    el.addEventListener('load', onDocLoad)

    ;(async () => {
      try {
        Overlayer = (await import('foliate-js/overlayer.js')).Overlayer
        await el.open(ebook)
        if (!alive) return
        for (const [k, v] of Object.entries(layoutOf(typeRef.current))) el.renderer.setAttribute(k, v)
        applyStyles()
        // Opened at a note or a word; else exactly where this device left off, if that's still
        // your spot; else the saved location.
        const spot = loadSpot(book.id)
        const note = openAt?.highlightId ? await db.highlights.get(openAt.highlightId) : undefined
        if (note?.cfi) await el.init({ lastLocation: note.cfi })
        else if (openAt && book.pageCount > 0) await el.goToFraction(Math.min(1, openAt.page / book.pageCount))
        else if (spot && spot.page === book.currentPage) await el.init({ lastLocation: spot.cfi })
        else if (book.currentPage > 0 && book.pageCount > 0) await el.goToFraction(Math.min(1, book.currentPage / book.pageCount))
        else await el.init({ showTextStart: true })
        if (!alive) return
        setReady(true)
        // What restoring just did isn't a move; what comes next is. ("Continue from page N": that's your spot now.)
        setTimeout(() => {
          movable.current = true
          if (openAt?.move) {
            movedHere.current = true
            void persist()
          }
        }, 600)
      } catch (err) {
        console.error(err)
        toast({ tone: 'error', message: 'Couldn’t open this book', description: 'The EPUB may be damaged.' })
      }
    })()
    return () => {
      alive = false
      el.removeEventListener('relocate', onRelocate)
      el.removeEventListener('load', onDocLoad)
      el.removeEventListener('create-overlay', onCreateOverlay)
      el.removeEventListener('draw-annotation', onDraw)
      el.removeEventListener('show-annotation', onShowAnnotation)
      el.close()
      el.remove()
      viewRef.current = null
    }
  }, [ebook]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyStyles = useCallback(() => viewRef.current?.renderer?.setStyles?.(bookCss(pal, type.size, lookupOn)), [pal, type.size, lookupOn])
  // Highlighter ink: multiplied into paper, a little stronger on dark pages.
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    el.style.setProperty('--overlayer-highlight-opacity', pal.dark ? '0.4' : '0.45')
    el.style.setProperty('--overlayer-highlight-blend-mode', pal.dark ? 'normal' : 'multiply')
  }, [pal.dark, ready])
  // New, recoloured or removed highlights (here or synced in): redraw just those.
  const drawn = useRef(new Map<string, HighlightColor>())
  useEffect(() => {
    const v = viewRef.current
    if (!v || !ready) return
    const now = new Map(marks.map((h) => [h.cfi!, h.color]))
    for (const cfi of drawn.current.keys()) if (!now.has(cfi)) void v.deleteAnnotation({ value: cfi }).catch(() => {})
    for (const [cfi, color] of now) if (drawn.current.get(cfi) !== color) void v.addAnnotation({ value: cfi, color }).catch(() => {})
    drawn.current = now
  }, [marks, ready])
  useEffect(() => {
    if (ready) applyStyles()
  }, [ready, applyStyles])
  useEffect(() => {
    const r = viewRef.current?.renderer
    if (ready && r) for (const [k, v] of Object.entries(layoutOf(type))) r.setAttribute(k, v)
  }, [ready, type.flow, type.wide]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      localStorage.setItem(TYPE_KEY, JSON.stringify(type))
    } catch {
      /* ignore */
    }
  }, [type])

  // Another device moved on while this book is open and you haven't moved here yet: go there.
  useEffect(() => {
    const at = book.positionAt ?? 0
    if (at <= myPositionAt.current) return
    myPositionAt.current = at
    if (movedHere.current || !ready || Math.abs(book.currentPage - (locRef.current?.location.current ?? 0)) < 1) return
    void viewRef.current?.goToFraction(book.currentPage / Math.max(1, book.pageCount))
    toast({ id: 'elsewhere', message: 'Where you left off', description: 'On your other device.', duration: 3500 })
  }, [book.positionAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving, switching window or locking the tablet: save and send now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      clearTimeout(saveTimer.current)
      flushRead()
      void Promise.resolve(persist()).then(() => syncNow())
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [persist, flushRead])
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current)
      clearTimeout(readSaveTimer.current)
      persist()
      flushRead()
    },
    [persist, flushRead],
  )

  // ── Bookmarks ───────────────────────────────────────────────────────
  const bookmarks = useLiveQuery(() => db.bookmarks.where('bookId').equals(book.id).toArray(), [book.id]) ?? NO_BOOKMARKS
  const here = loc?.location.current ?? book.currentPage
  const hereEnd = Math.max(here, (loc?.location.next ?? here + 1) - 1)
  const markedHere = bookmarks.find((b) => b.page >= here && b.page <= hereEnd)
  const toggleBookmark = async () => {
    if (markedHere) {
      await db.bookmarks.delete(markedHere.id)
      toast({ id: 'bm', message: 'Bookmark removed', duration: 1500 })
    } else {
      await db.bookmarks.add({ id: uid(), bookId: book.id, page: here, createdAt: Date.now(), updatedAt: Date.now() })
      vibrate(10)
      toast({ id: 'bm', message: `Bookmarked page ${here + 1}`, duration: 1500 })
    }
  }
  const goToPage = (page: number) => {
    touched()
    movedHere.current = true
    void viewRef.current?.goToFraction(Math.min(1, page / Math.max(1, total)))
  }

  // ── Full screen: Android's bars go (in the app); the browser's full screen (on the web) ──
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFullscreen = () => {
    if (isNative) {
      const next = !fullscreen
      setFullscreen(next)
      void setImmersive(next)
      return
    }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }
  useEffect(() => () => void setImmersive(false), [])

  // ── Keys: the PDF reader's ──────────────────────────────────────────
  function onKey(e: KeyboardEvent) {
    const v = viewRef.current
    if (!v) return
    const mod = e.ctrlKey || e.metaKey
    // Ctrl+F: the text across the whole screen (again to undo). Search: "/" and Ctrl+Shift+F.
    if (mod && e.shiftKey && e.key.toLowerCase() === 'f') return void (e.preventDefault(), setSearchOpen(true))
    if (mod && e.key.toLowerCase() === 'f') return void (e.preventDefault(), setType((t) => ({ ...t, wide: !t.wide })))
    if (mod && (e.key === '=' || e.key === '+')) return void (e.preventDefault(), zoom(1))
    if (mod && e.key === '-') return void (e.preventDefault(), zoom(-1))
    if (mod && e.key === '0') return void (e.preventDefault(), setType((t) => ({ ...t, size: 100 })))
    if (isTyping(e.target) || mod || e.altKey) return
    // With text selected, 1–5 highlight in that colour; H in the last one.
    if (selRef.current && /^[1-5]$/.test(e.key)) return void (e.preventDefault(), createHighlight(HL_COLORS[Number(e.key) - 1].key))
    if (selRef.current && e.key.toLowerCase() === 'h') return void (e.preventDefault(), createHighlight(lastColor()))
    // Shift with arrows, Home/End or Page Up/Down extends a selection — the browser's, not a turn.
    if (e.shiftKey && /^(Arrow|Home$|End$|Page)/.test(e.key)) return
    touched()
    // Scroll mode: move the chapter's scroll position (foliate's scrollBy is for swiping pages).
    const r = v.renderer as unknown as { containerPosition: number }
    const nudge = (dy: number) => (r.containerPosition = r.containerPosition + dy)
    switch (e.key) {
      case 'ArrowRight':
        void v.goRight()
        break
      case 'ArrowLeft':
        void v.goLeft()
        break
      case 'ArrowDown':
        if (type.flow !== 'scrolled') return
        nudge(60)
        break
      case 'ArrowUp':
        if (type.flow !== 'scrolled') return
        nudge(-60)
        break
      case 'PageDown':
      case ' ':
        void (e.shiftKey ? v.prev() : v.next())
        break
      case 'PageUp':
        void v.prev()
        break
      case 'j':
        if (type.flow === 'scrolled') nudge(120)
        else void v.next()
        break
      case 'k':
        if (type.flow === 'scrolled') nudge(-120)
        else void v.prev()
        break
      case 'Home':
        goToPage(0)
        break
      case 'End':
        goToPage(total - 1)
        break
      case 'b':
        void toggleBookmark()
        break
      case 't':
        setTocTab('contents')
        setTocOpen((o) => !(o && tocTab === 'contents'))
        break
      case 'n':
        setTocTab('highlights')
        setTocOpen((o) => !(o && tocTab === 'highlights'))
        break
      case 'f':
        toggleFullscreen()
        break
      case '/':
        setSearchOpen(true)
        break
      case '?':
        setShortcutsOpen(true)
        break
      case 'Escape':
        if (selRef.current) dropSelection()
        else setChrome((c) => !c)
        break
      default:
        return
    }
    e.preventDefault()
  }
  const keyRef = useRef(onKey)
  keyRef.current = onKey
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Screen and bars ─────────────────────────────────────────────────
  const awayNow = !!away && !away.back
  useEffect(() => {
    if (!settings.keepAwake || awayNow) return
    if (isNative) {
      void keepScreenOn(true)
      return () => void keepScreenOn(false)
    }
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
      } catch {
        /* battery saver or unsupported */
      }
    }
    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [settings.keepAwake, awayNow])
  useEffect(() => {
    if (lockChrome) setChrome(true)
  }, [lockChrome])
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    if (chrome) el.removeAttribute('autohide-cursor')
    else el.setAttribute('autohide-cursor', '')
  }, [chrome, ready])
  // Android's status bar sits over the top bar, or over the page once it slides away.
  useEffect(() => {
    setSystemBarsDark(chrome ? dark : pal.dark)
  }, [chrome, dark, pal.dark])
  useEffect(() => () => setSystemBarsDark(dark), [dark])

  const go = (target: string) => {
    touched()
    movedHere.current = true
    void viewRef.current?.goTo(target)
  }
  const fraction = scrub ?? loc?.fraction ?? (book.pageCount ? book.currentPage / book.pageCount : 0)
  const chapter = loc?.tocItem?.label?.trim()
  const minutesLeft = loc?.time?.section ?? 0

  return (
    <div className="relative h-dvh overflow-hidden" style={{ background: pal.bg }}>
      <div ref={host} className="absolute inset-x-0 bottom-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] top-[var(--safe-area-inset-top,env(safe-area-inset-top))]" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-body-md" style={{ color: pal.fg, opacity: 0.55 }}>
            Opening {book.title}…
          </p>
        </div>
      )}

      {/* ── Top bar ── */}
      <AnimatePresence>
        {chrome && (
          <motion.header
            key="top"
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="safe-top absolute inset-x-0 top-0 z-40 border-b border-hairline bg-canvas/88 backdrop-blur-md"
          >
            <div className="flex h-14 items-center gap-1 px-2 sm:px-3">
              <IconButton label="Back to library" tipBelow onClick={() => navigate(-1)}>
                <ArrowLeft className="size-[18px]" />
              </IconButton>
              <IconButton label="Contents" tipBelow onClick={() => setTocOpen(true)}>
                <List className="size-[18px]" />
              </IconButton>
              <div className="min-w-0 flex-1 px-2">
                <div className="truncate text-label-sm text-ink">{book.title}</div>
                {chapter && <div className="truncate text-body-sm text-mute">{chapter}</div>}
              </div>
              {settings.showSessionTimer && sessionSeconds > 0 && (
                <span className={`mr-1 hidden text-body-sm tabular sm:inline ${idle ? 'text-faint' : 'text-mute'}`} title={idle ? 'Paused' : 'Reading time this session'}>
                  {formatDuration(sessionSeconds)}
                </span>
              )}
              <IconButton label={markedHere ? 'Remove bookmark (B)' : 'Bookmark this page (B)'} tipBelow active={!!markedHere} onClick={() => void toggleBookmark()}>
                <BookmarkIcon className={`size-[18px] ${markedHere ? 'fill-link text-link' : ''}`} />
              </IconButton>
              <span className="hidden sm:inline-flex">
                <IconButton
                  label={type.wide ? 'Comfortable column (Ctrl F)' : 'Fill the screen with text (Ctrl F)'}
                  tipBelow
                  active={type.wide}
                  onClick={() => setType((t) => ({ ...t, wide: !t.wide }))}
                >
                  {type.wide ? <FoldHorizontal className="size-[18px]" /> : <UnfoldHorizontal className="size-[18px]" />}
                </IconButton>
              </span>
              <IconButton label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} tipBelow onClick={toggleFullscreen}>
                {fullscreen ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}
              </IconButton>
              {!touch && (
                <IconButton label="Keyboard shortcuts (?)" tipBelow onClick={() => setShortcutsOpen(true)}>
                  <Keyboard className="size-[18px]" />
                </IconButton>
              )}
              <IconButton label="Search in book (/)" tipBelow onClick={() => setSearchOpen(true)}>
                <Search className="size-[18px]" />
              </IconButton>
              <IconButton
                label={lookupOn ? 'Stop looking up words' : touch ? 'Look up words' : 'Look up words (or Shift-click a word)'}
                tipBelow
                active={lookupOn}
                aria-pressed={lookupOn}
                onClick={() => {
                  const on = !lookupOn
                  setLookupOn(on)
                  dropSelection()
                  if (on) toast({ id: 'lookup', message: 'Tap a word for its meaning', duration: 2500 })
                }}
              >
                <BookA className={`size-[18px] ${lookupOn ? 'text-link' : ''}`} />
              </IconButton>
              <IconButton label="Text and page" tipBelow onClick={() => setTypeOpen(true)}>
                <Type className="size-[18px]" />
              </IconButton>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* ── Bottom bar ── */}
      <AnimatePresence>
        {chrome && (
          <motion.footer
            key="bottom"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/88 pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] backdrop-blur-md"
          >
            <div className="mx-auto flex max-w-[760px] items-center gap-2 px-3 py-2.5">
              {!touch && (
                <IconButton label="Previous page" onClick={() => (touched(), void viewRef.current?.goLeft())}>
                  <ChevronLeft className="size-[18px]" />
                </IconButton>
              )}
              <div className="min-w-0 flex-1">
                <input
                  type="range"
                  min={0}
                  max={1000}
                  value={Math.round(fraction * 1000)}
                  aria-label="Where you are in the book"
                  onChange={(e) => setScrub(Number(e.target.value) / 1000)}
                  onPointerUp={() => {
                    if (scrub == null) return
                    touched()
                    movedHere.current = true
                    void viewRef.current?.goToFraction(scrub).finally(() => setScrub(null))
                  }}
                  onKeyUp={() => {
                    if (scrub == null) return
                    touched()
                    movedHere.current = true
                    void viewRef.current?.goToFraction(scrub).finally(() => setScrub(null))
                  }}
                  className="block h-1 w-full cursor-pointer accent-[var(--color-link)]"
                />
                <div className="mt-1.5 flex justify-between gap-3 text-body-sm text-mute">
                  <span className="tabular">
                    {Math.round(fraction * 100)}% · p. {scrub != null ? Math.max(1, Math.round(scrub * total)) : (loc?.location.current ?? book.currentPage) + 1} of {total}
                  </span>
                  {scrub == null && minutesLeft >= 1 && <span className="truncate">{Math.round(minutesLeft)} min left in chapter</span>}
                </div>
              </div>
              {!touch && (
                <IconButton label="Next page" onClick={() => (touched(), void viewRef.current?.goRight())}>
                  <ChevronRight className="size-[18px]" />
                </IconButton>
              )}
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      <StillReading asking={asking} away={away} stillHere={stillHere} countAway={countAway} dismissAway={dismissAway} />

      {/* Opened at a note or a word: back to where you left off. */}
      <AnimatePresence>
        {peek && ready && (
          <motion.button
            key="back"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() => {
              setPeek(false)
              const spot = loadSpot(book.id)
              const v = viewRef.current
              if (spot && spot.page === book.currentPage) void v?.goTo(spot.cfi)
              else void v?.goToFraction(book.pageCount ? book.currentPage / book.pageCount : 0)
            }}
            className="absolute bottom-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+84px)] left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-hairline bg-canvas-elevated px-4 py-2 text-body-sm font-medium text-ink shadow-floating hover:bg-hairline-soft"
          >
            <CornerUpLeft className="size-4" /> Back to page {book.currentPage + 1} · where you left off
          </motion.button>
        )}
      </AnimatePresence>

      <SelectionToolbar
        anchor={selAnchor}
        onHighlight={(c) => void createHighlight(c)}
        onNote={() => void createHighlight(lastColor(), true)}
        onCopy={() => {
          void copyText(selRef.current?.text ?? '')
          dropSelection()
        }}
        onShare={(to) => {
          shareQuote(selRef.current?.text ?? '', to)
          if (to === 'substack') dropSelection()
        }}
        onRemove={selAnchor?.under.length ? () => void removeHighlights(selAnchor.under) : undefined}
        onDefine={
          selAnchor?.word
            ? () => {
                const s = selRef.current
                if (s && selAnchor.word) define(s.doc, selAnchor.word, s.range)
                dropSelection()
              }
            : undefined
        }
      />
      <HighlightPopover
        highlight={activeHighlight}
        anchor={active ? { rect: active.rect, below: touch } : null}
        focusNote={active?.focusNote}
        onClose={() => setActive(null)}
        onColor={(c) => activeHighlight && void db.highlights.update(activeHighlight.id, { color: c, updatedAt: Date.now() })}
        onNote={(note) => activeHighlight && void db.highlights.update(activeHighlight.id, { note: note.trim() ? note : undefined, updatedAt: Date.now() })}
        onDelete={() => activeHighlight && void removeHighlights([activeHighlight])}
        onCopy={() => activeHighlight && void copyText(activeHighlight.text)}
        onShare={(to) => activeHighlight && shareQuote(activeHighlight.text, to)}
      />
      <DefinePopover target={defineAt} onClose={() => setDefineAt(null)} />
      <SubstackNoteSheet text={noteDraft} onClose={() => setNoteDraft(null)} />

      <Sheet open={tocOpen} onClose={() => setTocOpen(false)} side="left" width={380} title={book.title} description={book.author || undefined}>
        <Segmented
          size="sm"
          value={tocTab}
          onChange={setTocTab}
          ariaLabel="Contents, highlights or bookmarks"
          options={[
            { value: 'contents', label: 'Contents' },
            { value: 'highlights', label: `Highlights${marks.length ? ` · ${marks.length}` : ''}` },
            { value: 'bookmarks', label: `Bookmarks${bookmarks.length ? ` · ${bookmarks.length}` : ''}` },
          ]}
        />
        <div className="mt-4">
          {tocTab === 'contents' ? (
            <Toc
              items={ebook.toc ?? []}
              current={loc?.tocItem?.href}
              onPick={(href) => {
                setTocOpen(false)
                go(href)
              }}
            />
          ) : tocTab === 'highlights' ? (
            <HighlightList
              highlights={marks}
              onPick={(h) => {
                setTocOpen(false)
                go(h.cfi!)
              }}
              onDelete={(h) => void removeHighlights([h])}
            />
          ) : bookmarks.length ? (
            <ul className="-mx-2 space-y-0.5">
              {[...bookmarks].sort((a, b) => a.page - b.page).map((b) => (
                <li key={b.id} className="group relative">
                  <button
                    onClick={() => {
                      setTocOpen(false)
                      goToPage(b.page)
                    }}
                    className="flex w-full items-center gap-3 rounded-sm py-2.5 pl-2 pr-10 text-left text-body-md text-ink transition-colors hover:bg-hairline-soft"
                  >
                    <BookmarkIcon className="size-4 fill-link text-link" /> Page {b.page + 1}
                  </button>
                  <button
                    onClick={() => void db.bookmarks.delete(b.id)}
                    aria-label="Remove bookmark"
                    className="absolute right-1 top-1.5 grid size-8 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:bg-error/10 hover:text-error group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-mute">Press B (or the bookmark at the top) to mark a page.</p>
          )}
        </div>
      </Sheet>

      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} side="right" width={400} title="Search in book">
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Words or a phrase…"
          className="h-10 w-full rounded-md border border-hairline bg-canvas-elevated px-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
        />
        <p className="mt-2 h-5 text-body-sm text-mute">
          {query.trim().length < 2
            ? 'Type at least two letters.'
            : scanned != null
              ? `Searching… ${Math.round(scanned * 100)}%${hits ? ` · ${hits} found` : ''}`
              : hits
                ? `${hits} ${hits === 1 ? 'match' : 'matches'}`
                : 'No matches.'}
        </p>
        <div className="mt-2 space-y-4">
          {results.map((g, gi) => (
            <section key={gi}>
              {g.label && <div className="mb-1 text-mono-eyebrow text-mute">{g.label}</div>}
              <ul className="-mx-2">
                {g.items.map((it) => (
                  <li key={it.cfi}>
                    <button
                      onClick={() => {
                        setSearchOpen(false)
                        go(it.cfi)
                      }}
                      className="block w-full rounded-sm px-2 py-2 text-left text-body-md text-body transition-colors hover:bg-hairline-soft"
                    >
                      {it.excerpt.pre}
                      <mark className="rounded-[2px] bg-[#fcd34d]/70 px-0.5 text-ink">{it.excerpt.match}</mark>
                      {it.excerpt.post}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>

      <Sheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" width={420}>
        <ul className="divide-y divide-hairline">
          {SHORTCUTS.map(([k, d]) => (
            <li key={k} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-body-md text-body">{d}</span>
              <span className="flex gap-1">
                {k.split('  ').map((part) => (
                  <kbd key={part} className="rounded-[4px] border border-hairline bg-hairline-soft px-1.5 py-0.5 font-mono text-[12px] text-ink">
                    {part}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet open={typeOpen} onClose={() => setTypeOpen(false)} side="right" width={360} title="Text and page">
        <TypePanel
          type={type}
          setType={setType}
          theme={settings.pageTheme}
          setTheme={(t) => updateSettings({ pageTheme: t })}
        />
      </Sheet>
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl F', 'Fill the screen with text (again to undo)'],
  ['/  ·  Ctrl Shift F', 'Search in book'],
  ['← →', 'Previous / next screen'],
  ['Space  ·  Shift Space', 'Scroll a screen'],
  ['J  K', 'Scroll a little'],
  ['Home  End', 'Start / end of the book'],
  ['Ctrl +  Ctrl −', 'Bigger / smaller text'],
  ['Ctrl 0', 'Reset text size'],
  ['1 – 5', 'Highlight selection in a colour'],
  ['H', 'Highlight with last colour'],
  ['Shift click a word', 'Its meaning'],
  ['B', 'Bookmark page'],
  ['T  ·  N', 'Contents · Highlights'],
  ['F', 'Full screen'],
  ['Esc', 'Close / toggle controls'],
]

function HighlightList({ highlights, onPick, onDelete }: { highlights: Highlight[]; onPick: (h: Highlight) => void; onDelete: (h: Highlight) => void }) {
  if (!highlights.length)
    return <p className="text-body-md text-mute">Select text to highlight it — your highlights and notes collect here.</p>
  const sorted = [...highlights].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
  return (
    <ul className="-mx-2 space-y-0.5">
      {sorted.map((h) => (
        <li key={h.id} className="group relative">
          <button onClick={() => onPick(h)} className="flex w-full gap-3 rounded-sm py-2.5 pl-2 pr-10 text-left transition-colors hover:bg-hairline-soft">
            <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ background: swatchOf(h.color) }} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-3 text-body-md text-ink">“{h.text}”</span>
              {h.note?.trim() && <span className="mt-1.5 block rounded-sm bg-hairline-soft px-2 py-1.5 text-body-sm text-body">{h.note}</span>}
              <span className="mt-1 block text-body-sm text-faint">p. {h.page + 1}</span>
            </span>
          </button>
          <button
            onClick={() => onDelete(h)}
            aria-label="Remove highlight"
            className="absolute right-1 top-2 grid size-8 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:bg-error/10 hover:text-error group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <Trash2 className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function Toc({ items, current, onPick, depth = 0 }: { items: FoliateTocItem[]; current?: string; onPick: (href: string) => void; depth?: number }) {
  if (!items.length) return depth ? null : <p className="text-body-md text-mute">This book has no table of contents.</p>
  return (
    <ul className={depth ? '' : '-mx-2'}>
      {items.map((it, i) => (
        <li key={`${it.href}-${i}`}>
          <button
            onClick={() => it.href && onPick(it.href)}
            className={`block w-full rounded-sm py-2 pr-2 text-left text-body-md transition-colors hover:bg-hairline-soft ${it.href === current ? 'font-medium text-link' : 'text-ink'}`}
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            {it.label?.trim() || 'Untitled'}
          </button>
          {it.subitems?.length ? <Toc items={it.subitems} current={current} onPick={onPick} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  )
}

function TypePanel({ type, setType, theme, setTheme }: { type: TypePrefs; setType: (t: TypePrefs) => void; theme: PageTheme; setTheme: (t: PageTheme) => void }) {
  const size = (d: number) => setType({ ...type, size: Math.max(SIZE_MIN, Math.min(SIZE_MAX, type.size + d)) })
  const themes = useMemo(
    () =>
      [
        { value: 'auto', label: 'Auto', swatch: 'linear-gradient(135deg, #fdfdfb 50%, #111 50%)' },
        { value: 'paper', label: 'Paper', swatch: PALETTES.paper.bg },
        { value: 'sepia', label: 'Sepia', swatch: PALETTES.sepia.bg },
        { value: 'night', label: 'Night', swatch: PALETTES.night.bg },
      ] as { value: PageTheme; label: string; swatch: string }[],
    [],
  )
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 text-mono-eyebrow text-mute">Text size</div>
        <div className="flex items-center gap-3">
          <button onClick={() => size(-10)} disabled={type.size <= SIZE_MIN} aria-label="Smaller text" className="grid size-9 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft disabled:opacity-40">
            <Minus className="size-4" />
          </button>
          <div className="flex-1 text-center text-heading-md tabular text-ink">{type.size}%</div>
          <button onClick={() => size(10)} disabled={type.size >= SIZE_MAX} aria-label="Bigger text" className="grid size-9 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft disabled:opacity-40">
            <Plus className="size-4" />
          </button>
        </div>
      </section>
      <section>
        <div className="mb-2 text-mono-eyebrow text-mute">Page</div>
        <div className="grid grid-cols-4 gap-2">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={`flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 text-body-sm transition-colors ${theme === t.value ? 'border-link text-ink' : 'border-hairline text-body hover:bg-hairline-soft'}`}
            >
              <span className="size-7 rounded-full border border-hairline" style={{ background: t.swatch }} />
              {t.label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-2 text-mono-eyebrow text-mute">Layout</div>
        <div className="grid grid-cols-2 gap-2">
          {(['scrolled', 'paginated'] as Flow[]).map((f) => (
            <button
              key={f}
              onClick={() => setType({ ...type, flow: f })}
              className={`rounded-md border px-3 py-2.5 text-body-md transition-colors ${type.flow === f ? 'border-link text-ink' : 'border-hairline text-body hover:bg-hairline-soft'}`}
            >
              {f === 'paginated' ? 'Pages' : 'Scroll'}
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-2 text-mono-eyebrow text-mute">Width</div>
        <div className="grid grid-cols-2 gap-2">
          {[false, true].map((w) => (
            <button
              key={String(w)}
              onClick={() => setType({ ...type, wide: w })}
              className={`rounded-md border px-3 py-2.5 text-body-md transition-colors ${type.wide === w ? 'border-link text-ink' : 'border-hairline text-body hover:bg-hairline-soft'}`}
            >
              {w ? 'Whole screen' : 'Column'}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
