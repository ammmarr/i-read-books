import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft, Bookmark as BookmarkIcon, CornerUpLeft, X as XIcon, ChevronLeft, ChevronRight, Keyboard, Maximize, Minimize, Minus, PanelLeft, Plus, Search, Timer, Trophy, Type,
} from 'lucide-react'
import { db, uid, type Book, type Bookmark, type Highlight, type HighlightColor, type NormRect } from '../db/db'
import { setStatus } from '../db/books'
import { closePdf, flattenOutline, openPdfBlob, readOutline, resolveDest, type OutlineItem, type PDFDocumentProxy, type PdfLink } from '../lib/pdf'
import { loadBookView, saveBookView, useSettings, type ZoomMode } from '../lib/settings'
import { useIsDark } from '../lib/theme'
import { useIsMobile, useIsTouch, vibrate } from '../lib/hooks'
import { formatDuration } from '../lib/format'
import { IconButton } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { BookCover } from '../components/BookCover'
import { Sheet } from '../components/ui/Sheet'
import { PageView, type PageHit } from './PageView'
import { DocText, findInPage, normalizeQuery, type Match } from './textIndex'
import { HighlightPopover, SelectionToolbar, HL_COLORS } from './HighlightTools'
import { selectionBox, selectionPieces } from './selection'
import { ReaderSidebar, type SidebarTab } from './ReaderSidebar'
import { ReaderSettings } from './ReaderSettings'
import { SearchPanel } from './SearchPanel'
import { useReadingSession } from './useReadingSession'
import { useImporter } from '../components/Importer'
import { dwellFor as dwellFor_, formatPages, readPagesOf } from '../lib/pages'
import { downloadBookFile } from '../lib/sync'
import { cloudEnabled, getAuthSession } from '../lib/supabase'
import { isNative, keepScreenOn, setImmersive } from '../lib/native'

const PT_TO_PX = 96 / 72
const MIN_SCALE = 0.25
const MAX_SCALE = 6
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4].map((z) => z * PT_TO_PX)
const TOP_PAD = 64
const BOTTOM_PAD = 96
// Stable fallbacks so memoised pages don't re-render while live queries load.
const NO_HIGHLIGHTS: Highlight[] = []
const NO_BOOKMARKS: Bookmark[] = []
const NO_PAGE_HITS: PageHit[] = []

export default function Reader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { attach } = useImporter()
  const book = useLiveQuery(() => (id ? db.books.get(id) : undefined), [id])
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [download, setDownload] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [detail, setDetail] = useState<string | null>(null)
  const hasPdf = book ? book.pageCount > 0 : undefined

  useEffect(() => {
    if (!id || hasPdf === undefined) return
    if (!hasPdf) return setError('no-pdf')
    let alive = true
    let loaded: PDFDocumentProxy | null = null
    setError(null)
    ;(async () => {
      try {
        let blob = (await db.files.get(id))?.blob
        if (!blob) {
          // Added on another device: fetch it from the cloud once, keep it here.
          const b = await db.books.get(id)
          if (!b?.filePath || !getAuthSession()) throw new Error('missing')
          setDownload(0)
          blob = await downloadBookFile(b, (f) => alive && setDownload(f))
          if (alive) setDownload(null)
        }
        loaded = await openPdfBlob(blob)
        if (alive) setDoc(loaded)
        else closePdf(loaded)
      } catch (e) {
        console.error(e)
        if (!alive) return
        setDownload(null)
        const m = (e as Error).message
        setDetail(`${(e as Error)?.name ?? 'Error'}: ${m ?? String(e)}`)
        setError(
          m === 'missing'
            ? 'missing'
            : m?.startsWith('download') || m === 'Failed to fetch'
              ? 'offline'
              : (e as Error)?.name === 'PasswordException'
                ? 'password'
                : 'broken',
        )
      }
    })()
    return () => {
      alive = false
      if (loaded) closePdf(loaded)
    }
  }, [id, hasPdf, attempt])

  if (book === null || (book === undefined && error)) return <ReaderMessage title="Book not found" body="It may have been removed from your library." onBack={() => navigate('/')} />
  if (error === 'no-pdf' && book)
    return (
      <ReaderMessage
        title="No PDF for this book yet"
        body={`“${book.title}” is on your reading list. Add its PDF to start reading.`}
        onBack={() => navigate('/')}
        action={{ label: 'Add PDF', onClick: () => attach(book.id) }}
        book={book}
      />
    )
  if (error === 'missing')
    return (
      <ReaderMessage
        title="This book isn’t on this device"
        body={cloudEnabled ? 'Sign in (Settings → Account) to download it from your library, or add the PDF again.' : 'Add the PDF again to keep reading.'}
        onBack={() => navigate('/')}
        action={book ? { label: 'Add PDF', onClick: () => attach(book.id) } : undefined}
        book={book}
      />
    )
  if (error === 'offline')
    return <ReaderMessage title="Couldn’t download this book" body="Check your connection and try again." onBack={() => navigate('/')} action={{ label: 'Try again', onClick: () => setAttempt((a) => a + 1) }} book={book} />
  if (error === 'password')
    return <ReaderMessage title="This PDF is password-protected" body="I READ BOOKS can’t open locked PDFs yet. Remove the password (e.g. print it to a new PDF) and add it again." onBack={() => navigate('/')} book={book} detail={detail} />
  if (error)
    return (
      <ReaderMessage
        title="Can’t open this book"
        body={book?.filePath && getAuthSession() ? 'The copy on this device may be damaged. Download a fresh copy from your library.' : 'This PDF couldn’t be opened — the file may be damaged.'}
        onBack={() => navigate('/')}
        book={book}
        detail={detail}
        action={
          book?.filePath && getAuthSession()
            ? {
                label: 'Download again',
                onClick: async () => {
                  await db.files.delete(book.id)
                  setError(null)
                  setAttempt((a) => a + 1)
                },
              }
            : undefined
        }
      />
    )
  if (!book || !doc) return <ReaderLoading book={book} onBack={() => navigate('/')} progress={download} />
  return <ReaderView key={book.id} book={book} doc={doc} />
}

function ReaderLoading({ book, onBack, progress }: { book?: Book; onBack: () => void; progress?: number | null }) {
  return (
    <div className="grid h-dvh place-items-center bg-canvas">
      <div className="absolute left-3 top-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+10px)]">
        <IconButton label="Back to library" tipBelow onClick={onBack}>
          <ArrowLeft className="size-[18px]" />
        </IconButton>
      </div>
      <div className="flex flex-col items-center">
        {book && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="w-[120px] rounded-[4px] shadow-cover-lift"
          >
            <BookCover book={book} />
          </motion.div>
        )}
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-6 text-body-md text-mute">
          {progress != null ? `Downloading from your library… ${Math.round(progress * 100)}%` : `Opening${book ? ` ${book.title}` : ''}…`}
        </motion.p>
        {progress != null && (
          <div className="mt-3 h-1 w-40 overflow-hidden rounded-full bg-hairline">
            <motion.div className="h-full bg-link" animate={{ width: `${Math.max(4, progress * 100)}%` }} transition={{ ease: 'linear', duration: 0.2 }} />
          </div>
        )}
      </div>
    </div>
  )
}

function ReaderMessage({
  title, body, onBack, action, book, detail,
}: {
  title: string
  body: string
  onBack: () => void
  action?: { label: string; onClick: () => void }
  book?: Book
  /** Technical reason, tucked away for troubleshooting. */
  detail?: string | null
}) {
  return (
    <div className="grid h-dvh place-items-center bg-canvas px-6 text-center">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex max-w-sm flex-col items-center">
        {book && (
          <div className="mb-6 w-[96px] rounded-[4px] shadow-cover">
            <BookCover book={book} />
          </div>
        )}
        <h1 className="text-heading-md text-ink">{title}</h1>
        <p className="mt-2 text-body-md text-mute">{body}</p>
        {detail && (
          <details className="mt-3 max-w-full text-left">
            <summary className="cursor-pointer text-center text-body-sm text-faint hover:text-mute">Technical details</summary>
            <code className="mt-2 block break-all rounded-sm bg-hairline-soft px-2 py-1.5 text-[12px] text-body">{detail}</code>
          </details>
        )}
        <div className="mt-6 flex gap-2">
          <button onClick={onBack} className={`inline-flex h-9 items-center gap-2 rounded-sm px-4 text-sm font-medium ${action ? 'border border-hairline text-ink hover:bg-hairline-soft' : 'bg-ink text-canvas'}`}>
            <ArrowLeft className="size-4" /> Library
          </button>
          {action && (
            <button onClick={action.onClick} className="inline-flex h-9 items-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-canvas">
              {action.label}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function ReaderView({ book, doc }: { book: Book; doc: PDFDocumentProxy }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const settings = useSettings()
  const dark = useIsDark()
  const mobile = useIsMobile()
  const touch = useIsTouch()
  const text = useMemo(() => new DocText(doc), [doc])

  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })

  const saved = useMemo(() => loadBookView(book.id), [book.id])
  const [view, setView] = useState<{ mode: ZoomMode; zoom: number }>(saved ?? { mode: 'auto', zoom: PT_TO_PX })
  const [currentPage, setCurrentPage] = useState(book.currentPage)
  const [range, setRange] = useState<[number, number]>([Math.max(0, book.currentPage - 1), book.currentPage + 2])
  const [chrome, setChrome] = useState(true)
  const [sidebar, setSidebar] = useState<{ open: boolean; tab: SidebarTab }>({ open: false, tab: 'contents' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)
  const [outline, setOutline] = useState<OutlineItem[]>([])

  const highlights = useLiveQuery(() => db.highlights.where('bookId').equals(book.id).toArray(), [book.id]) ?? NO_HIGHLIGHTS
  const bookmarks = useLiveQuery(() => db.bookmarks.where('bookId').equals(book.id).toArray(), [book.id]) ?? NO_BOOKMARKS

  useEffect(() => {
    readOutline(doc).then(setOutline)
  }, [doc])

  // Opening a book makes it "currently reading".
  useEffect(() => {
    db.books.update(book.id, { lastOpenedAt: Date.now() })
    if (book.status === 'queued' || book.status === 'none') setStatus(book.id, 'reading')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  // ── Layout ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    // clientWidth excludes a desktop scrollbar; measuring now avoids a first
    // layout that's a scrollbar too wide (and a stray sideways scroll).
    setVp({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(([e]) => setVp({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sizes = book.pageSizes.length === book.pageCount ? book.pageSizes : Array.from({ length: doc.numPages }, () => book.pageSizes[0] ?? { w: 612, h: 792 })
  const maxW = useMemo(() => Math.max(...sizes.map((s) => s.w)), [sizes])
  const pad = mobile ? 6 : 24
  const gap = mobile ? 8 : 16

  const fit = useMemo(() => {
    const ref = sizes[0]
    const width = (vp.w - pad * 2) / maxW
    const page = Math.min(width, (vp.h - 32) / ref.h)
    return { width, page, auto: Math.min(width, 1.35 * PT_TO_PX) }
  }, [vp.w, vp.h, pad, maxW, sizes])

  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.mode === 'custom' ? view.zoom : fit[view.mode]))

  const layout = useMemo(() => {
    const tops: number[] = []
    const heights: number[] = []
    const widths: number[] = []
    let y = TOP_PAD
    for (const s of sizes) {
      tops.push(y)
      const h = Math.floor(s.h * scale)
      heights.push(h)
      widths.push(Math.floor(s.w * scale))
      y += h + gap
    }
    const contentW = Math.max(vp.w, Math.ceil(maxW * scale) + pad * 2)
    return { tops, heights, widths, total: y - gap + BOTTOM_PAD, contentW }
  }, [sizes, scale, gap, vp.w, maxW, pad])
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const pageAt = useCallback((y: number) => {
    const { tops } = layoutRef.current
    let lo = 0, hi = tops.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (tops[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }, [])

  // ── Restore position once ─────────────────────────────────────────────
  const restored = useRef(false)
  useLayoutEffect(() => {
    const el = scroller.current
    // Wait for the measured viewport so the restored offset matches the real layout.
    if (!el || restored.current || vp.h < 10 || Math.abs(el.clientWidth - vp.w) > 1) return
    restored.current = true
    const i = Math.min(book.currentPage, layout.tops.length - 1)
    el.scrollTop = layout.tops[i] + book.pageOffset * layout.heights[i] - 16
    el.scrollLeft = (layout.contentW - vp.w) / 2
  }, [layout, vp, book.currentPage, book.pageOffset])

  // ── Zoom with a fixed anchor point ────────────────────────────────────
  const anchor = useRef<{ idx: number; frac: number; ax: number; ay: number; fx: number } | null>(null)

  const zoomTo = useCallback(
    (next: { mode: ZoomMode; zoom: number }, at?: { x: number; y: number }) => {
      const el = scroller.current
      if (!el) return
      const L = layoutRef.current
      const ax = at?.x ?? el.clientWidth / 2
      const ay = at?.y ?? el.clientHeight / 2
      const y = el.scrollTop + ay
      const idx = pageAt(y)
      anchor.current = { idx, frac: (y - L.tops[idx]) / L.heights[idx], ax, ay, fx: (el.scrollLeft + ax) / L.contentW }
      if (next.mode === 'custom') next = { mode: 'custom', zoom: Math.max(MIN_SCALE, Math.min(MAX_SCALE, next.zoom)) }
      setView(next)
      saveBookView(book.id, next)
    },
    [pageAt, book.id],
  )

  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (content.current) {
      content.current.style.transform = ''
      content.current.style.transformOrigin = ''
    }
    if (!el || !a) return
    anchor.current = null
    scrollState.current.quietUntil = performance.now() + 300
    el.scrollTop = layout.tops[a.idx] + a.frac * layout.heights[a.idx] - a.ay
    el.scrollLeft = a.fx * layout.contentW - a.ax
  }, [layout])

  const stepZoom = useCallback(
    (dir: 1 | -1, at?: { x: number; y: number }) => {
      const cur = scale
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur * 1.01) ?? cur * 1.25 : [...ZOOM_STEPS].reverse().find((z) => z < cur * 0.99) ?? cur / 1.25
      zoomTo({ mode: 'custom', zoom: next }, at)
    },
    [scale, zoomTo],
  )

  // Ctrl/⌘ + wheel and trackpad pinch (which browsers report as ctrl+wheel).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      // Mouse wheels send ~100 per notch, trackpad pinches send small deltas:
      // capping keeps a notch at ~15% while pinches stay smooth.
      const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY
      const factor = Math.exp(-Math.sign(dy) * Math.min(Math.abs(dy), 40) * 0.0035)
      zoomTo({ mode: 'custom', zoom: scaleRef.current * factor }, { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // Two-finger pinch: scale the content with a CSS transform while the
  // fingers move (buttery), then commit a real re-render when they lift.
  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    let pinch: { d0: number; cx: number; cy: number; ratio: number } | null = null
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      const r = el.getBoundingClientRect()
      pinch = {
        d0: dist(e.touches),
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
        ratio: 1,
      }
      inner.style.transformOrigin = `${el.scrollLeft + pinch.cx}px ${el.scrollTop + pinch.cy}px`
      window.getSelection()?.removeAllRanges()
    }
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const target = scaleRef.current * (dist(e.touches) / pinch.d0)
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, target))
      pinch.ratio = clamped / scaleRef.current
      inner.style.transform = `scale(${pinch.ratio})`
    }
    const end = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return
      const p = pinch
      pinch = null
      if (Math.abs(p.ratio - 1) < 0.02) {
        inner.style.transform = ''
        return
      }
      zoomTo({ mode: 'custom', zoom: scaleRef.current * p.ratio }, { x: p.cx, y: p.cy })
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [zoomTo])

  // ── Scroll: current page, visible window, chrome auto-hide, save position ─
  // `quietUntil`: jumps and zoom re-anchoring move the scroll position
  // programmatically — those shouldn't count as the reader scrolling.
  const scrollState = useRef({ last: 0, down: 0, up: 0, quietUntil: 0 })
  const panelsOpen = sidebar.open || settingsOpen || shortcutsOpen
  const [searchOpen, setSearchOpen] = useState(false)
  const lockChrome = panelsOpen || searchOpen
  const lockRef = useRef(lockChrome)
  lockRef.current = lockChrome || !settings.autoHideChrome

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const persist = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const L = layoutRef.current
    const cp = pageAt(el.scrollTop + el.clientHeight * 0.4)
    const offset = (el.scrollTop + 16 - L.tops[cp]) / L.heights[cp]
    // Where you are, not how far you've read — progress comes from pages read.
    db.books.update(book.id, { currentPage: cp, pageOffset: offset, lastOpenedAt: Date.now() })
  }, [book.id, pageAt])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const st = el.scrollTop
    const vh = el.clientHeight
    const L = layoutRef.current
    const cp = pageAt(st + vh * 0.4)
    setCurrentPage(cp)
    const a = pageAt(Math.max(0, st - vh * 0.6))
    const b = Math.min(L.tops.length - 1, pageAt(st + vh * 1.8))
    setRange((r) => (r[0] === a && r[1] === b ? r : [a, b]))

    const s = scrollState.current
    const d = st - s.last
    s.last = st
    if (performance.now() < s.quietUntil) {
      s.down = s.up = 0
    } else if (d > 0) {
      s.down += d
      s.up = 0
    } else {
      s.up -= d
      s.down = 0
    }
    if (st < 40 || s.up > 36) setChrome(true)
    else if (s.down > 90 && !lockRef.current) setChrome(false)

    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 500)
  }, [pageAt, persist])

  useEffect(() => () => {
    clearTimeout(saveTimer.current)
    persist()
  }, [persist])

  useEffect(() => {
    if (lockChrome) setChrome(true)
  }, [lockChrome])

  // ── Pages actually read ───────────────────────────────────────────────
  // A page counts once it's been the current page for a slice of its expected
  // reading time. Jumping to page 200, scrubbing or flicking past pages
  // doesn't count, so progress reflects reading, not browsing.
  const readSet = useRef<Set<number>>(readPagesOf(book))
  const [readN, setReadN] = useState(() => readSet.current.size)
  const dwellCache = useRef(new Map<number, number>())
  const dwellFor = useCallback(
    (page: number) => {
      const hit = dwellCache.current.get(page)
      if (hit != null) return hit
      const idx = text.peekIndex(page)
      if (idx) {
        const d = dwellFor_(idx.norm.length)
        dwellCache.current.set(page, d)
        return d
      }
      void text.getIndex(page).then((i) => dwellCache.current.set(page, dwellFor_(i.norm.length)))
      return dwellFor_(undefined)
    },
    [text],
  )
  const readSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const finishOffered = useRef(book.status === 'finished')
  const onPageRead = useCallback(
    (page: number) => {
      if (readSet.current.has(page)) return
      readSet.current.add(page)
      setReadN(readSet.current.size)
      clearTimeout(readSaveTimer.current)
      readSaveTimer.current = setTimeout(() => {
        const set = readSet.current
        db.books.update(book.id, { readPages: formatPages(set), furthestPage: Math.max(0, ...set) })
      }, 1500)
      // Finishing the last page after reading most of the book → offer "Finished".
      if (!finishOffered.current && page === book.pageCount - 1 && book.pageCount > 1 && readSet.current.size / book.pageCount >= 0.75) {
        finishOffered.current = true
        toast({
          message: 'You reached the end',
          description: `Mark “${book.title}” as finished?`,
          action: { label: 'Finished', onClick: () => setStatus(book.id, 'finished') },
          duration: 10000,
        })
      }
    },
    [book.id, book.pageCount, book.title, toast],
  )
  useEffect(
    () => () => {
      // Flush on leave.
      clearTimeout(readSaveTimer.current)
      const set = readSet.current
      if (set.size) db.books.update(book.id, { readPages: formatPages(set), furthestPage: Math.max(0, ...set) })
    },
    [book.id],
  )
  // Pages read on another device (sync) join ours — unless progress was set
  // by hand, which replaces it.
  const setAtSeen = useRef(book.readPagesSetAt ?? 0)
  useEffect(() => {
    const theirs = readPagesOf(book)
    if ((book.readPagesSetAt ?? 0) > setAtSeen.current) {
      setAtSeen.current = book.readPagesSetAt ?? 0
      readSet.current = theirs
      setReadN(theirs.size)
      return
    }
    let grew = false
    for (const p of theirs) if (!readSet.current.has(p)) (readSet.current.add(p), (grew = true))
    if (grew) setReadN(readSet.current.size)
  }, [book.readPages, book.readPagesSetAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToPage = useCallback(
    (i: number, opts: { smooth?: boolean; frac?: number } = {}) => {
      const el = scroller.current
      if (!el) return
      const L = layoutRef.current
      const p = Math.max(0, Math.min(L.tops.length - 1, i))
      scrollState.current.quietUntil = performance.now() + (opts.smooth ? 900 : 300)
      el.scrollTo({ top: L.tops[p] + (opts.frac ?? 0) * L.heights[p] - 16, behavior: opts.smooth ? 'smooth' : 'instant' })
    },
    [],
  )

  // ── Reading session & wake lock ───────────────────────────────────────
  const { sessionSeconds, idle } = useReadingSession({
    bookId: book.id,
    currentPage,
    enabled: true,
    dwellFor,
    onPageRead,
    goalSeconds: settings.dailyGoalMinutes * 60,
    onGoalReached: () => {
      vibrate(20)
      toast({ message: <span className="inline-flex items-center gap-1.5"><Trophy className="size-4 text-warning" /> Daily goal reached</span>, description: `${settings.dailyGoalMinutes} minutes today. Keep the streak going.`, duration: 5000 })
    },
  })

  useEffect(() => {
    if (!settings.keepAwake) return
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
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [settings.keepAwake])

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFullscreen = () => {
    if (isNative) {
      // In the app, "full screen" hides Android's status and navigation bars.
      const next = !fullscreen
      setFullscreen(next)
      void setImmersive(next)
      return
    }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }
  useEffect(() => () => void setImmersive(false), [])

  // ── Chapters ──────────────────────────────────────────────────────────
  const flat = useMemo(() => flattenOutline(outline).filter((o) => o.page != null).sort((a, b) => a.page! - b.page!), [outline])
  const chapterFor = useCallback(
    (page: number) => {
      let found: string | undefined
      for (const o of flat) {
        if (o.page! <= page) found = o.title
        else break
      }
      return found
    },
    [flat],
  )
  const chapter = chapterFor(currentPage)

  // ── Bookmarks ─────────────────────────────────────────────────────────
  const bookmarked = bookmarks.some((b) => b.page === currentPage)
  const toggleBookmark = useCallback(async () => {
    const existing = bookmarks.find((b) => b.page === currentPage)
    vibrate(10)
    if (existing) {
      await db.bookmarks.delete(existing.id)
      toast({ id: 'bm', message: `Bookmark removed`, description: `Page ${currentPage + 1}`, duration: 1800 })
    } else {
      await db.bookmarks.add({ id: uid(), bookId: book.id, page: currentPage, createdAt: Date.now() })
      toast({ id: 'bm', message: `Page ${currentPage + 1} bookmarked`, description: chapter, duration: 1800 })
    }
  }, [bookmarks, currentPage, book.id, toast, chapter])

  // ── Search ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [matchIdx, setMatchIdx] = useState(0)
  const [scanned, setScanned] = useState(0)
  const pendingHitScroll = useRef(false)

  useEffect(() => {
    const q = normalizeQuery(query)
    setMatches([])
    setMatchIdx(0)
    setScanned(0)
    if (!q || !searchOpen) return
    let cancelled = false
    const t = setTimeout(async () => {
      const found: Match[] = []
      let firstAfterCurrent = -1
      for (let p = 0; p < doc.numPages; p++) {
        if (cancelled) return
        const idx = await text.getIndex(p)
        for (const m of findInPage(idx, q, p)) {
          if (firstAfterCurrent < 0 && p >= currentPageRef.current) firstAfterCurrent = found.length
          found.push({ ...m, n: found.length })
        }
        if (p % 16 === 15 || p === doc.numPages - 1) {
          setMatches([...found])
          setScanned(p + 1)
          await new Promise((r) => setTimeout(r, 0))
        }
      }
      if (!cancelled && found.length) {
        // Start from the first result at or after where you are.
        goToMatch(Math.max(0, firstAfterCurrent), found)
      }
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen, doc, text])
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage

  const goToMatch = useCallback(
    (n: number, list = matches) => {
      const m = list[n]
      if (!m) return
      setMatchIdx(n)
      pendingHitScroll.current = true
      const el = scroller.current
      const L = layoutRef.current
      // Only jump if the page isn't already comfortably in view.
      if (el && (L.tops[m.page] > el.scrollTop + el.clientHeight * 0.7 || L.tops[m.page] + L.heights[m.page] < el.scrollTop + 60)) scrollToPage(m.page)
    },
    [matches, scrollToPage],
  )

  const hitsByPage = useMemo(() => {
    const map = new Map<number, PageHit[]>()
    if (!searchOpen) return map
    const cur = matches[matchIdx]
    for (const m of matches) {
      if (m.page < range[0] - 1 || m.page > range[1] + 1) continue
      const arr = map.get(m.page) ?? []
      arr.push({ start: m.start, end: m.end, current: m === cur })
      map.set(m.page, arr)
    }
    return map
  }, [matches, matchIdx, range, searchOpen])

  const onCurrentHitRect = useCallback((page: number, r: NormRect) => {
    if (!pendingHitScroll.current) return
    pendingHitScroll.current = false
    const el = scroller.current
    if (!el) return
    const L = layoutRef.current
    const y = L.tops[page] + r[1] * L.heights[page]
    const x = (L.contentW - L.widths[page]) / 2 + r[0] * L.widths[page]
    const inView = y > el.scrollTop + 80 && y < el.scrollTop + el.clientHeight - 140
    scrollState.current.quietUntil = performance.now() + 900
    if (!inView) el.scrollTo({ top: y - el.clientHeight * 0.35, behavior: 'smooth' })
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollTo({ left: x - 40, behavior: 'smooth' })
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
  }, [])

  // ── Selection → highlight ─────────────────────────────────────────────
  const [selAnchor, setSelAnchor] = useState<{ rect: DOMRect; below?: boolean } | null>(null)
  const pointerDown = useRef(false)
  const [freshId, setFreshId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [active, setActive] = useState<{ id: string; rect: DOMRect; focusNote?: boolean } | null>(null)
  const activeHighlight = active ? highlights.find((h) => h.id === active.id) ?? null : null

  const refreshSelection = useCallback(() => {
    const el = content.current
    const sel = window.getSelection()
    if (!el || !sel || sel.isCollapsed || !sel.rangeCount || !el.contains(sel.anchorNode)) return setSelAnchor(null)
    const box = selectionBox()
    setSelAnchor(box ? { rect: box, below: touch } : null)
  }, [touch])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const onChange = () => {
      clearTimeout(t)
      if (pointerDown.current) return
      t = setTimeout(refreshSelection, touch ? 220 : 60)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [refreshSelection, touch])

  const createHighlight = useCallback(
    async (color: HighlightColor, withNote = false) => {
      const root = content.current
      if (!root) return
      const pieces = selectionPieces(root)
      if (!pieces.length) return
      const now = Date.now()
      const made: Highlight[] = pieces.map((p) => ({ id: uid(), bookId: book.id, page: p.page, color, text: p.text, rects: p.rects, createdAt: now, updatedAt: now }))
      await db.highlights.bulkAdd(made)
      const box = selectionBox()
      window.getSelection()?.removeAllRanges()
      setSelAnchor(null)
      setFreshId(made[0].id)
      setTimeout(() => setFreshId(null), 900)
      vibrate(12)
      try {
        localStorage.setItem('irb-last-color', color)
      } catch { /* ignore */ }
      if (withNote && box) setActive({ id: made[0].id, rect: box, focusNote: true })
    },
    [book.id],
  )

  const copySelection = useCallback(async () => {
    const t = window.getSelection()?.toString().replace(/\s+/g, ' ').trim()
    if (!t) return
    await navigator.clipboard?.writeText(t).catch(() => {})
    window.getSelection()?.removeAllRanges()
    setSelAnchor(null)
    toast({ id: 'copy', message: 'Copied to clipboard', duration: 1500 })
  }, [toast])

  const highlightAt = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null) => {
      const pageEl = (target as HTMLElement | null)?.closest?.('[data-page]') as HTMLElement | null
      if (!pageEl) return null
      const page = Number(pageEl.dataset.page)
      const box = pageEl.getBoundingClientRect()
      const x = (clientX - box.left) / box.width
      const y = (clientY - box.top) / box.height
      const tol = 3 / box.width
      const h = highlights.find((h) => h.page === page && h.rects.some((r) => x >= r[0] - tol && x <= r[0] + r[2] + tol && y >= r[1] - tol && y <= r[1] + r[3] + tol))
      if (!h) return null
      const l = Math.min(...h.rects.map((r) => r[0])), t = Math.min(...h.rects.map((r) => r[1]))
      const rr = Math.max(...h.rects.map((r) => r[0] + r[2])), b = Math.max(...h.rects.map((r) => r[1] + r[3]))
      return { h, rect: new DOMRect(box.left + l * box.width, box.top + t * box.height, (rr - l) * box.width, (b - t) * box.height) }
    },
    [highlights],
  )

  // Taps: open a highlight, double-tap to zoom, single tap toggles chrome.
  const tap = useRef<{ x: number; y: number; t: number; type: string } | null>(null)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  const singleTapTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const onPointerDown = (e: React.PointerEvent) => {
    pointerDown.current = true
    // Link hotspots handle their own clicks.
    if ((e.target as HTMLElement).closest('.pdf-link')) {
      tap.current = null
      return
    }
    tap.current = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }
    const layer = (e.target as HTMLElement).closest('.textLayer')
    if (layer && e.pointerType === 'mouse') layer.classList.add('selecting')
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointerDown.current = false
    document.querySelectorAll('.textLayer.selecting').forEach((l) => l.classList.remove('selecting'))
    const start = tap.current
    tap.current = null
    setTimeout(refreshSelection, 10)
    if (!start) return
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (moved > 10 || performance.now() - start.t > 350) return
    if (!window.getSelection()?.isCollapsed) return

    const hit = highlightAt(e.clientX, e.clientY, e.target)
    if (hit) {
      setActive({ id: hit.h.id, rect: hit.rect })
      return
    }
    if (e.pointerType === 'mouse') return

    const now = performance.now()
    const lt = lastTap.current
    if (lt && now - lt.t < 300 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 40) {
      clearTimeout(singleTapTimer.current)
      lastTap.current = null
      const r = scroller.current!.getBoundingClientRect()
      const at = { x: e.clientX - r.left, y: e.clientY - r.top }
      const base = view.mode === 'custom' ? fit.auto : fit[view.mode]
      if (scale > base * 1.15) zoomTo({ mode: 'auto', zoom: scale }, at)
      else zoomTo({ mode: 'custom', zoom: base * 2 }, at)
      return
    }
    lastTap.current = { x: e.clientX, y: e.clientY, t: now }
    clearTimeout(singleTapTimer.current)
    singleTapTimer.current = setTimeout(() => {
      if (!lockRef.current) setChrome((c) => !c)
    }, 260)
  }

  // Mouse near the top/bottom edge reveals the chrome on desktop.
  const onMouseMove = (e: React.MouseEvent) => {
    if (touch || chrome) return
    const r = scroller.current?.getBoundingClientRect()
    if (!r) return
    if (e.clientY - r.top < 72 || r.bottom - e.clientY < 96) setChrome(true)
  }

  // Keep the selection toolbar glued to the text while scrolling.
  useEffect(() => {
    const el = scroller.current
    if (!el || !selAnchor) return
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(refreshSelection)
    }
    el.addEventListener('scroll', on, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', on)
    }
  }, [selAnchor, refreshSelection])

  useEffect(() => {
    if (!active) return
    const el = scroller.current
    const close = () => setActive(null)
    el?.addEventListener('scroll', close, { passive: true, once: true })
    return () => el?.removeEventListener('scroll', close)
  }, [active])

  // ── PDF links ─────────────────────────────────────────────────────────
  // Following an internal link leaves a "Back to page N" pill, like a book's
  // finger holding your place.
  const [linkReturn, setLinkReturn] = useState<{ page: number; frac: number } | null>(null)
  const returnTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const followLink = useCallback(
    async (link: PdfLink) => {
      const el = scroller.current
      if (!el) return
      const L = layoutRef.current
      let target: { page: number; top?: number } | null = null
      const cur = pageAt(el.scrollTop + el.clientHeight * 0.4)
      switch (link.action) {
        case 'NextPage': target = { page: cur + 1 }; break
        case 'PrevPage': target = { page: cur - 1 }; break
        case 'FirstPage': target = { page: 0 }; break
        case 'LastPage': target = { page: L.tops.length - 1 }; break
        default: target = link.dest != null ? await resolveDest(doc, link.dest) : null
      }
      if (!target) return
      const here = pageAt(el.scrollTop + 16)
      setLinkReturn({ page: here, frac: (el.scrollTop + 16 - L.tops[here]) / L.heights[here] })
      clearTimeout(returnTimer.current)
      returnTimer.current = setTimeout(() => setLinkReturn(null), 20000)
      const p = Math.max(0, Math.min(L.tops.length - 1, target.page))
      scrollState.current.quietUntil = performance.now() + 400
      el.scrollTo({ top: L.tops[p] + (target.top ?? 0) * L.heights[p] - (target.top ? 24 : 16), behavior: 'instant' })
      vibrate(6)
    },
    [doc, pageAt],
  )
  const goBackFromLink = useCallback(() => {
    const r = linkReturn
    if (!r) return
    setLinkReturn(null)
    scrollToPage(r.page, { frac: r.frac })
  }, [linkReturn, scrollToPage])

  const jumpToHighlight = useCallback(
    (h: Highlight) => {
      setSidebar((s) => ({ ...s, open: false }))
      const r = h.rects[0]
      const el = scroller.current
      if (el) {
        const L = layoutRef.current
        const y = L.tops[h.page] + (r?.[1] ?? 0) * L.heights[h.page]
        scrollState.current.quietUntil = performance.now() + 400
        el.scrollTo({ top: y - el.clientHeight * 0.35, behavior: 'instant' })
      }
      setTimeout(() => setFlashId(h.id), 120)
      setTimeout(() => setFlashId(null), 1900)
    },
    [],
  )

  const copyAllHighlights = useCallback(async () => {
    const sorted = [...highlights].sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1])
    const md = [
      `# ${book.title}${book.author ? ` — ${book.author}` : ''}`,
      '',
      ...sorted.flatMap((h) => [`> ${h.text}`, `— p. ${h.page + 1}`, ...(h.note ? ['', h.note] : []), '']),
    ].join('\n')
    await navigator.clipboard?.writeText(md).catch(() => {})
    toast({ message: `${sorted.length} highlights copied`, description: 'As Markdown — paste anywhere.' })
  }, [highlights, book, toast])

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      const typing = t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"] button')
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if (mod && (e.key === '=' || e.key === '+')) return void (e.preventDefault(), stepZoom(1))
      if (mod && e.key === '-') return void (e.preventDefault(), stepZoom(-1))
      if (mod && e.key === '0') return void (e.preventDefault(), zoomTo({ mode: 'auto', zoom: scale }))
      if (typing || mod || e.altKey) return
      const el = scroller.current
      if (!el) return

      // With text selected, 1–5 highlight in that colour.
      if (selAnchor && /^[1-5]$/.test(e.key)) {
        e.preventDefault()
        createHighlight(HL_COLORS[Number(e.key) - 1].key)
        return
      }
      if (selAnchor && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        let c: HighlightColor = 'yellow'
        try { c = (localStorage.getItem('irb-last-color') as HighlightColor) || 'yellow' } catch { /* ignore */ }
        createHighlight(c)
        return
      }

      const wide = layoutRef.current.contentW > el.clientWidth + 2
      switch (e.key) {
        case 'ArrowRight':
          if (wide) return
          e.preventDefault()
          scrollToPage(currentPage + 1, { smooth: true })
          break
        case 'ArrowLeft':
          if (wide) return
          e.preventDefault()
          scrollToPage(currentPage - 1, { smooth: true })
          break
        case 'PageDown':
        case ' ':
          e.preventDefault()
          el.scrollBy({ top: (e.shiftKey ? -1 : 1) * (el.clientHeight - 80), behavior: 'smooth' })
          break
        case 'PageUp':
          e.preventDefault()
          el.scrollBy({ top: -(el.clientHeight - 80), behavior: 'smooth' })
          break
        case 'j':
          el.scrollBy({ top: 120, behavior: 'smooth' })
          break
        case 'k':
          el.scrollBy({ top: -120, behavior: 'smooth' })
          break
        case 'Home':
          e.preventDefault()
          scrollToPage(0)
          break
        case 'End':
          e.preventDefault()
          scrollToPage(book.pageCount - 1)
          break
        case 'b':
          toggleBookmark()
          break
        case 't':
          setSidebar((s) => ({ open: !(s.open && s.tab === 'contents'), tab: 'contents' }))
          break
        case 'n':
          setSidebar((s) => ({ open: !(s.open && s.tab === 'highlights'), tab: 'highlights' }))
          break
        case 'f':
          toggleFullscreen()
          break
        case '/':
          e.preventDefault()
          setSearchOpen(true)
          break
        case '?':
          setShortcutsOpen(true)
          break
        case 'Escape':
          if (searchOpen) closeSearch()
          else if (selAnchor) {
            window.getSelection()?.removeAllRanges()
            setSelAnchor(null)
          } else setChrome((c) => !c)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepZoom, zoomTo, scale, currentPage, scrollToPage, toggleBookmark, selAnchor, createHighlight, searchOpen, closeSearch, book.pageCount])

  // ── Render ────────────────────────────────────────────────────────────
  const pageTheme = settings.pageTheme === 'auto' ? (dark ? 'night' : 'paper') : settings.pageTheme
  const zoomPercent = Math.round((scale / PT_TO_PX) * 100)
  const progress = book.pageCount > 1 ? currentPage / (book.pageCount - 1) : 1
  const hlByPage = useMemo(() => {
    const m = new Map<number, Highlight[]>()
    for (const h of highlights) m.set(h.page, [...(m.get(h.page) ?? []), h])
    return m
  }, [highlights])
  const bmPages = useMemo(() => new Set(bookmarks.map((b) => b.page)), [bookmarks])

  const pages = []
  for (let i = range[0]; i <= range[1] && i < layout.tops.length; i++) {
    pages.push(
      <PageView
        key={i}
        doc={doc}
        text={text}
        index={i}
        scale={scale}
        top={layout.tops[i]}
        left={Math.floor((layout.contentW - layout.widths[i]) / 2)}
        width={layout.widths[i]}
        height={layout.heights[i]}
        highlights={hlByPage.get(i) ?? NO_HIGHLIGHTS}
        freshHighlightId={freshId}
        flashHighlightId={flashId}
        hits={hitsByPage.get(i) ?? NO_PAGE_HITS}
        bookmarked={bmPages.has(i)}
        onCurrentHitRect={onCurrentHitRect}
        onLink={followLink}
      />,
    )
  }

  return (
    <div className={`relative h-dvh overflow-hidden ${pageTheme === 'night' ? 'bg-[#0f0f0f]' : pageTheme === 'sepia' ? 'bg-[#ebe3d0] dark:bg-[#2a2620]' : 'bg-hairline-soft'} page-theme-${pageTheme}`}>
      <div
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pointerDown.current = false)}
        onMouseMove={onMouseMove}
        className="reader-scroll absolute inset-0 overflow-auto"
        tabIndex={-1}
      >
        <div ref={content} style={{ height: layout.total, width: layout.contentW, position: 'relative', willChange: 'transform' }}>
          {pages}
        </div>
      </div>

      {/* ── Top bar ── */}
      <AnimatePresence>
        {chrome && (
          <motion.header
            key="top"
            initial={{ y: -72, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -72, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="safe-top absolute inset-x-0 top-0 z-40 border-b border-hairline bg-canvas/88 backdrop-blur-md"
          >
            <div className="flex h-14 items-center gap-1 px-2 sm:px-3">
              <IconButton label="Back to library" tipBelow onClick={() => navigate(-1)}>
                <ArrowLeft className="size-[18px]" />
              </IconButton>
              <IconButton label="Contents & notes (T)" tipBelow onClick={() => setSidebar((s) => ({ ...s, open: true }))}>
                <PanelLeft className="size-[18px]" />
              </IconButton>
              <div className="min-w-0 flex-1 px-2">
                <div className="truncate text-label-sm text-ink">{book.title}</div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={chapter ?? 'none'}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="truncate text-body-sm text-mute"
                  >
                    {chapter ?? book.author ?? ' '}
                  </motion.div>
                </AnimatePresence>
              </div>
              {settings.showSessionTimer && sessionSeconds > 0 && (
                <div
                  title={idle ? 'Paused — no activity' : 'Reading time this session'}
                  className={`mr-1 hidden h-7 items-center gap-1.5 rounded-full border border-hairline px-2.5 text-body-sm tabular transition-colors sm:inline-flex ${idle ? 'text-faint' : 'text-body'}`}
                >
                  <Timer className={`size-3.5 ${idle ? '' : 'text-link'}`} />
                  {formatDuration(sessionSeconds)}
                </div>
              )}
              <IconButton label="Search (Ctrl+F)" tipBelow active={searchOpen} onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}>
                <Search className="size-[18px]" />
              </IconButton>
              <IconButton label={bookmarked ? 'Remove bookmark (B)' : 'Bookmark page (B)'} tipBelow onClick={toggleBookmark}>
                <motion.span key={String(bookmarked)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }} className="grid">
                  <BookmarkIcon className={`size-[18px] ${bookmarked ? 'fill-link text-link' : ''}`} />
                </motion.span>
              </IconButton>
              <IconButton label="Display" tipBelow onClick={() => setSettingsOpen(true)}>
                <Type className="size-[18px]" />
              </IconButton>
              {!touch && (
                <IconButton label="Keyboard shortcuts (?)" tipBelow className="hidden lg:inline-flex" onClick={() => setShortcutsOpen(true)}>
                  <Keyboard className="size-[18px]" />
                </IconButton>
              )}
              {(isNative || document.fullscreenEnabled) && (
                <IconButton label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} tipBelow className={isNative ? '' : 'hidden sm:inline-flex'} onClick={toggleFullscreen}>
                  {fullscreen ? <Minimize className="size-[18px]" /> : <Maximize className="size-[18px]" />}
                </IconButton>
              )}
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
            total={doc.numPages}
            onGo={(n) => goToMatch(n)}
            onClose={closeSearch}
            text={text}
            chapterFor={chapterFor}
          />
        )}
      </AnimatePresence>

      {/* ── Bottom bar ── */}
      <AnimatePresence>
        {chrome && (
          <motion.footer
            key="bottom"
            initial={{ y: 96, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="safe-bottom absolute inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/88 backdrop-blur-md"
          >
            <div className="mx-auto flex h-16 max-w-[980px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
              <IconButton label="Previous page (←)" size="icon-sm" onClick={() => scrollToPage(currentPage - 1, { smooth: true })} disabled={currentPage === 0}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Scrubber
                page={currentPage}
                count={book.pageCount}
                chapterFor={chapterFor}
                bookmarks={bmPages}
                onScrub={(p) => scrollToPage(p)}
              />
              <IconButton label="Next page (→)" size="icon-sm" onClick={() => scrollToPage(currentPage + 1, { smooth: true })} disabled={currentPage >= book.pageCount - 1}>
                <ChevronRight className="size-4" />
              </IconButton>
              <GoToPage page={currentPage} count={book.pageCount} onGo={(p) => scrollToPage(p)} progress={readN / Math.max(1, book.pageCount)} />
              {!mobile && (
                <div className="ml-1 flex items-center rounded-full border border-hairline">
                  <IconButton label="Zoom out (Ctrl −)" size="icon-sm" onClick={() => stepZoom(-1)}>
                    <Minus className="size-3.5" />
                  </IconButton>
                  <button
                    onClick={() => zoomTo({ mode: view.mode === 'width' ? 'auto' : 'width', zoom: scale })}
                    title={view.mode === 'width' ? 'Back to auto' : 'Fit width'}
                    className="w-12 text-center text-body-sm tabular text-body hover:text-ink"
                  >
                    {zoomPercent}%
                  </button>
                  <IconButton label="Zoom in (Ctrl +)" size="icon-sm" onClick={() => stepZoom(1)}>
                    <Plus className="size-3.5" />
                  </IconButton>
                </div>
              )}
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* Back from an internal link */}
      <AnimatePresence>
        {linkReturn && (
          <motion.div
            key="link-return"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className={`absolute left-1/2 z-40 flex -translate-x-1/2 items-center rounded-full border border-hairline bg-canvas-elevated pl-1 shadow-floating ${
              chrome ? 'bottom-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+80px)]' : 'bottom-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+20px)]'
            } transition-[bottom] duration-300`}
          >
            <button onClick={goBackFromLink} className="flex h-10 items-center gap-2 rounded-full px-3 text-label-sm text-ink hover:bg-hairline-soft">
              <CornerUpLeft className="size-4 text-link" />
              Back to page {linkReturn.page + 1}
            </button>
            <button onClick={() => setLinkReturn(null)} aria-label="Dismiss" className="mr-1 grid size-8 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
              <XIcon className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hairline progress that stays when the chrome hides. */}
      <AnimatePresence>
        {!chrome && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[3px] bg-hairline/60"
          >
            <div className="h-full bg-ink/60 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </motion.div>
        )}
      </AnimatePresence>

      <SelectionToolbar
        anchor={selAnchor}
        onHighlight={(c) => createHighlight(c)}
        onNote={() => createHighlight(((() => { try { return localStorage.getItem('irb-last-color') } catch { return null } })() as HighlightColor) || 'yellow', true)}
        onCopy={copySelection}
      />
      <HighlightPopover
        highlight={activeHighlight}
        anchor={active ? { rect: active.rect, below: touch } : null}
        focusNote={active?.focusNote}
        onClose={() => setActive(null)}
        onColor={(c) => activeHighlight && db.highlights.update(activeHighlight.id, { color: c, updatedAt: Date.now() })}
        onNote={(note) => activeHighlight && db.highlights.update(activeHighlight.id, { note: note.trim() || undefined, updatedAt: Date.now() })}
        onCopy={async () => {
          if (!activeHighlight) return
          await navigator.clipboard?.writeText(activeHighlight.text).catch(() => {})
          toast({ id: 'copy', message: 'Copied to clipboard', duration: 1500 })
          setActive(null)
        }}
        onDelete={async () => {
          const h = activeHighlight
          if (!h) return
          setActive(null)
          await db.highlights.delete(h.id)
          toast({ message: 'Highlight deleted', action: { label: 'Undo', onClick: () => db.highlights.put(h) } })
        }}
      />

      <ReaderSidebar
        open={sidebar.open}
        onClose={() => setSidebar((s) => ({ ...s, open: false }))}
        tab={sidebar.tab}
        onTab={(tab) => setSidebar((s) => ({ ...s, tab }))}
        book={book}
        outline={outline}
        chapterTitle={chapter}
        currentPage={currentPage}
        highlights={highlights}
        bookmarks={bookmarks}
        onJump={(p) => {
          setSidebar((s) => ({ ...s, open: false }))
          scrollToPage(p)
        }}
        onJumpHighlight={jumpToHighlight}
        onToggleBookmark={toggleBookmark}
        onDeleteBookmark={(b) => db.bookmarks.delete(b.id)}
        onCopyAll={copyAllHighlights}
        chapterFor={chapterFor}
      />
      <ReaderSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        zoomMode={view.mode}
        zoomPercent={zoomPercent}
        onZoomMode={(m) => zoomTo({ mode: m, zoom: scale })}
        onZoomStep={(d) => stepZoom(d)}
      />
      <Shortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}

function Scrubber({
  page, count, chapterFor, bookmarks, onScrub,
}: {
  page: number
  count: number
  chapterFor: (p: number) => string | undefined
  bookmarks: Set<number>
  onScrub: (p: number) => void
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const value = drag ?? page
  const pct = count > 1 ? (value / (count - 1)) * 100 : 100
  const raf = useRef(0)
  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <AnimatePresence>
        {drag != null && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 600, damping: 32 }}
            className="pointer-events-none absolute bottom-[calc(100%+10px)] z-10 max-w-[240px] -translate-x-1/2 rounded-sm bg-ink px-3 py-1.5 text-center text-canvas shadow-floating"
            style={{ left: `clamp(60px, ${pct}%, calc(100% - 60px))` }}
          >
            <div className="text-label-sm tabular">Page {value + 1}</div>
            {chapterFor(value) && <div className="truncate text-[11px] opacity-70">{chapterFor(value)}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      {/* bookmark ticks along the track */}
      <div className="pointer-events-none absolute inset-x-[9px] top-1/2 h-0">
        {[...bookmarks].map((b) => (
          <span key={b} className="absolute -top-[7px] h-[5px] w-[2px] -translate-x-1/2 rounded-full bg-link" style={{ left: `${count > 1 ? (b / (count - 1)) * 100 : 0}%` }} />
        ))}
      </div>
      <input
        type="range"
        aria-label="Page"
        min={0}
        max={Math.max(0, count - 1)}
        value={value}
        className="scrubber"
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
        onPointerDown={() => setDrag(page)}
        onChange={(e) => {
          const v = Number(e.target.value)
          setDrag(v)
          cancelAnimationFrame(raf.current)
          raf.current = requestAnimationFrame(() => onScrub(v))
        }}
        onPointerUp={() => setDrag(null)}
        onBlur={() => setDrag(null)}
        onKeyUp={() => setDrag(null)}
      />
    </div>
  )
}

function GoToPage({ page, count, onGo, progress }: { page: number; count: number; onGo: (p: number) => void; progress: number }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState('')
  if (editing)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const n = parseInt(v, 10)
          if (!Number.isNaN(n)) onGo(Math.max(1, Math.min(count, n)) - 1)
          setEditing(false)
        }}
        className="flex items-center gap-1 text-body-sm text-mute"
      >
        <input
          autoFocus
          inputMode="numeric"
          value={v}
          onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          className="h-8 w-14 rounded-sm border border-link bg-canvas-elevated text-center text-label-sm tabular text-ink outline-none ring-3 ring-link/15"
        />
        <span className="tabular">/ {count}</span>
      </form>
    )
  return (
    <button
      onClick={() => {
        setV(String(page + 1))
        setEditing(true)
      }}
      title="Go to page"
      className="flex h-8 shrink-0 flex-col items-end justify-center rounded-sm px-1.5 leading-tight transition-colors hover:bg-hairline-soft"
    >
      <span className="text-label-sm tabular text-ink">
        {page + 1}
        <span className="text-mute"> / {count}</span>
      </span>
      <span className="text-[11px] tabular text-faint" title="Pages you’ve actually read — skimming doesn’t count">{Math.round(progress * 100)}% read</span>
    </button>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl F  or  /', 'Search in book'],
  ['← →', 'Previous / next page'],
  ['Space  ·  Shift Space', 'Scroll a screen'],
  ['J  K', 'Scroll a little'],
  ['Home  End', 'First / last page'],
  ['Ctrl +  Ctrl −', 'Zoom in / out'],
  ['Ctrl 0', 'Reset zoom'],
  ['1 – 5', 'Highlight selection in a colour'],
  ['H', 'Highlight with last colour'],
  ['B', 'Bookmark page'],
  ['T  ·  N', 'Contents · Notes'],
  ['F', 'Full screen'],
  ['Esc', 'Close / toggle controls'],
]

function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts" width={420}>
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
  )
}
