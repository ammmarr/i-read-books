import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Minus, Plus, Trophy, Type } from 'lucide-react'
import type { FoliateBook, FoliateLocation, FoliateTocItem, View } from 'foliate-js/view.js'
import { db, type Book } from '../db/db'
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
import { isNative, keepScreenOn, setSystemBarsDark } from '../lib/native'
import { useReadingSession } from './useReadingSession'
import { StillReading } from './StillReading'

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
function bookCss(p: Palette, size: number) {
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
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
  flow: Flow
}
const TYPE_KEY = 'irb-epub-type'
function loadType(): TypePrefs {
  try {
    return { size: 100, flow: 'paginated', ...JSON.parse(localStorage.getItem(TYPE_KEY) || '{}') }
  } catch {
    return { size: 100, flow: 'paginated' }
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

/**
 * An EPUB, read with foliate-js: reflowable text in your page theme, turned
 * a screen at a time (or scrolled). Its "pages" are locations of 1,500
 * characters (lib/epub.ts), so your place, pages read, reading time,
 * "Still reading?" and sync work as they do for PDFs.
 */
export function EpubReader({ book, ebook }: { book: Book; ebook: FoliateBook }) {
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
  const [typeOpen, setTypeOpen] = useState(false)
  const [type, setType] = useState<TypePrefs>(loadType)
  const [scrub, setScrub] = useState<number | null>(null)

  const pageTheme: PageTheme = settings.pageTheme === 'auto' ? (dark ? 'night' : 'paper') : settings.pageTheme
  const pal: Palette = pageTheme === 'night' ? PALETTES.night : pageTheme === 'sepia' ? (dark ? PALETTES.sepiaDark : PALETTES.sepia) : PALETTES.paper
  const total = loc?.location.total ?? book.pageCount
  const lockChrome = tocOpen || typeOpen || !settings.autoHideChrome

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
  const chromeRef = useRef({ lock: lockChrome })
  chromeRef.current.lock = lockChrome
  const flowRef = useRef(type.flow)
  flowRef.current = type.flow
  useEffect(() => {
    const el = document.createElement('foliate-view') as View
    el.style.cssText = 'display:block;width:100%;height:100%'
    host.current!.append(el)
    viewRef.current = el
    let alive = true

    const onRelocate = (e: Event) => {
      const d = (e as CustomEvent<FoliateLocation>).detail
      locRef.current = d
      setLoc(d)
      if (!movable.current || performance.now() - lastInput.current > 2500) return
      poke.current()
      movedHere.current = true
      if (!chromeRef.current.lock) setChrome(false)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(persist, 500)
    }
    let lastMove = 0
    const onDocLoad = (e: Event) => {
      const { doc } = (e as CustomEvent<{ doc: Document }>).detail
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
      doc.addEventListener('keydown', onKey)
      // Paged: tap the left or right edge to turn, the middle for the bars.
      doc.addEventListener('click', (c: MouseEvent) => {
        if ((c.target as Element | null)?.closest?.('a[href]')) return
        if (doc.getSelection()?.isCollapsed === false) return
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
        const box = el.getBoundingClientRect()
        const x = ((frame?.left ?? 0) + c.clientX - box.left) / box.width
        if (flowRef.current === 'paginated' && x < 0.28) void el.goLeft()
        else if (flowRef.current === 'paginated' && x > 0.72) void el.goRight()
        else setChrome((v) => !v)
      })
    }
    el.addEventListener('relocate', onRelocate)
    el.addEventListener('load', onDocLoad)

    ;(async () => {
      try {
        await el.open(ebook)
        if (!alive) return
        el.renderer.setAttribute('flow', flowRef.current)
        el.renderer.setAttribute('margin', '48px')
        el.renderer.setAttribute('gap', '6%')
        el.renderer.setAttribute('max-inline-size', '680px')
        applyStyles()
        // Exactly where this device left off, if that's still your spot; otherwise the saved location.
        const spot = loadSpot(book.id)
        if (spot && spot.page === book.currentPage) await el.init({ lastLocation: spot.cfi })
        else if (book.currentPage > 0 && book.pageCount > 0) await el.goToFraction(Math.min(1, book.currentPage / book.pageCount))
        else await el.init({ showTextStart: true })
        if (!alive) return
        setReady(true)
        // What restoring just did isn't a move; what comes next is.
        setTimeout(() => (movable.current = true), 600)
      } catch (err) {
        console.error(err)
        toast({ tone: 'error', message: 'Couldn’t open this book', description: 'The EPUB may be damaged.' })
      }
    })()
    return () => {
      alive = false
      el.removeEventListener('relocate', onRelocate)
      el.removeEventListener('load', onDocLoad)
      el.close()
      el.remove()
      viewRef.current = null
    }
  }, [ebook]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyStyles = useCallback(() => viewRef.current?.renderer?.setStyles?.(bookCss(pal, type.size)), [pal, type.size])
  useEffect(() => {
    if (ready) applyStyles()
  }, [ready, applyStyles])
  useEffect(() => {
    if (ready) viewRef.current?.renderer?.setAttribute('flow', type.flow)
  }, [ready, type.flow])
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

  // ── Keys ────────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent) {
    const v = viewRef.current
    if (!v || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    touched()
    if (e.key === 'ArrowRight') void v.goRight()
    else if (e.key === 'ArrowLeft') void v.goLeft()
    else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) void v.next()
    else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) void v.prev()
    else return
    e.preventDefault()
  }
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

      <Sheet open={tocOpen} onClose={() => setTocOpen(false)} side="left" width={360} title="Contents" description={book.author || undefined}>
        <Toc
          items={ebook.toc ?? []}
          current={loc?.tocItem?.href}
          onPick={(href) => {
            setTocOpen(false)
            go(href)
          }}
        />
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
  const size = (d: number) => setType({ ...type, size: Math.max(70, Math.min(220, type.size + d)) })
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
          <button onClick={() => size(-10)} disabled={type.size <= 70} aria-label="Smaller text" className="grid size-9 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft disabled:opacity-40">
            <Minus className="size-4" />
          </button>
          <div className="flex-1 text-center text-heading-md tabular text-ink">{type.size}%</div>
          <button onClick={() => size(10)} disabled={type.size >= 220} aria-label="Bigger text" className="grid size-9 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft disabled:opacity-40">
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
          {(['paginated', 'scrolled'] as Flow[]).map((f) => (
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
    </div>
  )
}
