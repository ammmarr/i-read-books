import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileText, Minus, Plus, Trophy, Type } from 'lucide-react'
import { db, type Book } from '../db/db'
import { setStatus } from '../db/books'
import type { PDFDocumentProxy } from '../lib/pdf'
import { dailyGoal, updateSettings, useSettings, type PageTheme } from '../lib/settings'
import { useIsDark } from '../lib/theme'
import { vibrate } from '../lib/hooks'
import { dwellFor as dwellFor_, formatPages, readPagesOf } from '../lib/pages'
import { noteOwnPosition } from '../lib/sync'
import { Sheet } from '../components/ui/Sheet'
import { Segmented } from '../components/ui/Segmented'
import { useToast } from '../components/ui/Toast'
import { NightShiftQuick } from '../components/NightShift'
import { ReflowText, type ReflowPage } from './reflow'
import { GoToPage, leaveReader, SectionScrubber } from './ReaderControls'
import { useReadingSession } from './useReadingSession'
import { StillReading } from './StillReading'
import { ReadingClock } from './ReadingClock'
import { ReaderIsland } from './ReaderIsland'

/**
 * Reading view for a PDF: its text set again as a calm column — your size, line
 * spacing and width — instead of the printer's tight page. Same book, same
 * progress and reading time; only the way the text is laid out changes.
 */

interface Prefs {
  /** Text size in px. */
  size: number
  /** Line height, a multiple of the size. */
  lh: number
  width: 'narrow' | 'medium' | 'wide' | 'fill'
  font: 'serif' | 'sans'
}
const PREFS_KEY = 'irb-reflow-type-2'
const DEFAULTS: Prefs = { size: 22, lh: 1.75, width: 'fill', font: 'serif' }
const SIZE_MIN = 14
const SIZE_MAX = 40
const WIDTHS = { narrow: '30rem', medium: '38rem', wide: '48rem', fill: undefined } as const
const FONTS = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch {
    return DEFAULTS
  }
}

const PALETTES: Record<'paper' | 'sepia' | 'sepiaDark' | 'night', { bg: string; fg: string; mute: string; rule: string }> = {
  paper: { bg: '#ffffff', fg: '#1b1b1b', mute: '#8a8a8a', rule: '#e6e6e6' },
  sepia: { bg: '#f6efdd', fg: '#3b2f1e', mute: '#9a8a6e', rule: '#e4d9bd' },
  sepiaDark: { bg: '#2a2620', fg: '#e6dcc6', mute: '#8c826c', rule: '#3b362d' },
  night: { bg: '#171717', fg: '#d6d3cd', mute: '#77746e', rule: '#2b2b2b' },
}

const NO_CHAPTER = () => undefined
const NO_BOOKMARKS = new Set<number>()

export function ReflowReader({ book, doc, onExit }: { book: Book; doc: PDFDocumentProxy; onExit: () => void }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const settings = useSettings()
  const dark = useIsDark()
  const [prefs, setPrefs] = useState(loadPrefs)
  const setPref = useCallback((p: Partial<Prefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const pageTheme: PageTheme = settings.pageTheme === 'auto' ? (dark ? 'night' : 'paper') : settings.pageTheme
  const pal = pageTheme === 'night' ? PALETTES.night : pageTheme === 'sepia' ? (dark ? PALETTES.sepiaDark : PALETTES.sepia) : PALETTES.paper

  const text = useMemo(() => new ReflowText(doc), [doc])
  const scroller = useRef<HTMLDivElement>(null)
  const pageEls = useRef<(HTMLElement | null)[]>([])
  const [currentPage, setCurrentPage] = useState(() => Math.min(book.currentPage, book.pageCount - 1))
  const currentRef = useRef(currentPage)
  const [chrome, setChrome] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const count = book.pageCount

  // ── Where you are ───────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<{ page: number; frac: number } | null>(null)
  const savePosition = useCallback(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    const at = Date.now()
    noteOwnPosition(at)
    void db.books.update(book.id, { currentPage: p.page, pageOffset: p.frac, positionAt: at, lastOpenedAt: at })
  }, [book.id])

  const locate = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const probe = el.scrollTop + 24
    // Binary search: the last page whose top is at or above the top of the screen.
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const top = pageEls.current[mid]?.offsetTop ?? Infinity
      if (top <= probe) lo = mid
      else hi = mid - 1
    }
    const pe = pageEls.current[lo]
    const frac = pe ? Math.max(0, Math.min(1, (probe - pe.offsetTop) / Math.max(1, pe.offsetHeight))) : 0
    if (lo !== currentRef.current) {
      currentRef.current = lo
      setCurrentPage(lo)
    }
    pending.current = { page: lo, frac }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(savePosition, 600)
  }, [count, savePosition])

  const lastTop = useRef(0)
  const raf = useRef(0)
  const onScroll = useCallback(() => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const el = scroller.current
      if (!el) return
      const t = el.scrollTop
      const d = t - lastTop.current
      if (Math.abs(d) > 12) {
        // The bars go as you read on and come back when you go back up.
        setChrome(d < 0 || t < 80)
        lastTop.current = t
      }
      locate()
    })
  }, [locate])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(saveTimer.current)
      savePosition()
    },
    [savePosition],
  )

  const scrollToPage = useCallback((p: number, frac = 0, smooth = false) => {
    const el = scroller.current
    const pe = pageEls.current[Math.max(0, Math.min(count - 1, p))]
    if (!el || !pe) return
    el.scrollTo({ top: pe.offsetTop + frac * pe.offsetHeight - 24, behavior: smooth ? 'smooth' : 'auto' })
  }, [count])

  // Open where you left off.
  useLayoutEffect(() => {
    scrollToPage(currentRef.current, book.pageOffset || 0)
    lastTop.current = scroller.current?.scrollTop ?? 0
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A change of size moves the text under you: stay on the same spot of the same page.
  const keepSpot = useRef<{ page: number; frac: number } | null>(null)
  const changePref = useCallback(
    (p: Partial<Prefs>) => {
      const el = scroller.current
      const pe = pageEls.current[currentRef.current]
      if (el && pe) keepSpot.current = { page: currentRef.current, frac: (el.scrollTop + 24 - pe.offsetTop) / Math.max(1, pe.offsetHeight) }
      setPref(p)
    },
    [setPref],
  )
  useLayoutEffect(() => {
    const k = keepSpot.current
    if (!k) return
    keepSpot.current = null
    scrollToPage(k.page, k.frac)
  }, [prefs, scrollToPage])

  // ── Pages read & reading time ───────────────────────────────────────
  const readSet = useRef<Set<number>>(readPagesOf(book))
  const readTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const finishOffered = useRef(book.status === 'finished')
  const dwellFor = useCallback((page: number) => dwellFor_(text.peek(page)?.chars), [text])
  const pageSeconds = useCallback(
    (page: number) => {
      const n = text.peek(page)?.chars
      return n == null ? 90 : Math.max(30, Math.min(600, (n / 1500) * 60))
    },
    [text],
  )
  const flushRead = useCallback(async () => {
    // Merge with what's stored now (another device's pages may have arrived meanwhile).
    const b = await db.books.get(book.id)
    const all = new Set([...(b ? readPagesOf(b) : []), ...readSet.current])
    if (all.size) await db.books.update(book.id, { readPages: formatPages(all), furthestPage: Math.max(0, ...all) })
  }, [book.id])
  const onPageRead = useCallback(
    (page: number) => {
      if (readSet.current.has(page)) return
      readSet.current.add(page)
      clearTimeout(readTimer.current)
      readTimer.current = setTimeout(() => void flushRead(), 1500)
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
    [book.id, book.pageCount, book.title, toast, flushRead],
  )
  useEffect(
    () => () => {
      clearTimeout(readTimer.current)
      if (readSet.current.size) void flushRead()
    },
    [flushRead],
  )
  const { sessionSeconds, asking, away, paused, stillHere, countAway, dismissAway, pause } = useReadingSession({
    bookId: book.id,
    currentPage,
    enabled: true,
    dwellFor,
    pageSeconds,
    onPageRead,
    goalSeconds: dailyGoal(settings) * 60,
    onGoalReached: () => {
      vibrate(20)
      toast({ message: <span className="inline-flex items-center gap-1.5"><Trophy className="size-4 text-warning" /> Daily goal reached</span>, description: `${dailyGoal(settings)} minutes of reading today. Keep the streak going.`, duration: 5000 })
    },
  })
  const awayNow = (!!away && !away.back) || paused

  // ── Keys ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.altKey) return
      if ((e.ctrlKey || e.metaKey) && !['+', '=', '-', '_'].includes(e.key)) return
      if (e.key === '+' || e.key === '=') changePref({ size: Math.min(SIZE_MAX, prefs.size + 2) })
      else if (e.key === '-' || e.key === '_') changePref({ size: Math.max(SIZE_MIN, prefs.size - 2) })
      else if (e.key === 'Escape' && !settingsOpen) onExit()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [changePref, prefs.size, settingsOpen, onExit])

  // Zoom the text like a page: Ctrl + wheel (a trackpad pinch too) and a two-finger pinch.
  const sizeRef = useRef(prefs.size)
  sizeRef.current = prefs.size
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const clamp = (n: number) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(n * 2) / 2))
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      changePref({ size: clamp(sizeRef.current * Math.exp(-e.deltaY * 0.01)) })
    }
    let d0 = 0
    let s0 = 0
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) (d0 = dist(e.touches)), (s0 = sizeRef.current)
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return
      e.preventDefault()
      changePref({ size: clamp((s0 * dist(e.touches)) / d0) })
    }
    const onEnd = () => (d0 = 0)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [changePref])

  // The page doesn't lose its place when the screen is rotated or resized.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - w) < 2) return
      w = el.clientWidth
      scrollToPage(currentRef.current, pending.current?.frac ?? 0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollToPage])

  const style = {
    '--rf-fg': pal.fg,
    '--rf-mute': pal.mute,
    '--rf-rule': pal.rule,
    background: pal.bg,
    color: pal.fg,
  } as React.CSSProperties
  const nightCanvas = pageTheme === 'night'

  return (
    <div className="relative h-dvh overflow-hidden" style={style}>
      <div ref={scroller} onScroll={onScroll} onClick={() => setChrome((c) => !c)} className="reader-scroll absolute inset-0 overflow-y-auto overflow-x-hidden" tabIndex={-1}>
        <div className="relative mx-auto px-5 pb-40 pt-24 sm:px-10 lg:px-16" style={{ maxWidth: WIDTHS[prefs.width] ? `calc(${WIDTHS[prefs.width]} + 4rem)` : undefined, fontFamily: FONTS[prefs.font], fontSize: prefs.size, lineHeight: prefs.lh }}>
          {Array.from({ length: count }, (_, i) => (
            <PageSection
              key={i}
              index={i}
              text={text}
              doc={doc}
              root={scroller}
              nightCanvas={nightCanvas}
              register={(el) => (pageEls.current[i] = el)}
            />
          ))}
        </div>
      </div>

      <ReaderIsland
        show={chrome}
        title={book.title}
        sub={`Reading view · page ${currentPage + 1} of ${count}`}
        onBack={() => leaveReader(navigate)}
        bottom={
          <>
            <SectionScrubber page={currentPage} count={count} chapterFor={NO_CHAPTER} bookmarks={NO_BOOKMARKS} onScrub={(p) => scrollToPage(p)} />
            <GoToPage page={currentPage} count={count} onGo={(p) => scrollToPage(p)} progress={readSet.current.size / Math.max(1, count)} />
          </>
        }
        clock={settings.showSessionTimer && (sessionSeconds > 0 || awayNow) ? <ReadingClock seconds={sessionSeconds} paused={awayNow} onPause={pause} onResume={stillHere} /> : null}
        tools={[
          { key: 'display', label: 'Display', icon: <Type className="size-[18px]" />, onClick: () => setSettingsOpen(true) },
          { key: 'pages', label: 'PDF pages', icon: <FileText className="size-[18px]" />, onClick: onExit },
        ]}
      />

      <StillReading asking={asking} away={away} stillHere={stillHere} countAway={countAway} dismissAway={dismissAway} />

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} side="right" width={360} title="Display">
        <Section label="Text size">
          <div className="flex items-center gap-2">
            <button onClick={() => changePref({ size: Math.max(SIZE_MIN, prefs.size - 2) })} aria-label="Smaller text" className="grid size-9 place-items-center rounded-sm border border-hairline hover:bg-hairline-soft">
              <Minus className="size-4" />
            </button>
            <input
              type="range"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={1}
              value={prefs.size}
              onChange={(e) => changePref({ size: Number(e.target.value) })}
              aria-label="Text size"
              className="h-1 flex-1 accent-[var(--color-link,#0b62d6)]"
            />
            <button onClick={() => changePref({ size: Math.min(SIZE_MAX, prefs.size + 2) })} aria-label="Larger text" className="grid size-9 place-items-center rounded-sm border border-hairline hover:bg-hairline-soft">
              <Plus className="size-4" />
            </button>
          </div>
        </Section>
        <Section label="Line spacing">
          <Segmented
            stretch
            value={String(prefs.lh)}
            onChange={(v) => changePref({ lh: Number(v) })}
            options={[
              { value: '1.5', label: 'Snug' },
              { value: '1.75', label: 'Roomy' },
              { value: '2', label: 'Airy' },
              { value: '2.3', label: 'Wide' },
            ]}
          />
        </Section>
        <Section label="Line length">
          <Segmented
            stretch
            value={prefs.width}
            onChange={(v) => changePref({ width: v })}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'medium', label: 'Medium' },
              { value: 'wide', label: 'Wide' },
              { value: 'fill', label: 'Fill screen' },
            ]}
          />
        </Section>
        <Section label="Typeface">
          <Segmented
            stretch
            value={prefs.font}
            onChange={(v) => changePref({ font: v })}
            options={[
              { value: 'serif', label: 'Serif' },
              { value: 'sans', label: 'Sans' },
            ]}
          />
        </Section>
        <Section label="Page">
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { key: 'auto', label: 'Auto', paper: 'linear-gradient(135deg,#fff 50%,#1b1b1b 50%)', ink: '#888' },
                { key: 'paper', label: 'Paper', paper: '#ffffff', ink: '#171717' },
                { key: 'sepia', label: 'Sepia', paper: '#f4ecd8', ink: '#5b4636' },
                { key: 'night', label: 'Night', paper: '#1b1b1b', ink: '#d6d6d6' },
              ] as const
            ).map((t) => (
              <button key={t.key} onClick={() => updateSettings({ pageTheme: t.key })} className="group flex flex-col items-center gap-2">
                <span
                  className={`grid h-12 w-full place-items-center rounded-sm border text-[15px] font-semibold transition-all duration-200 ${settings.pageTheme === t.key ? 'border-ink ring-2 ring-ink/10' : 'border-hairline group-hover:border-faint'}`}
                  style={{ background: t.paper, color: t.ink }}
                >
                  Aa
                </span>
                <span className={`text-body-sm ${settings.pageTheme === t.key ? 'font-medium text-ink' : 'text-mute'}`}>{t.label}</span>
              </button>
            ))}
          </div>
        </Section>
        <Section label="Night Shift">
          <NightShiftQuick />
        </Section>
        <p className="border-t border-hairline pt-4 text-body-sm text-faint">
          The text is lifted out of the PDF and set again, so now and then a line may be split oddly. Highlights and notes live in the PDF’s own pages — press <span className="text-mute">Esc</span> or the page icon to go back there; you’ll be at the same spot.
        </p>
      </Sheet>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline py-5 first:border-t-0 first:pt-1">
      <h3 className="mb-3 text-mono-eyebrow text-mute">{label}</h3>
      {children}
    </section>
  )
}

/** One PDF page as text: worked out when it nears the screen, a quiet number above it. */
function PageSection({
  index, text, doc, root, nightCanvas, register,
}: {
  index: number
  text: ReflowText
  doc: PDFDocumentProxy
  root: React.RefObject<HTMLDivElement | null>
  nightCanvas: boolean
  register: (el: HTMLElement | null) => void
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [page, setPage] = useState<ReflowPage | null>(() => text.peek(index) ?? null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || page) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { root: root.current, rootMargin: '2400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [page, root])

  useEffect(() => {
    if (!near || page) return
    let alive = true
    void text.get(index).then((p) => alive && setPage(p)).catch(() => alive && setPage({ blocks: [], chars: 0 }))
    return () => {
      alive = false
    }
  }, [near, page, text, index])

  const first = page?.blocks[0]
  return (
    <section
      ref={(el) => {
        ref.current = el
        register(el)
      }}
      data-page={index}
      style={{ minHeight: page ? undefined : '70vh' }}
    >
      <div
        className="select-none text-center"
        style={{ color: 'var(--rf-mute)', fontFamily: 'system-ui, sans-serif', fontSize: 11, lineHeight: 1, letterSpacing: '0.04em', margin: first?.cont ? '0 0 0.6em' : '2.2em 0 1.6em' }}
      >
        {index + 1}
      </div>
      {page && page.blocks.length === 0 && <PageImage doc={doc} index={index} night={nightCanvas} />}
      {page?.blocks.map((b, i) =>
        b.kind === 'h' ? (
          <h2 key={i} style={{ fontSize: '1.28em', lineHeight: 1.3, fontWeight: 700, margin: '1.6em 0 0.7em', textWrap: 'balance' }}>
            {b.text}
          </h2>
        ) : (
          <p key={i} style={{ margin: '0 0 1em', textWrap: 'pretty', hyphens: 'auto', overflowWrap: 'break-word' }} lang="en">
            {b.text}
          </p>
        ),
      )}
    </section>
  )
}

/** A page with no text in it (a scan, a picture): shown as the picture it is. */
function PageImage({ doc, index, night }: { doc: PDFDocumentProxy; index: number; night: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    let canvas: HTMLCanvasElement | null = null
    void (async () => {
      try {
        const pg = await doc.getPage(index + 1)
        const base = pg.getViewport({ scale: 1 })
        const scale = Math.min(2.5, (900 * Math.min(2, window.devicePixelRatio || 1)) / base.width)
        const vp = pg.getViewport({ scale })
        canvas = document.createElement('canvas')
        canvas.width = Math.round(vp.width)
        canvas.height = Math.round(vp.height)
        canvas.style.cssText = 'display:block;width:100%;height:auto;border-radius:4px'
        if (night) canvas.style.filter = 'invert(0.9) hue-rotate(180deg) contrast(0.95)'
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await pg.render({ canvas, canvasContext: ctx, viewport: vp, intent: 'print' }).promise
        if (alive) host.current?.replaceChildren(canvas)
        pg.cleanup()
      } catch {
        /* leave it empty */
      }
    })()
    return () => {
      alive = false
    }
  }, [doc, index, night])
  return <div ref={host} className="my-2 min-h-24" aria-label={`Page ${index + 1}, a picture`} />
}
