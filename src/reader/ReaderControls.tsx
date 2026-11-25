import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { NavigateFunction } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CornerUpLeft, MonitorSmartphone, X as XIcon } from 'lucide-react'

/** What the PDF and EPUB readers share: leaving, the page scrubber, the page box, and the "you were here" pills. */

/** The reader's Back: to where you came from — or, opened straight at the book (a link, a new window), the library. */
export function leaveReader(navigate: NavigateFunction) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
  if (idx > 0) navigate(-1)
  else navigate('/', { replace: true })
}

export function Scrubber({
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
        style={{ '--fill': `${pct}%` } as CSSProperties}
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

export function GoToPage({ page, count, onGo, progress }: { page: number; count: number; onGo: (p: number) => void; progress: number }) {
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

const pillSpot = (chrome: boolean) =>
  `absolute left-1/2 z-40 flex -translate-x-1/2 items-center rounded-full border border-hairline bg-canvas-elevated pl-1 shadow-floating ${
    chrome ? 'bottom-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+80px)]' : 'bottom-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+20px)]'
  } transition-[bottom] duration-300`

/** Newer position from another device. */
export function ElsewherePill({ page, chrome, onGo, onStay }: { page: number | null; chrome: boolean; onGo: () => void; onStay: () => void }) {
  return (
    <AnimatePresence>
      {page != null && (
        <motion.div
          key="elsewhere"
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          className={pillSpot(chrome)}
        >
          <button onClick={onGo} className="flex h-10 items-center gap-2 rounded-full px-3 text-label-sm text-ink hover:bg-hairline-soft">
            <MonitorSmartphone className="size-4 text-link" />
            Continue from page {page + 1}
            <span className="font-normal text-mute">· read on another device</span>
          </button>
          <button onClick={onStay} aria-label="Stay here" className="mr-1 grid size-8 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
            <XIcon className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Back to where you left off, after a jump. */
export function PlacePill({ page, chrome, onBack, onStay }: { page: number | null; chrome: boolean; onBack: () => void; onStay: () => void }) {
  return (
    <AnimatePresence>
      {page != null && (
        <motion.div
          key="place"
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          className={pillSpot(chrome)}
        >
          <button onClick={onBack} className="flex h-10 items-center gap-2 rounded-full px-3 text-label-sm text-ink hover:bg-hairline-soft">
            <CornerUpLeft className="size-4 text-link" />
            Back to page {page + 1}
            <span className="font-normal text-mute">· where you left off</span>
          </button>
          <button onClick={onStay} aria-label="Stay here" title="Stay here" className="mr-1 grid size-8 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
            <XIcon className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Where you are, as the book's chapters side by side: each section as wide as
 * its pages, filled up to where you are. Point at it to see the chapter and
 * page; press or drag to go there. Bookmarks are ticks above, highlights dots.
 */
export function SectionScrubber({
  page, count, chapterFor, bookmarks, marks, onScrub,
}: {
  page: number
  count: number
  chapterFor: (p: number) => string | undefined
  bookmarks: Set<number>
  /** Pages with highlights. */
  marks?: Set<number>
  onScrub: (p: number) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState(false)
  // Runs of pages under the same chapter name (one section if the book has no contents).
  const sections = useMemo(() => {
    const out: { from: number; to: number; title?: string }[] = []
    for (let p = 0; p < count; p++) {
      const t = chapterFor(p)
      const last = out[out.length - 1]
      if (last && last.title === t) last.to = p
      else out.push({ from: p, to: p, title: t })
    }
    // Very short runs (a title page, a blank) join the one before, so the bar stays readable.
    const merged: typeof out = []
    for (const s of out) {
      const last = merged[merged.length - 1]
      if (last && s.to - s.from < Math.max(1, count / 120)) last.to = s.to
      else merged.push({ ...s })
    }
    return merged.length ? merged : [{ from: 0, to: Math.max(0, count - 1) }]
  }, [count, chapterFor])
  const pageAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect()
    if (!r || count < 1) return 0
    return Math.max(0, Math.min(count - 1, Math.round(((clientX - r.left) / r.width) * (count - 1))))
  }
  const at = hover ?? page
  const pct = (p: number) => (count > 1 ? (p / (count - 1)) * 100 : 0)
  const showTip = hover != null
  return (
    <div className="relative flex h-8 min-w-0 flex-1 items-center">
      {showTip && (
        <div
          className="pointer-events-none absolute bottom-[calc(100%+6px)] z-10 max-w-[240px] -translate-x-1/2 rounded-sm bg-ink px-2.5 py-1.5 text-center text-canvas shadow-floating"
          style={{ left: `clamp(60px, ${pct(at)}%, calc(100% - 60px))` }}
        >
          <div className="text-label-sm tabular">Page {at + 1}</div>
          {chapterFor(at) && <div className="truncate text-[11px] opacity-70">{chapterFor(at)}</div>}
        </div>
      )}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Page"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={page + 1}
        aria-valuetext={`Page ${page + 1}${chapterFor(page) ? `, ${chapterFor(page)}` : ''}`}
        onPointerMove={(e) => {
          const p = pageAt(e.clientX)
          setHover(p)
          if (drag) onScrub(p)
        }}
        onPointerLeave={() => !drag && setHover(null)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(true)
          const p = pageAt(e.clientX)
          setHover(p)
          onScrub(p)
        }}
        onPointerUp={() => {
          setDrag(false)
          setHover(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onScrub(Math.min(count - 1, page + 1))
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onScrub(Math.max(0, page - 1))
          else return
          e.preventDefault()
        }}
        className="group/s relative flex h-full w-full cursor-pointer touch-none items-center gap-[2px] outline-none focus-visible:ring-2 focus-visible:ring-link/40"
      >
        {sections.map((s) => {
          const len = s.to - s.from + 1
          const fill = page >= s.to ? 100 : page < s.from ? 0 : ((page - s.from + 1) / len) * 100
          const here = at >= s.from && at <= s.to && hover != null
          return (
            <span
              key={s.from}
              className={`relative h-1 overflow-hidden rounded-[2px] transition-[height,background-color] duration-150 group-hover/s:h-[7px] ${here ? 'bg-faint/70' : 'bg-hairline'}`}
              style={{ flex: `${len} 1 0` }}
            >
              <i className="absolute inset-y-0 left-0 rounded-[2px] bg-ink" style={{ width: `${fill}%` }} />
            </span>
          )
        })}
        {/* bookmarks and highlights along the track */}
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-0">
          {[...bookmarks].map((b) => (
            <span key={`b${b}`} className="absolute -top-[9px] h-[5px] w-[2px] -translate-x-1/2 rounded-full bg-link" style={{ left: `${pct(b)}%` }} />
          ))}
          {[...(marks ?? [])].map((m) => (
            <span key={`m${m}`} className="absolute -top-[8px] size-[3px] -translate-x-1/2 rounded-full bg-warning" style={{ left: `${pct(m)}%` }} />
          ))}
        </span>
      </div>
    </div>
  )
}
