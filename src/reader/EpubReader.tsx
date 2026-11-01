import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, BookA, Bookmark as BookmarkIcon, ChevronLeft, ChevronRight, FoldHorizontal, Keyboard, Maximize, Minimize, Minus, PanelLeft, Plus, Search, Trophy, Type, UnfoldHorizontal } from 'lucide-react'
import type { FoliateBook, FoliateTocItem } from 'foliate-js/view.js'
import { EpubScroller, type NoteCard, type PageLook, type ScrollLocation, type SearchHit } from './epubScroller'
import { db, uid, type Book, type Bookmark, type Highlight, type HighlightColor } from '../db/db'
import { setStatus } from '../db/books'
import { Button, IconButton } from '../components/ui/Button'
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
import { useReadingSession } from './useReadingSession'
import { StillReading } from './StillReading'
import { HL_COLORS, HighlightPopover, SelectionToolbar, type ShareTo } from './HighlightTools'
import { DefinePopover, type DefineTarget } from './DefinePopover'
import { ReaderSidebar, type SidebarTab } from './ReaderSidebar'
import { SearchPanel } from './SearchPanel'
import { ElsewherePill, GoToPage, leaveReader, PlacePill, Scrubber } from './ReaderControls'
import type { Match } from './textIndex'
import { sentenceAround } from './wordAt'
import type { OpenAt } from './Reader'

// ── How it looks ────────────────────────────────────────────────────────

interface Palette {
  /** The page. */
  bg: string
  fg: string
  link: string
  dark: boolean
}
const PALETTES = {
  paper: { bg: '#ffffff', fg: '#1b1b1b', link: '#0b62d6', dark: false },
  sepia: { bg: '#f6efdd', fg: '#3b2f1e', link: '#8a5a1c', dark: false },
  sepiaDark: { bg: '#2a2620', fg: '#e6dcc6', link: '#e2b36c', dark: true },
  night: { bg: '#171717', fg: '#d6d3cd', link: '#7cb8ff', dark: true },
} satisfies Record<string, Palette>
/** The desk the pages sit on (as in the PDF reader). */
function deskOf(theme: PageTheme, appDark: boolean) {
  if (theme === 'night') return '#0b0b0b'
  if (theme === 'sepia') return appDark ? '#1c1a15' : '#e6ddc8'
  return appDark ? '#161616' : '#ebebeb'
}

interface TypePrefs {
  /** Text size, % of the default. */
  size: number
  /** Pages across the whole screen (Ctrl F), not a comfortable column. */
  wide: boolean
}
const TYPE_KEY = 'irb-epub-type-3'
const TYPE_DEFAULT: TypePrefs = { size: 100, wide: false }
function loadType(): TypePrefs {
  try {
    return { ...TYPE_DEFAULT, ...JSON.parse(localStorage.getItem(TYPE_KEY) || '{}') }
  } catch {
    return TYPE_DEFAULT
  }
}
const SIZE_MIN = 70
const SIZE_MAX = 240

/** This device's exact spot (a CFI) — used while it's still where the book says you are. */
const spotKey = (id: string) => `irb-epub-spot-${id}`
function loadSpot(id: string): { cfi: string; page: number } | null {
  try {
    return JSON.parse(localStorage.getItem(spotKey(id)) || 'null')
  } catch {
    return null
  }
}

/** Typing, or anywhere in an open panel (a Note, search, the sidebar…): the keys are yours, not shortcuts. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('[role="dialog"]'))
const NO_HIGHLIGHTS: Highlight[] = []
const NO_BOOKMARKS: Bookmark[] = []
const NOTHING: never[] = []

/** A search result: a place in the book, by CFI, and the words around it. */
interface EpubMatch extends Match, SearchHit {}

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
/** The part of a range on the page this frame is showing (a selection can run on into columns you can't see), in the app's coordinates. */
function visibleBox(doc: Document, range: Range) {
  const w = doc.defaultView?.innerWidth ?? 0
  const rs = [...range.getClientRects()].filter((r) => r.width > 0 && r.right > 0 && r.left < w)
  if (!rs.length) return null
  const left = Math.min(...rs.map((r) => r.left))
  const top = Math.min(...rs.map((r) => r.top))
  return toApp(doc, new DOMRect(left, top, Math.max(...rs.map((r) => r.right)) - left, Math.max(...rs.map((r) => r.bottom)) - top))
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
 * An EPUB, read like a PDF: pages one below another on the desk, in one
 * scroll through the whole book (epubScroller.ts), in your page theme. Its
 * "pages" for progress are locations of 1,500 characters (lib/epub.ts), so
 * your place, pages read, reading time, "Still reading?" and sync work as
 * they do for PDFs.
 */
export function EpubReader({ book, ebook, openAt }: { book: Book; ebook: FoliateBook; openAt?: OpenAt }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const settings = useSettings()
  const dark = useIsDark()
  const touch = useIsTouch()

  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EpubScroller | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loc, setLoc] = useState<ScrollLocation | null>(null)
  const locRef = useRef<ScrollLocation | null>(null)
  const [chrome, setChrome] = useState(true)
  const [tocOpen, setTocOpen] = useState(false)
  const [tocTab, setTocTab] = useState<SidebarTab>('contents')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [typeOpen, setTypeOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [type, setType] = useState<TypePrefs>(loadType)
  const [note, setNote] = useState<NoteCard | null>(null)

  const pageTheme: PageTheme = settings.pageTheme === 'auto' ? (dark ? 'night' : 'paper') : settings.pageTheme
  const pal: Palette = pageTheme === 'night' ? PALETTES.night : pageTheme === 'sepia' ? (dark ? PALETTES.sepiaDark : PALETTES.sepia) : PALETTES.paper
  const total = loc?.location.total ?? book.pageCount
  const lockChrome = tocOpen || typeOpen || searchOpen || shortcutsOpen || !!note || !settings.autoHideChrome

  // ── Highlights, notes, words ────────────────────────────────────────
  const highlights = useLiveQuery(() => db.highlights.where('bookId').equals(book.id).toArray(), [book.id]) ?? NO_HIGHLIGHTS
  const marks = useMemo(() => highlights.filter((h) => h.cfi), [highlights])
  const marksRef = useRef(marks)
  marksRef.current = marks
  /** Which section each loaded page document is. */
  const docIndex = useRef(new WeakMap<Document, number>())
  const liveDocs = () => [...(host.current?.querySelectorAll('iframe') ?? [])].map((f) => f.contentDocument).filter((d): d is Document => !!d)
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
    // One selection at a time: each page is its own document, so one in another page doesn't go by itself.
    if (selRef.current && selRef.current.doc !== doc) selRef.current.doc.getSelection()?.removeAllRanges()
    selRef.current = { doc, index, range: range.cloneRange(), text }
    placeSelection(highlightsIn(doc, index, range).map((x) => x.h))
  }
  /** The toolbar, at the selection — while that's on screen (it comes back with it, as you scroll). */
  const placeSelection = (under?: Highlight[]) => {
    const s = selRef.current
    if (!s) return
    const rect = s.doc.defaultView ? visibleBox(s.doc, s.range) : null
    if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return setSelAnchor(null)
    setSelAnchor((a) => ({ rect, below: touch, word: wordFrom(s.text), under: under ?? a?.under ?? highlightsIn(s.doc, s.index, s.range).map((x) => x.h) }))
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
      page: v.locationOf(s.doc, s.index, range),
      color,
      text: range.toString().replace(/\s+/g, ' ').trim(),
      rects: [],
      cfi: v.getCFI(s.index, range),
      note: notes.length ? notes.join(String.fromCharCode(10, 10)) : undefined,
      createdAt: same.length ? Math.min(...same.map((x) => x.h.createdAt)) : now,
      updatedAt: now,
    }
    const rect = visibleBox(s.doc, range) ?? toApp(s.doc, range.getBoundingClientRect())
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
      source: {
        bookId: book.id,
        page: viewRef.current && docIndex.current.has(doc) ? viewRef.current.locationOf(doc, docIndex.current.get(doc)!, range) : book.currentPage,
        context: sentenceAround(paragraphOf(range), word),
      },
    })
  }

  // ── Search in the book: the PDF reader's panel, and it stays open as you go through the results ──
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<EpubMatch[]>([])
  const [matchIdx, setMatchIdx] = useState(0)
  /** Out of 100: how much of the book has been searched. */
  const [scanned, setScanned] = useState(100)
  const goToMatch = (n: number, list: EpubMatch[] = matches) => {
    const m = list[n]
    const v = viewRef.current
    if (!m || !v) return
    setMatchIdx(n)
    v.setSearchCurrent(m.cfi)
    if (!v.isOnScreen(m.cfi)) void jump(true, (x) => x.goTo(m.cfi, 'middle'))
  }
  const goToMatchRef = useRef(goToMatch)
  goToMatchRef.current = goToMatch
  const closeSearch = () => {
    setSearchOpen(false)
    setQuery('')
    setMatches([])
    viewRef.current?.clearSearch()
  }
  useEffect(() => {
    const v = viewRef.current
    setMatches([])
    setMatchIdx(0)
    setScanned(100)
    if (!searchOpen || !v || !ready) return
    const q = query.trim()
    if (q.length < 2) {
      v.clearSearch()
      return
    }
    setScanned(0)
    let cancelled = false
    const t = setTimeout(async () => {
      const found: EpubMatch[] = []
      try {
        for await (const r of v.search({ query: q })) {
          if (cancelled || r === 'done') break
          if (r.subitems) {
            for (const hit of r.subitems) found.push({ ...hit, start: 0, end: 0, n: found.length })
            setMatches([...found])
          }
          if (typeof r.progress === 'number') setScanned(Math.round(r.progress * 100))
        }
      } catch (e) {
        console.error(e)
      }
      if (cancelled) return
      setScanned(100)
      // Start from the first result at or after where you are.
      const here = locRef.current?.location.current ?? 0
      if (found.length) goToMatchRef.current(Math.max(0, found.findIndex((m) => m.page >= here)), found)
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, searchOpen, ready])

  // ── Your place ──────────────────────────────────────────────────────
  /** Only a spot you moved to is saved: opening, restoring, resizing or the book settling its layout don't count. */
  const movable = useRef(false)
  /** When you last did something (a tap, key, swipe, the bars) — a relocation soon after is you moving. */
  const lastInput = useRef(0)
  const touched = () => (lastInput.current = performance.now())
  const myPositionAt = useRef(book.positionAt ?? 0)
  const movedHere = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Jumping elsewhere — to a note, a link, a search hit, the contents, a bookmark or a page number —
  // leaves "Back to page N", like a finger holding your place. It goes once you read on from where you landed.
  const [place, setPlace] = useState<{ page: number; cfi: string } | null>(null)
  const placeRef = useRef(place)
  /** Where the last jump landed, and whether it's only a look (a note, a link, a search hit). */
  const landed = useRef<{ page: number; peek: boolean } | null>(null)
  const persist = useCallback(() => {
    const d = locRef.current
    if (!d || !movedHere.current) return
    const l = landed.current
    if (l) {
      if (d.location.current >= l.page + 2) {
        // Read on from where a jump took you: that's where you are now.
        placeRef.current = null
        landed.current = null
        setPlace(null)
      } else if (l.peek) return // Just looking: your spot stays where you left off.
    }
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
  const [readN, setReadN] = useState(() => readSet.current.size)
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
      setReadN(readSet.current.size)
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
      setReadN(theirs.size)
      return
    }
    for (const p of theirs) readSet.current.add(p)
    setReadN(readSet.current.size)
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
  /** What the page listeners call — always this render's version. */
  const live = useRef({ readSelection, define, dropSelection, placeSelection, popOpen: (): boolean => false, showAnnotation: (_: { value: string; range: Range }) => {} })
  live.current = {
    readSelection,
    define,
    dropSelection,
    placeSelection,
    popOpen: () => !!(selRef.current || active || defineAt),
    showAnnotation: ({ value, range }) => {
      const h = marksRef.current.find((m) => m.cfi === value)
      const doc = range?.startContainer?.ownerDocument
      if (!h || !doc) return
      setSelAnchor(null)
      setActive({ id: h.id, rect: visibleBox(doc, range) ?? toApp(doc, range.getBoundingClientRect()) })
    },
  }
  const touchRef = useRef(touch)
  touchRef.current = touch
  const chromeRef = useRef({ lock: lockChrome })
  chromeRef.current.lock = lockChrome
  const typeRef = useRef(type)
  typeRef.current = type
  /** Text bigger (+) or smaller (−), in steps, from the keys, Ctrl+wheel, a pinch or the panel. */
  const zoom = (dir: number) => setType((t) => ({ ...t, size: Math.max(SIZE_MIN, Math.min(SIZE_MAX, t.size + dir * 10)) }))
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  /** The mouse moved (see the pointer, below). `top`: where the page it moved over starts on the screen. */
  const mouseMoved = useRef<(e: PointerEvent, top: number) => void>(() => {})
  const look: PageLook = useMemo(
    () => ({ size: type.size, wide: type.wide, page: pal.bg, desk: deskOf(pageTheme, dark), fg: pal.fg, link: pal.link, dark: pal.dark }),
    [type.size, type.wide, pal, pageTheme, dark],
  )
  const lookRef = useRef(look)
  lookRef.current = look
  useEffect(() => {
    const el = new EpubScroller(host.current!, ebook, lookRef.current)
    viewRef.current = el
    let alive = true

    const onRelocate = (e: Event) => {
      const d = (e as CustomEvent<ScrollLocation>).detail
      locRef.current = d
      setLoc(d)
      if (!movable.current || performance.now() - lastInput.current > 2500) return
      poke.current()
      movedHere.current = true
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(persist, 500)
    }
    // Scrolling, as in the PDF reader: the bars go as you read on and come back when you go back up,
    // cards pinned to the old spot close, and the selection's toolbar stays with its text.
    const bars = { last: 0, down: 0, up: 0 }
    let scrollRaf = 0
    const onScrolled = () => {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = requestAnimationFrame(() => {
        const y = el.el.scrollTop
        const d = y - bars.last
        bars.last = y
        setActive(null)
        setDefineAt(null)
        live.current.placeSelection()
        if (performance.now() - lastInput.current > 2500) bars.down = bars.up = 0
        else if (d > 0) (bars.down += d), (bars.up = 0)
        else (bars.up -= d), (bars.down = 0)
        if (y < 40 || bars.up > 36) setChrome(true)
        else if (bars.down > 90 && !chromeRef.current.lock) setChrome(false)
      })
    }
    el.el.addEventListener('scroll', onScrolled, { passive: true })
    /** A tap that closes something open (a selection, a card) does only that. */
    let closing = false
    const noteClosing = () => {
      closing = live.current.popOpen()
    }
    // Ctrl + wheel (and a trackpad pinch, which sends many small ones): text size, as zoom is in the PDF reader.
    let wheeled = 0
    const onZoomWheel = (w: WheelEvent) => {
      if (!w.ctrlKey && !w.metaKey) return
      w.preventDefault()
      wheeled += w.deltaMode === 1 ? w.deltaY * 20 : w.deltaY
      if (Math.abs(wheeled) < 40) return
      zoomRef.current(wheeled < 0 ? 1 : -1)
      wheeled = 0
    }
    // Two fingers: text size, once they lift (laying the book out again is too much to do per frame).
    const pinchOn = (t: Document | HTMLElement) => {
      let from = 0
      let ratio = 1
      const apart = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      const down = (e: Event) => {
        const te = e as TouchEvent
        if (te.touches.length !== 2) return
        from = apart(te)
        ratio = 1
      }
      const move = (e: Event) => {
        const te = e as TouchEvent
        if (from && te.touches.length === 2) ratio = apart(te) / from
      }
      const done = () => {
        if (!from) return
        from = 0
        const steps = Math.round((ratio - 1) * 4)
        if (steps) zoomRef.current(steps)
      }
      t.addEventListener('touchstart', down, { passive: true })
      t.addEventListener('touchmove', move, { passive: true })
      t.addEventListener('touchend', done, { passive: true })
      t.addEventListener('touchcancel', done, { passive: true })
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
      // A tap in the book closes an open highlight card or meaning (they live outside the page),
      // and a selection in another page (each page is its own document).
      doc.addEventListener('pointerdown', () => {
        noteClosing()
        setActive(null)
        setDefineAt(null)
        if (selRef.current && selRef.current.doc !== doc) live.current.dropSelection()
      })
      // Shift-click is for a word's meaning: the browser's would start selecting.
      doc.addEventListener('mousedown', (m: MouseEvent) => {
        if (m.shiftKey) m.preventDefault()
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
      doc.addEventListener('pointermove', (m: PointerEvent) => mouseMoved.current(m, doc.defaultView?.frameElement?.getBoundingClientRect().top ?? 0))
      pinchOn(doc)
      doc.addEventListener('keydown', (k) => keyRef.current(k))
      doc.addEventListener('wheel', onZoomWheel, { passive: false })
      // A tap: the word's meaning when looking words up; else the bars (a highlight under it opens instead).
      doc.addEventListener('click', (c: MouseEvent) => {
        if ((c.target as Element | null)?.closest?.('a[href]')) return
        if (doc.getSelection()?.isCollapsed === false) return
        if (lookupRef.current || c.shiftKey) {
          const w = wordAtDocPoint(doc, c.clientX, c.clientY)
          if (w) live.current.define(doc, w.word, w.range)
          return
        }
        if (closing) return void (closing = false)
        setTimeout(() => {
          if (performance.now() - annotationTap.current < 300) return
          setChrome((v) => !v)
        }, 0)
      })
      doc.documentElement.classList.toggle('irb-lookup', lookupRef.current)
    }
    const onShowAnnotation = (e: Event) => {
      annotationTap.current = performance.now()
      live.current.showAnnotation((e as CustomEvent<{ value: string; range: Range }>).detail)
    }
    const onNote = (e: Event) => setNote((e as CustomEvent<NoteCard>).detail)
    const onLink = (e: Event) => void jumpRef.current(true, (v) => v.goTo((e as CustomEvent<{ target: string }>).detail.target))
    // The desk and a page's margins are outside the page frames, so they get the same treatment here.
    const onDeskInput = () => touched()
    for (const ev of ['pointerdown', 'wheel', 'touchstart']) el.el.addEventListener(ev, onDeskInput, { passive: true })
    el.el.addEventListener('wheel', onZoomWheel, { passive: false })
    pinchOn(el.el)
    el.el.addEventListener('pointerdown', noteClosing)
    el.el.addEventListener('click', () => {
      const was = closing
      closing = false
      live.current.dropSelection()
      setActive(null)
      setDefineAt(null)
      if (!was) setChrome((v) => !v)
    })
    el.addEventListener('show-annotation', onShowAnnotation)
    el.addEventListener('note', onNote)
    el.addEventListener('link', onLink)
    el.addEventListener('relocate', onRelocate)
    el.addEventListener('load', onDocLoad)

    ;(async () => {
      try {
        await el.open()
        if (!alive) return
        for (const h of marksRef.current) void el.addAnnotation({ value: h.cfi!, color: h.color })
        // Opened at a note or a word; else exactly where this device left off, if that's still
        // your spot; else the saved location.
        const spot = loadSpot(book.id)
        const mine = spot && spot.page === book.currentPage ? spot.cfi : ''
        const opened = openAt?.highlightId ? await db.highlights.get(openAt.highlightId) : undefined
        if (opened?.cfi) await el.goTo(opened.cfi, 'middle')
        else if (openAt && book.pageCount > 0) await el.goToLocation(openAt.page)
        else if (mine) await el.goTo(mine)
        else if (book.currentPage > 0 && book.pageCount > 0) await el.goToLocation(book.currentPage)
        else await el.goToTextStart()
        if (!alive) return
        setReady(true)
        // Just looking at a note or a word: your spot stays, and you can go back to it.
        const to = locRef.current?.location.current
        if (openAt && !openAt.move && to != null && to !== book.currentPage) {
          const p = { page: book.currentPage, cfi: mine }
          placeRef.current = p
          setPlace(p)
          landed.current = { page: to, peek: true }
          movedHere.current = true
        }
        el.measureAll()
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
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
      cancelAnimationFrame(scrollRaf)
      el.removeEventListener('relocate', onRelocate)
      el.removeEventListener('load', onDocLoad)
      el.removeEventListener('show-annotation', onShowAnnotation)
      el.removeEventListener('note', onNote)
      el.removeEventListener('link', onLink)
      el.close()
      viewRef.current = null
    }
  }, [ebook]) // eslint-disable-line react-hooks/exhaustive-deps

  // Theme, text size or width changed: the pages follow (and are laid out again for size or width).
  useEffect(() => {
    if (ready) viewRef.current?.setLook(look)
  }, [look, ready])
  // Looking words up: the cursor says so over the text.
  useEffect(() => {
    for (const d of liveDocs()) d.documentElement.classList.toggle('irb-lookup', lookupOn)
  }, [lookupOn]) // eslint-disable-line react-hooks/exhaustive-deps
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
    try {
      localStorage.setItem(TYPE_KEY, JSON.stringify(type))
    } catch {
      /* ignore */
    }
  }, [type])

  // Another device moved on while this book is open. If you haven't moved here yet, go there;
  // once you're reading, offer it instead of yanking the page away mid-sentence.
  const [elsewhere, setElsewhere] = useState<number | null>(null)
  useEffect(() => {
    const at = book.positionAt ?? 0
    if (at <= myPositionAt.current) return
    myPositionAt.current = at
    if (!ready || Math.abs(book.currentPage - (locRef.current?.location.current ?? 0)) < 1) return
    if (!movedHere.current) {
      void viewRef.current?.goToLocation(book.currentPage)
      toast({ id: 'elsewhere', message: `Page ${book.currentPage + 1}`, description: 'Where you left off on your other device.', duration: 3500 })
    } else setElsewhere(book.currentPage)
  }, [book.positionAt]) // eslint-disable-line react-hooks/exhaustive-deps
  // You read on here from an older spot while your other device had got further: keep yours, and offer theirs.
  useEffect(() => {
    const o = book.otherPosition
    if (o && o.page > (locRef.current?.location.current ?? book.currentPage)) setElsewhere(o.page)
  }, [book.otherPosition?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  const dropOther = () => {
    if (book.otherPosition) void db.books.update(book.id, { otherPosition: undefined })
  }

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
  const bmPages = useMemo(() => new Set(bookmarks.map((b) => b.page)), [bookmarks])
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
  const releasePlace = () => {
    placeRef.current = null
    landed.current = null
    setPlace(null)
  }
  /**
   * Go somewhere else in the book, holding your place (once — the first spot is "where you left
   * off"). `peek`: just looking (a note, a link, a search hit), so your spot stays until you read on.
   */
  const jump = async (peek: boolean, go: (v: EpubScroller) => Promise<unknown>) => {
    const v = viewRef.current
    const d = locRef.current
    if (!v || !d) return
    touched()
    movedHere.current = true
    const first = !placeRef.current
    if (first) {
      clearTimeout(saveTimer.current)
      void persist()
      const p = { page: d.location.current, cfi: d.cfi }
      placeRef.current = p
      setPlace(p)
    }
    await go(v)
    const to = locRef.current?.location.current ?? d.location.current
    if (first && to === d.location.current) return releasePlace()
    landed.current = { page: to, peek }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 500)
  }
  const jumpRef = useRef(jump)
  jumpRef.current = jump
  const goBack = () => {
    const r = placeRef.current
    if (!r) return
    releasePlace()
    touched()
    const v = viewRef.current
    void (r.cfi ? v?.goTo(r.cfi) : v?.goToLocation(r.page))
  }
  /** Dismissing "Back to page N": here is where you are now. */
  const stayHere = () => {
    releasePlace()
    movedHere.current = true
    clearTimeout(saveTimer.current)
    void persist()
  }
  const goToPage = (page: number) => void jump(false, (v) => v.goToLocation(page))
  const followContents = async (href: string) => {
    setTocOpen(false)
    const r = await viewRef.current?.link(href)
    if (r?.note) setNote(r.note)
    else if (r?.inFlow) void jump(false, (v) => v.goTo(href))
  }
  const copyAllHighlights = async () => {
    const sorted = [...marks].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
    const md = [
      `# ${book.title}${book.author ? ` — ${book.author}` : ''}`,
      '',
      ...sorted.flatMap((h) => [`> ${h.text}`, `— p. ${h.page + 1}`, ...(h.note ? ['', h.note] : []), '']),
    ].join(String.fromCharCode(10))
    await navigator.clipboard?.writeText(md).catch(() => {})
    toast({ message: `${sorted.length} highlights copied`, description: 'As Markdown — paste anywhere.' })
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
    switch (e.key) {
      case 'ArrowRight':
        void v.next()
        break
      case 'ArrowLeft':
        void v.prev()
        break
      case 'ArrowDown':
        v.scrollBy(60)
        break
      case 'ArrowUp':
        v.scrollBy(-60)
        break
      case 'PageDown':
      case ' ':
        void (e.shiftKey ? v.prev() : v.next())
        break
      case 'PageUp':
        void v.prev()
        break
      case 'j':
        v.scrollBy(120)
        break
      case 'k':
        v.scrollBy(-120)
        break
      case 'Home':
        void jump(false, (x) => x.goToFraction(0))
        break
      case 'End':
        void jump(false, (x) => x.goToFraction(1))
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
        if (searchOpen) closeSearch()
        else if (selRef.current) dropSelection()
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
  // The pointer goes away with the bars, so nothing sits on the page while you read. Moving the
  // mouse brings it back; it goes again after a moment still. At the top or bottom edge, so do the bars.
  useEffect(() => {
    const v = viewRef.current
    if (!v || !ready) return
    let t: ReturnType<typeof setTimeout> | undefined
    if (!chrome) v.setCursorHidden(true)
    mouseMoved.current = (e, top) => {
      // Scrolling fires mouse moves too, without the mouse moving.
      if (e.pointerType !== 'mouse' || (!e.movementX && !e.movementY)) return
      v.setCursorHidden(false)
      clearTimeout(t)
      if (chrome) return
      const y = top + e.clientY
      if (y < 72 || window.innerHeight - y < 96) setChrome(true)
      else t = setTimeout(() => v.setCursorHidden(true), 1500)
    }
    const onMove = (e: PointerEvent) => mouseMoved.current(e, 0)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointermove', onMove)
      mouseMoved.current = () => {}
      v.setCursorHidden(false)
    }
  }, [chrome, ready])
  // Android's status bar sits over the top bar, or over the page once it slides away.
  useEffect(() => {
    setSystemBarsDark(chrome ? dark : pal.dark)
  }, [chrome, dark, pal.dark])
  useEffect(() => () => setSystemBarsDark(dark), [dark])

  const chapter = loc?.tocItem?.label?.trim()
  const minutesLeft = Math.round(loc?.time?.section ?? 0)
  const chapterFor = (page: number) => viewRef.current?.chapterAt(page)

  return (
    <div className="relative h-dvh overflow-hidden" style={{ background: look.desk }}>
      <div ref={host} className="absolute inset-x-0 bottom-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] top-[var(--safe-area-inset-top,env(safe-area-inset-top))]" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
          <p className="text-body-md" style={{ color: pal.fg, opacity: 0.55 }}>
            {failed ? `Couldn’t open ${book.title}. The file may be damaged.` : `Opening ${book.title}…`}
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
              <IconButton label="Back to library" tipBelow onClick={() => leaveReader(navigate)}>
                <ArrowLeft className="size-[18px]" />
              </IconButton>
              <IconButton label="Contents & notes (T)" tipBelow onClick={() => setTocOpen(true)}>
                <PanelLeft className="size-[18px]" />
              </IconButton>
              <div className="min-w-0 flex-1 px-2">
                <div className="truncate text-label-sm text-ink">{book.title}</div>
                <div className="truncate text-body-sm text-mute">
                  {chapter ?? book.author ?? ' '}
                  {minutesLeft >= 1 && <span className="hidden sm:inline"> · {minutesLeft} min left in chapter</span>}
                </div>
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
              <IconButton label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} tipBelow className={isNative ? '' : 'hidden sm:inline-flex'} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}
              </IconButton>
              {!touch && (
                <IconButton label="Keyboard shortcuts (?)" tipBelow className="hidden lg:inline-flex" onClick={() => setShortcutsOpen(true)}>
                  <Keyboard className="size-[18px]" />
                </IconButton>
              )}
              <IconButton label="Search (/)" tipBelow active={searchOpen} onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}>
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

      <AnimatePresence>
        {searchOpen && (
          <SearchPanel
            key="search"
            query={query}
            onQuery={setQuery}
            matches={matches}
            current={matchIdx}
            scanned={scanned}
            total={100}
            onGo={(n) => goToMatch(n)}
            onClose={closeSearch}
            snippetOf={(m) => ({ before: m.excerpt.pre, match: m.excerpt.match, after: m.excerpt.post })}
            emptyHint={query.trim().length < 2 ? 'Type at least two letters.' : 'Try fewer words, or check the spelling.'}
            chapterFor={chapterFor}
          />
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
            className="safe-bottom absolute inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/88 backdrop-blur-md"
          >
            <div className="mx-auto flex h-16 max-w-[980px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
              <IconButton label="Previous screen (←)" size="icon-sm" onClick={() => (touched(), void viewRef.current?.prev())}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Scrubber page={here} count={total} chapterFor={chapterFor} bookmarks={bmPages} onScrub={goToPage} />
              <IconButton label="Next screen (→)" size="icon-sm" onClick={() => (touched(), void viewRef.current?.next())}>
                <ChevronRight className="size-4" />
              </IconButton>
              <GoToPage page={here} count={total} onGo={goToPage} progress={readN / Math.max(1, total)} />
              {!touch && (
                <div className="ml-1 hidden items-center rounded-full border border-hairline sm:flex">
                  <IconButton label="Smaller text (Ctrl −)" size="icon-sm" onClick={() => zoom(-1)}>
                    <Minus className="size-3.5" />
                  </IconButton>
                  <button
                    onClick={() => setType((t) => ({ ...t, size: 100 }))}
                    title="Back to normal size"
                    className="w-12 text-center text-body-sm tabular text-body hover:text-ink"
                  >
                    {type.size}%
                  </button>
                  <IconButton label="Bigger text (Ctrl +)" size="icon-sm" onClick={() => zoom(1)}>
                    <Plus className="size-3.5" />
                  </IconButton>
                </div>
              )}
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      <ElsewherePill
        page={place ? null : elsewhere}
        chrome={chrome}
        onGo={() => {
          const p = elsewhere
          setElsewhere(null)
          dropOther()
          if (p != null) goToPage(p)
        }}
        onStay={() => {
          setElsewhere(null)
          dropOther()
        }}
      />

      <StillReading asking={asking} away={away} stillHere={stillHere} countAway={countAway} dismissAway={dismissAway} />

      <PlacePill page={place?.page ?? null} chrome={chrome} onBack={goBack} onStay={stayHere} />

      <SelectionToolbar
        anchor={defineAt ? null : selAnchor}
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

      <ReaderSidebar
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        tab={tocTab}
        onTab={setTocTab}
        book={book}
        outline={NOTHING}
        chapterTitle={chapter}
        currentPage={here}
        highlights={marks}
        bookmarks={bookmarks}
        onJump={(p) => {
          setTocOpen(false)
          goToPage(p)
        }}
        onJumpHighlight={(h) => {
          setTocOpen(false)
          void jump(true, (v) => v.goTo(h.cfi!, 'middle'))
        }}
        onDeleteHighlight={(h) => void removeHighlights([h])}
        onToggleBookmark={() => void toggleBookmark()}
        onDeleteBookmark={(b) => void db.bookmarks.delete(b.id)}
        onCopyAll={() => void copyAllHighlights()}
        chapterFor={chapterFor}
        chapters={NOTHING}
        recaps={NOTHING}
        recapTarget={null}
        recapSection={null}
        sections={NOTHING}
        onRecap={() => {}}
        contents={<Toc items={ebook.toc ?? []} current={loc?.tocItem?.href} onPick={(href) => void followContents(href)} />}
      />

      <Sheet
        open={!!note}
        onClose={() => setNote(null)}
        title="Note"
        width={460}
        footer={
          note?.target ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const target = note.target!
                setNote(null)
                void jump(true, (v) => v.goTo(target))
              }}
            >
              Go to it in the book
            </Button>
          ) : undefined
        }
      >
        <p className="whitespace-pre-line text-body-md text-body">{note?.text}</p>
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

function Toc({ items, current, onPick, depth = 0 }: { items: FoliateTocItem[]; current?: string; onPick: (href: string) => void; depth?: number }) {
  const list = useRef<HTMLUListElement>(null)
  // A long contents opens at where you are.
  useEffect(() => {
    if (!depth) list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return depth ? null : <p className="px-2 text-body-md text-mute">This book has no table of contents.</p>
  return (
    <ul ref={list}>
      {items.map((it, i) => (
        <li key={`${it.href}-${i}`}>
          <button
            onClick={() => it.href && onPick(it.href)}
            aria-current={it.href === current ? 'true' : undefined}
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
