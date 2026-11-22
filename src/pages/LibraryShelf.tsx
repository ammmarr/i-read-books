import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { ArrowRight, ChevronsRight, Flame, NotebookPen } from 'lucide-react'
import { db, type Book, type BookStatus, type Session, type WebRead } from '../db/db'
import { bookProgress, reorderQueue } from '../db/books'
import { readCount, unreadAhead } from '../lib/pages'
import { continueFrom } from '../lib/openBook'
import { BookCover } from '../components/BookCover'
import { hash, paperFor } from '../lib/covers'
import { Button } from '../components/ui/Button'
import { Sheet } from '../components/ui/Sheet'
import { dailyGoal, useSettings } from '../lib/settings'
import { webSessions, webToday } from '../lib/web'
import { addDays, bookStats, dailyTotals, dayKey, daysTaken, finishGuess, startOfDay, streaks, summarize, todaySeconds } from '../lib/stats'
import { formatDuration, formatDurationLong, pluralize, relativeTime } from '../lib/format'
import { useIsMobile } from '../lib/hooks'

/**
 * The Library's top (the book you're reading, today against your goal) and its
 * shelf: every book as a spine — thicker for more pages, in its cover's colour —
 * on shelves that fill the width. Click a spine and it comes out, with its details.
 */

const shortDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** A row of ticks, lit up to `value` (0–1): how far along, as on the Insights page. */
function Ticks({ value, n, height = 14 }: { value: number; n: number; height?: number }) {
  const lit = Math.round(Math.min(1, Math.max(0, value)) * n)
  return (
    <div className="flex gap-[2px]" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={`flex-1 rounded-[1px] ${i < lit ? 'bg-ink' : 'bg-hairline'}`} style={{ height }} />
      ))}
    </div>
  )
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 pt-3 pr-3 [&+&]:border-l [&+&]:border-hairline [&+&]:pl-3 sm:pr-4 sm:[&+&]:pl-4" title={title}>
      <div className="text-body-sm text-mute">{label}</div>
      <div className="mt-0.5 truncate text-[16px] font-medium text-ink sm:text-[17px]">{value}</div>
    </div>
  )
}

// ── The book you're reading ─────────────────────────────────────────────

export function ContinueCard({ book, sessions }: { book: Book; sessions: Session[] }) {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const progress = bookProgress(book)
  const left = Math.max(0, book.pageCount - readCount(book))
  const guess = finishGuess(book, sessions)
  const unread = unreadAhead(book)
  const ends = guess.date == null ? null : guess.days === 0 ? 'Today' : shortDate(guess.date)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex gap-5 overflow-hidden rounded-md border border-hairline bg-canvas-elevated p-4 sm:gap-6 sm:p-6"
    >
      {/* the cover's own colour, whispered into the card */}
      <div className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full opacity-[0.14] blur-3xl dark:opacity-[0.12]" style={{ background: book.tint }} />
      <motion.button
        whileHover={{ rotate: -1.5, y: -3 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => navigate(`/read/${book.id}`)}
        className="relative w-[84px] shrink-0 self-start rounded-[4px] shadow-cover-lift sm:w-[118px]"
        aria-label={`Resume ${book.title}`}
      >
        <BookCover book={book} />
      </motion.button>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="truncate text-mono-eyebrow text-mute">
          Continue reading{book.lastOpenedAt ? ` · last read ${relativeTime(book.lastOpenedAt)}` : ''}
        </div>
        <h2 className="mt-2 line-clamp-2 text-[22px] font-semibold leading-tight tracking-[-0.6px] text-ink sm:text-[28px] sm:tracking-[-0.8px]">{book.title}</h2>
        {book.author && <p className="mt-0.5 truncate text-body-md text-body">{book.author}</p>}
        <div className="mt-4 grid grid-cols-3 border-t border-hairline">
          <Stat label="Progress" value={`${Math.round(progress * 100)}%`} />
          <Stat label="Left" value={pluralize(left, 'page')} />
          <Stat label="Ends" value={ends ?? '—'} title={ends ? undefined : 'Read a little more to see a date'} />
        </div>
        <div className="mt-4">
          <Ticks value={progress} n={mobile ? 32 : 60} height={mobile ? 10 : 14} />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          <Button onClick={() => navigate(`/read/${book.id}`)} size="md">
            Continue · p. {book.currentPage + 1} <ArrowRight className="size-4" />
          </Button>
          {unread != null && unread !== book.currentPage && (
            <Button variant="outline" size="md" onClick={() => continueFrom(navigate, book.id, unread)} title="The first page you haven’t read yet">
              <ChevronsRight className="size-4" /> From p. {unread + 1}
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate(`/book/${book.id}`)} className="hidden sm:inline-flex">
            <NotebookPen className="size-4" /> Notes & highlights
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

// ── Today ───────────────────────────────────────────────────────────────

const GAUGE_TICKS = 44

/** Today against your daily goal as a ring of ticks (books bright, the web grey), your streak, and this week. */
export function TodayCard({ sessions, reads }: { sessions: Session[]; reads: WebRead[] }) {
  const goalMin = dailyGoal(useSettings())
  const goal = goalMin * 60
  const books = todaySeconds(sessions)
  const total = books + webToday(reads)
  const met = goal > 0 && total >= goal
  const daily = dailyTotals([...sessions, ...webSessions(reads)])
  const s = streaks(daily)
  const litAll = goal ? Math.round(Math.min(1, total / goal) * GAUGE_TICKS) : 0
  const litBooks = goal ? Math.min(litAll, Math.round(Math.min(1, books / goal) * GAUGE_TICKS)) : 0
  const today = startOfDay(Date.now())
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - 6)
    return { d, secs: daily.get(dayKey(d))?.seconds ?? 0, today: i === 6 }
  })
  const top = Math.max(goal, ...week.map((w) => w.secs), 1)
  const mins = Math.floor(total / 60)
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}>
      <Link to="/stats" className="flex h-full flex-col items-center rounded-md border border-hairline bg-canvas-elevated px-5 pb-4 pt-3 transition-colors hover:border-faint/40">
        <div className="relative size-[176px]" role="img" aria-label={`Today: ${mins} of ${goalMin} minutes`}>
          {Array.from({ length: GAUGE_TICKS }, (_, i) => (
            <i
              key={i}
              className={`absolute left-1/2 top-1/2 rounded-[2px] ${i < litBooks ? 'bg-ink' : i < litAll ? 'bg-mute' : 'bg-hairline'}`}
              style={{ width: 4, height: 18, marginLeft: -2, transformOrigin: '50% 0', transform: `rotate(${-135 + (270 * i) / (GAUGE_TICKS - 1)}deg) translateY(-82px)` }}
            />
          ))}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-body-sm text-mute">Today</span>
            <span className="text-[22px] font-medium tracking-[-0.5px] text-ink">
              {mins}
              <span className="text-[13px] font-normal text-mute"> / {goalMin} min</span>
            </span>
            <span className={`text-body-sm ${met ? 'text-success' : 'text-faint'}`}>{met ? 'Goal reached' : total > 0 ? `${Math.max(1, Math.ceil((goal - total) / 60))} min to go` : 'Not started yet'}</span>
          </div>
        </div>
        <p className="-mt-1 flex items-center gap-1.5 text-body-sm text-ink">
          <Flame className={`size-3.5 ${s.readToday ? 'text-warning' : 'text-faint'}`} />
          {s.current > 0 ? `${s.current}-day streak` : 'Start a streak today'}
          {s.longest > s.current && <span className="text-mute"> · best {s.longest}</span>}
        </p>
        <div className="mt-3 w-full">
          <div className="flex h-11 items-end gap-[3px]" aria-hidden="true">
            {week.map((w) => (
              <i
                key={w.d}
                className={`flex-1 rounded-t-[2px] ${w.today ? 'bg-ink' : goal && w.secs >= goal ? 'bg-mute' : 'bg-hairline'}`}
                style={{ height: `${Math.max(6, (w.secs / top) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] text-faint">
            {week.map((w) => (
              <span key={w.d} className="flex-1 text-center">{new Date(w.d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
            ))}
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

// ── The shelf ───────────────────────────────────────────────────────────

export type Arrange = 'shelf' | 'colour'
export type ShelfFilter = 'all' | BookStatus

function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * A spine's colour: its cover's, unless the cover is near-white (most PDFs) —
 * then the cloth colour its typeset cover gets, so spine and cover match.
 */
function spineColour(b: Book) {
  let rgb = rgbOf(b.tint ?? '')
  if (rgb) {
    const mx = Math.max(...rgb), mn = Math.min(...rgb), l = (mx + mn) / 2
    if (l > 0.82 && mx - mn < 0.1) rgb = null
  }
  const bg = rgb ? b.tint! : paperFor(b.title).bg
  const [r, g, bl] = rgbOf(bg)!
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn
  // Hue for arranging by colour; greys and creams after the colours, dark to light.
  let hue = 400 + ((mx + mn) / 2) * 100
  if (d >= 0.06) {
    const h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4
    hue = (h * 60 + 360) % 360
  }
  return { bg, ink: lum > 0.55 ? '#1d1d1d' : '#ececec', hue }
}

interface Spine {
  book: Book
  w: number
  h: number
  bg: string
  ink: string
  hue: number
}
type Slot = { kind: 'book'; spine: Spine } | { kind: 'gap' }
interface Row {
  label?: string
  note?: string
  slots: Slot[]
}

const SLOT_GAP = 3
const GROUP_GAP = 18

function spineOf(b: Book): Spine {
  const c = spineColour(b)
  return { book: b, w: Math.round(Math.min(58, Math.max(20, 22 + b.pageCount / 22))), h: 150 + (hash(b.id + 'h') % 49), ...c }
}

/** Fill shelves left to right; a group starts its own shelf with its label. */
function fill(groups: { label: string; note: string; slots: Slot[] }[], width: number): Row[] {
  const rows: Row[] = []
  const room = Math.max(120, width - 24)
  for (const g of groups) {
    let row: Row = { label: g.label, note: g.note, slots: [] }
    let used = 0
    for (const s of g.slots) {
      const w = s.kind === 'gap' ? GROUP_GAP : s.spine.w + SLOT_GAP
      if (used + w > room && row.slots.length) {
        rows.push(row)
        row = { slots: [] }
        used = 0
        if (s.kind === 'gap') continue
      }
      row.slots.push(s)
      used += w
    }
    if (row.slots.length) rows.push(row)
  }
  return rows
}

export function Shelf({ books, sessions, filter, query, arrange, selected, onSelect }: {
  books: Book[]
  sessions: Session[]
  filter: ShelfFilter
  query: string
  arrange: Arrange
  selected: string | null
  onSelect: (id: string) => void
}) {
  const mobile = useIsMobile()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [sheet, setSheet] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const spines = useMemo(() => books.map(spineOf), [books])
  const rows = useMemo(() => {
    if (!width) return []
    const by = (s: BookStatus) => spines.filter((x) => x.book.status === s)
    if (arrange === 'colour') {
      return fill([{ label: 'By colour', note: 'every book, by its spine', slots: [...spines].sort((a, b) => a.hue - b.hue).map((spine) => ({ kind: 'book' as const, spine })) }], width)
    }
    const reading = by('reading').sort((a, b) => (b.book.lastOpenedAt ?? 0) - (a.book.lastOpenedAt ?? 0))
    const queued = by('queued').sort((a, b) => a.book.queueOrder - b.book.queueOrder)
    const finished = by('finished').sort((a, b) => (b.book.finishedAt ?? 0) - (a.book.finishedAt ?? 0))
    const rest = by('none').sort((a, b) => b.book.addedAt - a.book.addedAt)
    const year = new Date().getFullYear()
    const thisYear = finished.filter((x) => x.book.finishedAt && new Date(x.book.finishedAt).getFullYear() === year).length
    const slots = (xs: Spine[]): Slot[] => xs.map((spine) => ({ kind: 'book', spine }))
    const groups = []
    if (reading.length || queued.length) {
      groups.push({
        label: reading.length && queued.length ? 'Reading, then up next' : reading.length ? 'Reading' : 'Up next',
        note: [reading.length && `${reading.length} reading`, queued.length && `${queued.length} up next, in order`].filter(Boolean).join(' · '),
        slots: [...slots(reading), ...(reading.length && queued.length ? [{ kind: 'gap' } as Slot] : []), ...slots(queued)],
      })
    }
    if (finished.length) groups.push({ label: 'Finished', note: `${pluralize(finished.length, 'book')}${thisYear ? ` · ${thisYear} this year` : ''}`, slots: slots(finished) })
    if (rest.length) groups.push({ label: 'Also on your shelf', note: pluralize(rest.length, 'book'), slots: slots(rest) })
    return fill(groups, width)
  }, [spines, arrange, width])

  const q = query.trim().toLowerCase()
  const dim = (b: Book) => (filter !== 'all' && b.status !== filter) || (!!q && !b.title.toLowerCase().includes(q) && !b.author.toLowerCase().includes(q))
  const queuePlace = (b: Book) => books.filter((x) => x.status === 'queued').sort((x, y) => x.queueOrder - y.queueOrder).findIndex((x) => x.id === b.id) + 1
  const pick = (id: string) => {
    onSelect(id)
    if (mobile) setSheet(true)
  }
  const current = books.find((b) => b.id === selected) ?? null
  const none = q && books.every(dim)

  return (
    <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
      <div ref={ref} className="min-w-0">
        {rows.map((row, ri) => (
          <div key={ri}>
            {row.label ? (
              <div className="mx-0.5 mb-2 mt-5 flex items-baseline justify-between gap-3 text-body-sm">
                <span className="text-ink">{row.label}</span>
                <span className="truncate text-faint">{row.note}</span>
              </div>
            ) : (
              <div className="h-6" />
            )}
            {/* room above the tallest spine for it to lift out without touching the label */}
            <div className="flex min-h-[226px] items-end gap-[3px] rounded-b-[3px] border-b-[7px] border-hairline px-3 shadow-[0_12px_20px_-14px_rgba(0,0,0,0.55)]">
              {row.slots.map((slot, si) =>
                slot.kind === 'gap' ? (
                  <div key={`g${si}`} className="shrink-0" style={{ width: GROUP_GAP }} />
                ) : (
                  <SpineButton
                    key={slot.spine.book.id}
                    spine={slot.spine}
                    selected={slot.spine.book.id === selected}
                    dim={dim(slot.spine.book)}
                    queue={arrange === 'shelf' && slot.spine.book.status === 'queued' ? queuePlace(slot.spine.book) : 0}
                    onPick={pick}
                  />
                ),
              )}
            </div>
          </div>
        ))}
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-body-sm text-mute">
          {none ? <span className="text-ink">No books match “{query.trim()}”.</span> : <span>Point at a book; click to take it out.</span>}
          <span>Thicker means more pages.</span>
        </p>
      </div>
      {current &&
        (mobile ? (
          <Sheet open={sheet} onClose={() => setSheet(false)}>
            <SpineDetail book={current} books={books} sessions={sessions} />
          </Sheet>
        ) : (
          <div className="self-start rounded-md border border-hairline bg-canvas-elevated p-5 lg:sticky lg:top-6 lg:mt-12">
            <SpineDetail book={current} books={books} sessions={sessions} />
          </div>
        ))}
    </div>
  )
}

function SpineButton({ spine, selected, dim, queue, onPick }: { spine: Spine; selected: boolean; dim: boolean; queue: number; onPick: (id: string) => void }) {
  const b = spine.book
  const progress = bookProgress(b)
  const style: CSSProperties = {
    width: spine.w,
    height: spine.h,
    background: spine.bg,
    color: spine.ink,
    opacity: dim ? 0.18 : 1,
    boxShadow: `${selected ? '0 0 0 1.5px var(--color-ink), ' : ''}inset -2px 0 0 rgba(0,0,0,.28), inset 2px 0 0 rgba(255,255,255,.07)`,
    // On your list without a PDF yet: a dashed edge.
    ...(b.pageCount === 0 ? { outline: '1px dashed currentColor', outlineOffset: -4 } : {}),
  }
  return (
    <button
      type="button"
      onClick={() => onPick(b.id)}
      aria-label={`${b.title}${b.author ? `, ${b.author}` : ''}${b.status === 'reading' ? `, ${Math.round(progress * 100)}% read` : b.status === 'queued' ? `, up next ${queue || ''}` : b.status === 'finished' ? ', finished' : ''}`}
      aria-pressed={selected}
      title={`${b.title}${b.author ? ` — ${b.author}` : ''}`}
      className={`relative shrink-0 rounded-t-[2px] rounded-b-[1px] outline-none transition-[transform,opacity,box-shadow] duration-200 ease-[cubic-bezier(.2,0,0,1)] focus-visible:-translate-y-2 ${selected ? '-translate-y-4' : 'hover:-translate-y-2'}`}
      style={style}
    >
      <span className="absolute inset-x-0 top-2 h-[2px] bg-current opacity-20" />
      <span className="absolute inset-x-0 bottom-5 h-[2px] bg-current opacity-20" />
      <span className="absolute left-1/2 top-4 max-h-[calc(100%-46px)] -translate-x-1/2 overflow-hidden whitespace-nowrap text-[10.5px] font-semibold [writing-mode:vertical-rl]">{b.title}</span>
      {b.status === 'reading' && progress > 0 && (
        <span className="absolute inset-x-[3px] bottom-[7px] h-[3px] overflow-hidden rounded-[2px] bg-black/30">
          <i className="block h-full bg-current" style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
      {queue > 0 && <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 font-mono text-[9.5px] font-semibold leading-none opacity-80">{queue}</span>}
    </button>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-hairline-soft py-[7px] text-body-md">
      <span className="text-mute">{k}</span>
      <span className="truncate text-ink">{v}</span>
    </div>
  )
}

/** The book you took out: where you are in it, and the right next step. */
function SpineDetail({ book, books, sessions }: { book: Book; books: Book[]; sessions: Session[] }) {
  const navigate = useNavigate()
  const highlights = useLiveQuery(() => db.highlights.where('bookId').equals(book.id).count(), [book.id]) ?? 0
  const progress = bookProgress(book)
  const queued = books.filter((x) => x.status === 'queued').sort((x, y) => x.queueOrder - y.queueOrder)
  const place = queued.findIndex((x) => x.id === book.id) + 1
  const overall = summarize(sessions, 0, Infinity).pagesPerHour
  const stats = bookStats(book, sessions, overall)
  const guess = finishGuess(book, sessions)
  const spent = sessions.filter((s) => s.bookId === book.id).reduce((a, s) => a + s.seconds, 0)
  const noFile = book.pageCount === 0
  const started = book.status !== 'finished' && progress > 0
  const status = noFile ? 'No PDF yet' : book.status === 'reading' ? 'Reading' : book.status === 'queued' ? `Up next · ${place}` : book.status === 'finished' ? 'Finished' : started ? 'Started' : 'On your shelf'

  const rows: [string, string][] = []
  if (noFile) rows.push(['On your list since', new Date(book.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })])
  else if (book.status === 'finished') {
    if (book.finishedAt) rows.push(['Finished', new Date(book.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })])
    const took = daysTaken(book, sessions)
    if (took) rows.push(['Took', pluralize(took, 'day')])
    rows.push(['Pages', String(book.pageCount)], ['Highlights', String(highlights)])
  } else if (book.status === 'queued' && !started) {
    rows.push(['Place in the queue', String(place)], ['Pages', String(book.pageCount)])
    if (stats.remainingSeconds) rows.push(['About', `${formatDurationLong(stats.remainingSeconds)} at your pace`])
  } else {
    rows.push(['Pages', `${readCount(book)} of ${book.pageCount}`])
    if (guess.secondsPerDay >= 60) rows.push(['Pace', `${Math.round(guess.secondsPerDay / 60)} min a day`])
    rows.push(['Ends', guess.date == null ? '—' : guess.days === 0 ? 'Today' : shortDate(guess.date)])
    if (spent) rows.push(['Time spent', formatDuration(spent, { short: true })])
    rows.push(['Highlights', String(highlights)])
  }

  const open = () => navigate(noFile ? `/book/${book.id}` : `/read/${book.id}`)
  const cta = noFile ? 'Add the PDF' : book.status === 'finished' ? 'Open again' : started ? `Continue · p. ${book.currentPage + 1}` : 'Start reading'
  return (
    <div>
      <div className="flex items-end gap-3.5">
        <div className="w-[78px] shrink-0 rounded-[3px] shadow-cover">
          <BookCover book={book} rounded="rounded-[3px]" />
        </div>
        <div className="min-w-0">
          <div className="text-mono-eyebrow text-mute">{status}</div>
          <div className="mt-1 line-clamp-3 text-[17px] font-semibold leading-tight tracking-[-0.3px] text-ink">{book.title}</div>
          {book.author && <div className="mt-0.5 truncate text-body-sm text-mute">{book.author}</div>}
        </div>
      </div>
      {started && (
        <div className="mt-3.5">
          <Ticks value={progress} n={30} height={8} />
        </div>
      )}
      <div className="mt-3">{rows.map(([k, v]) => <Row key={k} k={k} v={v} />)}</div>
      <Button className="mt-4 w-full justify-center" onClick={open}>
        {cta} <ArrowRight className="size-4" />
      </Button>
      {book.status === 'queued' && place > 1 ? (
        <Button variant="outline" className="mt-2 w-full justify-center" onClick={() => void reorderQueue([book.id, ...queued.filter((x) => x.id !== book.id).map((x) => x.id)])}>
          Move to the front
        </Button>
      ) : (
        !noFile && (
          <Button variant="outline" className="mt-2 w-full justify-center" onClick={() => navigate(`/book/${book.id}`)}>
            <NotebookPen className="size-4" /> {highlights ? `Notes & highlights · ${highlights}` : 'Details'}
          </Button>
        )
      )}
    </div>
  )
}
