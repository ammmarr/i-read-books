import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { CountUp } from '../components/CountUp'
import { useNavigate } from 'react-router'
import { RotateCw, TrendingUp } from 'lucide-react'
import type { Book, HighlightColor, Session } from '../db/db'
import type { Mark } from '../lib/marks'
import { bookProgress } from '../db/books'
import { BookCover } from '../components/BookCover'
import { paperFor } from '../lib/covers'
import type { ShareLog } from '../lib/share'
import { formatDuration, pluralize } from '../lib/format'
import { useIsMobile } from '../lib/hooks'
import { addDays, booksInProgress, dayKey, daysTaken, finishGuess, finishedBooks, onTrackFor, startOfDay, type Bucket } from '../lib/stats'

/**
 * The Insights page's parts (pages/Stats.tsx puts them together): a sentence
 * about your reading, time as a line over daily bars, insights in words, a year
 * of days as a commit graph, highlights & quotes, and your year with its books.
 */

type Daily = Map<string, { seconds: number }>

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md border border-hairline bg-canvas-elevated p-5 sm:p-6 ${className}`}>{children}</div>
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-heading-md text-ink">{title}</h2>
        {note && <span className="truncate text-body-sm text-mute">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** A change for the better, in green. Insights only ever cheers: a dip is said quietly, or not at all. */
export function Up({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-body-sm text-success">
      <span className="grid size-3.5 place-items-center rounded-full bg-success text-[9px] font-bold leading-none text-canvas">↑</span>
      {text}
    </span>
  )
}

// ── The sentence ────────────────────────────────────────────────────────

export type Said = (string | { b: string })[]

export function Hero({ said, stats, aside }: { said: Said; stats: { label: string; value: string; extra?: ReactNode }[]; aside: ReactNode }) {
  return (
    <div className="grid items-center gap-6 border-b border-hairline pb-7 lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-8">
      <div className="min-w-0">
        <p className="text-[23px] leading-[1.25] tracking-[-0.5px] text-mute sm:text-[29px] lg:text-[34px] lg:tracking-[-0.9px]">
          {said.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <b key={i} className="font-medium text-ink">{p.b}</b>))}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 pr-4 sm:[&+&]:border-l sm:[&+&]:border-hairline sm:[&+&]:pl-4">
              <div className="text-body-sm text-mute">{s.label}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[17px] font-medium tracking-[-0.3px] text-ink">
                {s.value}
                {s.extra}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center">{aside}</div>
    </div>
  )
}

// ── Time reading: the average as a line, each day (week, month) as a bar ─

/** Grid steps in minutes: lines land on round numbers (2h, 4h, 6h…), never 90m or 4.5h. */
const STEPS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 600, 1200, 1800, 3000, 6000, 12000]
const tick = (m: number) => (m < 60 ? `${Math.round(m)}m` : m % 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${m / 60}h`)

function smooth(pts: [number, number][], H: number) {
  if (!pts.length) return ''
  const cl = (v: number) => Math.max(0, Math.min(H, v))
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, cl(p1[1] + (p2[1] - p0[1]) / 6)]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, cl(p2[1] - (p3[1] - p1[1]) / 6)]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

export function TimeChart({ buckets, grain, goal, highlights, total, change, before }: {
  buckets: Bucket[]
  grain: 'day' | 'week' | 'month'
  /** Seconds per bucket that meets your goal (0: no line). */
  goal: number
  /** Highlights made in each bucket. */
  highlights: number[]
  total: number
  /** Against the period before, as a fraction (null: nothing to compare). */
  change: number | null
  before: string
}) {
  const n = buckets.length
  const mobile = useIsMobile()
  // Nothing is picked until you point at (or tap) a bar: the details only show then.
  const [hover, setHover] = useState<number | null>(null)
  const plot = useRef<HTMLDivElement>(null)
  // A tap anywhere else puts the details away again (on a phone there's no pointer to move off).
  useEffect(() => {
    if (hover == null) return
    const away = (e: globalThis.PointerEvent) => { if (!plot.current?.contains(e.target as Node)) setHover(null) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [hover])
  const mins = buckets.map((b) => b.seconds / 60)
  const win = grain === 'day' ? 7 : grain === 'week' ? 4 : 3
  // The day (week, month) you're in isn't over: its bar reads "so far", and the average
  // line stops at the last full one, so a half-done week doesn't drag the line down.
  const live = n > 1 && buckets[n - 1].isCurrent ? n - 1 : -1
  const avg = mins.map((_, i) => {
    const hi = i === live ? i : i + 1
    const w = mins.slice(Math.max(0, hi - win), hi)
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0
  })
  // Room above the goal line for its label.
  const raw = Math.max(1, ...mins, (goal / 60) * 1.08)
  const step = STEPS.find((s) => raw / s <= 5) ?? 24000
  const top = step * Math.ceil(raw / step)
  const grid = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step)
  const W = 600, H = 160
  // Every bar sits in the middle of its column, and so does its point on the line.
  const at = (i: number) => ((i + 0.5) / n) * 100
  const pts = avg.slice(0, live >= 0 ? live : n).map((m, i): [number, number] => [(at(i) / 100) * W, H - (m / top) * H])
  const line = smooth(pts, H)
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z` : ''
  const marks = [...new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (n - 1)) / 4)))]
  const b = hover != null ? buckets[hover] : null
  const left = hover != null ? at(hover) : 0
  const word = grain === 'day' ? 'day' : grain === 'week' ? 'week' : 'month'
  const unit = hover === live ? (grain === 'day' ? 'Today so far' : `This ${word} so far`) : `That ${word}`
  const avgLabel = grain === 'day' ? '7-day average' : grain === 'week' ? '4-week average' : '3-month average'
  const goalLabel = `${formatDuration(goal, { short: true })} a ${grain === 'week' ? 'week' : 'day'}`
  const pick = (i: number) => (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') return
    setHover((x) => (x === i ? null : i))
  }
  if (!n) return null
  return (
    <Card className="!pb-4">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[26px] font-medium leading-tight tracking-[-0.6px] text-ink"><CountUp value={total} format={(n) => formatDuration(n)} /></div>
          <div className="text-body-sm text-mute">Time reading</div>
        </div>
        {change != null && change > 0.005 && <Up text={`${(change * 100).toFixed(change < 0.1 ? 1 : 0)}% over ${before}`} />}
      </div>
      <div ref={plot} className="relative ml-10 h-[200px]" onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}>
        {grid.map((m) => (
          <div key={m} className="absolute inset-x-0 border-t border-dashed border-hairline" style={{ top: `${(1 - m / top) * 100}%` }}>
            <span className="absolute -left-10 w-8 -translate-y-1/2 text-right text-[11px] text-faint">{m ? tick(m) : '0'}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex" aria-hidden="true">
          {mins.map((m, i) => (
            <div key={i} className="flex h-full flex-1 items-end justify-center">
              <i
                className={`ir-grow-y w-[46%] rounded-t-[2px] transition-[background-color,height] duration-300 ${i === hover ? 'bg-mute' : i === live ? 'bg-hairline/50' : 'bg-hairline'}`}
                style={{ height: `${Math.max(1, (m / top) * 100)}%`, '--i': i } as CSSProperties}
              />
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="insights-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-ink)" stopOpacity="0.1" />
              <stop offset="1" stopColor="var(--color-ink)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <path key={`a${grain}${n}`} d={area} fill="url(#insights-area)" className="ir-fade" style={{ '--d': '700ms' } as CSSProperties} />}
          {pts.length > 1 && <path key={`l${grain}${n}`} d={line} pathLength={1} fill="none" stroke="var(--color-body)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" className="ir-draw" />}
        </svg>
        {goal > 0 && goal / 60 <= top && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-faint/60" style={{ top: `${(1 - goal / 60 / top) * 100}%` }}>
            <span className="absolute right-0 -translate-y-[130%] rounded-sm bg-canvas-elevated px-1 text-[11px] text-mute">Goal {goalLabel}</span>
          </div>
        )}
        {b && hover != null && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-hairline" style={{ left: `${left}%` }} />
            {hover !== live && pts[hover] && (
              <div className="pointer-events-none absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas-elevated bg-ink" style={{ left: `${left}%`, top: `${(1 - avg[hover] / top) * 100}%` }} />
            )}
            <div
              className="pointer-events-none absolute top-1.5 z-10 whitespace-nowrap rounded-[9px] border border-hairline bg-canvas-elevated px-3 py-2 text-body-sm shadow-floating"
              style={{ left: `${left}%`, transform: left > 62 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
            >
              <div className="mb-1.5 font-medium text-ink">{b.title}</div>
              <div className="flex justify-between gap-6"><span className="text-mute">{unit}</span><span className="font-medium text-ink">{b.seconds ? formatDuration(b.seconds) : 'No reading'}</span></div>
              <div className="mt-0.5 flex justify-between gap-6"><span className="text-mute">{avgLabel}</span><span className="font-medium text-ink">{formatDuration(avg[hover] * 60)}</span></div>
              <div className="mt-0.5 flex justify-between gap-6"><span className="text-mute">Highlights</span><span className="font-medium text-ink">{highlights[hover] ?? 0}</span></div>
            </div>
          </>
        )}
        <div className="absolute inset-0 flex">
          {buckets.map((x, i) => (
            <div key={x.key} className="h-full flex-1" onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(i)} onPointerDown={pick(i)} />
          ))}
        </div>
      </div>
      <div className="relative ml-10 mt-2 h-7">
        {marks.map((i) => (
          <span
            key={i}
            className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap text-[11.5px] text-mute transition-opacity"
            style={{ left: `${at(i)}%`, opacity: hover != null && Math.abs(at(i) - at(hover)) < (mobile ? 22 : 14) ? 0 : 1 }}
          >
            {buckets[i].label}
          </span>
        ))}
        {b && (
          <span
            className="absolute top-0 h-[26px] whitespace-nowrap rounded-full bg-ink px-3 text-[12px] font-medium leading-[26px] text-canvas"
            style={{ left: `${left}%`, transform: `translateX(${left > 94 ? '-88%' : left < 6 ? '-12%' : '-50%'})` }}
          >
            {b.label}
          </span>
        )}
      </div>
    </Card>
  )
}

// ── Insights in words ───────────────────────────────────────────────────

export interface Insight {
  a: string
  b: string
  c: string
}

export function InsightsCard({ items }: { items: Insight[] }) {
  const [i, setI] = useState(0)
  const it = items[i % Math.max(1, items.length)]
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-label-sm text-ink">
          <TrendingUp className="size-4 text-mute" /> Insights
        </span>
        {items.length > 1 && (
          <button onClick={() => setI((x) => x + 1)} className="inline-flex items-center gap-1.5 text-body-sm text-mute transition-colors hover:text-ink">
            <RotateCw className="size-3.5" /> Another
          </button>
        )}
      </div>
      <p className="mt-5 text-[22px] leading-[1.35] tracking-[-0.3px] text-mute sm:text-[24px]">
        {it ? (
          <>
            {it.a}
            <b className="font-medium text-ink">{it.b}</b>
            {it.c}
          </>
        ) : (
          'Read a little more and insights about your reading show up here.'
        )}
      </p>
      <div className="flex-1" />
      {items.length > 1 && (
        <div className="mt-5">
          <div className="flex gap-1.5" aria-hidden="true">
            {items.map((_, k) => (
              <i key={k} className={`h-[3px] w-4 rounded-full ${k === i % items.length ? 'bg-ink' : 'bg-hairline'}`} />
            ))}
          </div>
          <div className="mt-2 text-body-sm text-faint">
            {(i % items.length) + 1} of {items.length}
          </div>
        </div>
      )}
    </Card>
  )
}

// ── A year of days ──────────────────────────────────────────────────────

/** Brighter means closer to your goal (or past it). */
function shade(seconds: number, goal: number) {
  if (seconds <= 0) return 'bg-hairline'
  const f = goal ? seconds / goal : seconds / 3600
  return f >= 1 ? 'bg-ink' : f >= 0.66 ? 'bg-ink/65' : f >= 0.33 ? 'bg-ink/40' : 'bg-ink/20'
}

export function CommitGraph({ daily, goal, streak }: { daily: Daily; goal: number; streak: { current: number; longest: number } }) {
  const scroller = useRef<HTMLDivElement>(null)
  const today = startOfDay(Date.now())
  const monday = addDays(today, -((new Date(today).getDay() + 6) % 7))
  const first = addDays(monday, -52 * 7)
  const cells = useMemo(() => {
    const out: { col: number; row: number; day: number; secs: number }[] = []
    for (let d = first, i = 0; d <= today; d = addDays(d, 1), i++) out.push({ col: Math.floor(i / 7) + 2, row: (i % 7) + 2, day: d, secs: daily.get(dayKey(d))?.seconds ?? 0 })
    return out
  }, [daily, first, today])
  const year = cells.filter((c) => c.day > addDays(today, -365))
  const readDays = year.filter((c) => c.secs >= 60).length
  // On a narrow screen the graph scrolls sideways: start at the latest days, once it has its width.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let done = false
    const toEnd = () => {
      if (done || el.scrollWidth <= el.clientWidth) return
      el.scrollLeft = el.scrollWidth
      done = true
    }
    toEnd()
    const ro = new ResizeObserver(toEnd)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <Section title="Consistency" note={`${readDays} of 365 days read · longest streak ${streak.longest} · now ${streak.current}`}>
      <Card className="!pb-4">
        <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="grid min-w-[720px] gap-[3px]" style={{ gridTemplateColumns: '26px repeat(53, minmax(0, 1fr))', gridTemplateRows: '14px repeat(7, 12px)' }}>
            {['Mon', '', 'Wed', '', 'Fri', '', ''].map((t, r) => (
              <span key={r} className="text-[10px] leading-3 text-faint" style={{ gridColumn: 1, gridRow: r + 2 }}>{t}</span>
            ))}
            {cells
              .filter((c) => new Date(c.day).getDate() <= 7 && c.row === 2 && c.col <= 52)
              .map((c) => (
                <span key={`m${c.col}`} className="whitespace-nowrap text-[10px] leading-3 text-faint" style={{ gridColumn: `${c.col} / span 3`, gridRow: 1 }}>
                  {new Date(c.day).toLocaleDateString(undefined, { month: 'short' })}
                </span>
              ))}
            {cells.map((c) => (
              <i
                key={c.day}
                className={`ir-fade rounded-[2.5px] ${shade(c.secs, goal)}`}
                style={{ gridColumn: c.col, gridRow: c.row, '--i': c.col } as CSSProperties}
                title={`${new Date(c.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${c.secs >= 60 ? formatDuration(c.secs) : 'no reading'}`}
              />
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-body-sm text-mute">
          <span>Each square is a day; brighter means closer to your goal, or past it.</span>
          <span className="flex items-center gap-1">
            Less
            {['bg-hairline', 'bg-ink/20', 'bg-ink/40', 'bg-ink/65', 'bg-ink'].map((c) => (
              <i key={c} className={`size-[11px] rounded-[2.5px] ${c}`} />
            ))}
            More
          </span>
        </div>
      </Card>
    </Section>
  )
}

// ── Highlights & quotes ─────────────────────────────────────────────────

const COLOURS: { key: HighlightColor; name: string }[] = [
  { key: 'yellow', name: 'Yellow' },
  { key: 'green', name: 'Green' },
  { key: 'blue', name: 'Blue' },
  { key: 'pink', name: 'Pink' },
  { key: 'purple', name: 'Purple' },
]

/** The book's own colour when it has one, with a letter that reads on it; otherwise its paper. */
function tileColours(tint: string | undefined, paper: { bg: string; ink: string }) {
  if (!tint || !/^#[0-9a-f]{6}$/i.test(tint) || tint.toLowerCase() === '#e5e5e5') return { background: paper.bg, color: paper.ink }
  const n = parseInt(tint.slice(1), 16)
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return { background: tint, color: lum > 0.6 ? '#141414' : '#f2f2f2' }
}

function Kpi({ label, value, change, sub }: { label: string; value: string; change: ReactNode; sub: string }) {
  return (
    <Card>
      <div className="text-body-sm text-mute">{label}</div>
      <div className="mt-2 text-[26px] font-medium leading-tight tracking-[-0.6px] text-ink">{/^\d+$/.test(value) ? <CountUp value={Number(value)} /> : value}</div>
      <div className="mt-1.5 min-h-5">{change}</div>
      <div className="mt-1 text-body-sm text-faint">{sub}</div>
    </Card>
  )
}

function changeOf(now: number, before: number | null, what: string, before_: string): ReactNode {
  if (before == null) return null
  if (now > before) return <Up text={before > 0 ? `${Math.round(((now - before) / before) * 100)}% vs ${before_}` : `${now - before} more than ${before_}`} />
  if (now < before) return <span className="text-body-sm text-mute">{before - now} fewer {what} than {before_}</span>
  return <span className="text-body-sm text-mute">Same as {before_}</span>
}

export function HighlightsSection({ marks, books, shares, start, end, prev, buckets, rangeLabel, before }: {
  marks: Mark[]
  books: Book[]
  shares: ShareLog[]
  start: number
  end: number
  prev: { start: number; end: number } | null
  buckets: Bucket[]
  rangeLabel: string
  before: string
}) {
  const navigate = useNavigate()
  const [pick, setPick] = useState(0)
  const inR = (t: number, a: number, b: number) => t >= a && t < b
  const now = useMemo(() => marks.filter((m) => m.at >= start && m.at < end), [marks, start, end])
  const was = prev ? marks.filter((m) => inR(m.at, prev.start, prev.end)) : null
  const notes = now.filter((m) => m.note?.trim()).length
  const shared = useMemo(() => shares.filter((s) => s.at >= start && s.at < end), [shares, start, end])
  const sharedBefore = prev ? shares.filter((s) => inR(s.at, prev.start, prev.end)).length : null
  const byBook = new Map(books.map((b) => [b.id, b]))

  const most = useMemo(() => {
    const m = new Map<string, { title: string; kind: string; n: number; from: string }>()
    for (const x of now) {
      const e = m.get(x.from) ?? { title: x.title, kind: x.kind, n: 0, from: x.from }
      e.n++
      m.set(x.from, e)
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5)
  }, [now])
  const colours = COLOURS.map((c) => ({ ...c, n: now.filter((m) => (m.color ?? 'yellow') === c.key).length })).filter((c) => c.n > 0)
  const perBucket = buckets.map((b) => now.filter((m) => inR(m.at, b.start, b.end)).length)
  const peak = Math.max(0, ...perBucket)
  const peakAt = perBucket.indexOf(peak)

  // The quote: the one you shared most; otherwise a highlight from this period (ones with a note first).
  const top = useMemo(() => {
    const m = new Map<string, { text: string; title?: string; n: number; to: Set<string> }>()
    for (const s of shared) {
      const e = m.get(s.text) ?? { text: s.text, title: s.title, n: 0, to: new Set<string>() }
      e.n++
      e.to.add(s.to)
      m.set(s.text, e)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)[0] ?? null
  }, [shared])
  const pool = useMemo(() => [...now].sort((a, b) => Number(!!b.note?.trim()) - Number(!!a.note?.trim()) || b.at - a.at), [now])
  const quote = pool.length ? pool[pick % pool.length] : null

  const dot = (k: HighlightColor) => ({ background: `var(--wash-${k})` })
  return (
    <Section title="Highlights & quotes" note={rangeLabel}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Highlights" value={String(now.length)} change={changeOf(now.length, was?.length ?? null, 'highlights', before)} sub={most[0] ? `Most in ${most[0].title}` : 'Select text while you read to keep it'} />
        <Kpi label="Notes written" value={String(notes)} change={changeOf(notes, was ? was.filter((m) => m.note?.trim()).length : null, 'notes', before)} sub={now.length ? `${Math.round((notes / now.length) * 100)}% of your highlights have one` : 'A note sits on a highlight'} />
        <Kpi
          label="Quotes shared"
          value={String(shared.length)}
          change={changeOf(shared.length, sharedBefore, 'quotes', before)}
          sub={shared.length ? `${shared.filter((s) => s.to === 'x').length} on X · ${shared.filter((s) => s.to === 'substack').length} as Substack Notes` : 'Share from a highlight: X or a Substack Note'}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex items-baseline justify-between text-body-sm"><span className="text-mute">Most highlighted</span><span className="text-faint">highlights</span></div>
          {most.length ? (
            most.map((m) => {
              const b = m.kind === 'Book' ? byBook.get(m.from) : null
              const paper = b ? paperFor(b.title) : null
              return (
                <button
                  key={m.from}
                  onClick={() => b && navigate(`/book/${b.id}`)}
                  disabled={!b}
                  className="grid w-full grid-cols-[28px_minmax(0,1fr)_40px] items-center gap-3 py-2 text-left disabled:cursor-default"
                >
                  <span className="grid size-7 place-items-center rounded-[6px] text-[11px] font-semibold" style={b ? tileColours(b.tint, paper!) : undefined}>
                    {b ? m.title.slice(0, 1) : <span className="text-mute">W</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="flex justify-between gap-2 text-body-md"><span className="truncate text-ink">{m.title}</span><span className="shrink-0 text-body-sm text-faint">{m.kind}</span></span>
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-hairline"><i className="block h-full rounded-full bg-mute" style={{ width: `${(m.n / most[0].n) * 100}%` }} /></span>
                  </span>
                  <span className="text-right text-body-md tabular text-ink">{m.n}</span>
                </button>
              )
            })
          ) : (
            <p className="py-6 text-center text-body-md text-mute">No highlights {rangeLabel.toLowerCase()} yet.</p>
          )}
          {colours.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-body-sm"><span className="text-mute">By colour</span><span className="text-faint">{now.length} in all</span></div>
              <div className="mt-2.5 flex gap-[3px]">
                {colours.map((c, i) => <div key={c.key} className="ir-grow-x h-3.5 rounded-[4px]" style={{ ...dot(c.key), width: `${(c.n / now.length) * 100}%`, '--i': i } as CSSProperties} title={`${c.name}: ${c.n}`} />)}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-mute">
                {colours.map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-1.5 whitespace-nowrap"><i className="size-2 rounded-full" style={dot(c.key)} />{c.name} {c.n}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <div className="mb-3 flex items-baseline justify-between gap-3 text-body-sm">
              <span className="text-mute">Highlights {buckets[0] && buckets.length > 1 ? `a ${buckets[0].end - buckets[0].start > 8 * 86_400_000 ? 'month' : buckets[0].end - buckets[0].start > 2 * 86_400_000 ? 'week' : 'day'}` : ''}</span>
              {peak > 0 && <span className="truncate text-faint">most: {buckets[peakAt].title}, {peak}</span>}
            </div>
            <div className="flex h-16 items-end gap-[3px]" aria-hidden="true">
              {perBucket.map((v, i) => <i key={i} className={`ir-grow-y flex-1 rounded-t-[2px] ${v === peak && v > 0 ? 'bg-ink' : 'bg-hairline'}`} style={{ height: `${peak ? Math.max(4, (v / peak) * 100) : 4}%`, '--i': i } as CSSProperties} />)}
            </div>
            {buckets.length > 1 && (
              <div className="mt-2 flex justify-between text-[11px] text-faint"><span>{buckets[0].label}</span><span>{buckets[buckets.length - 1].label}</span></div>
            )}
          </Card>
          <Card className="flex-1">
            {top ? (
              <>
                <div className="flex items-baseline justify-between text-body-sm"><span className="text-mute">Your most shared quote</span><span className="text-faint">shared {pluralize(top.n, 'time')}</span></div>
                <p className="mt-3 line-clamp-5 font-serif text-[17px] leading-relaxed text-ink"><mark className="passage-hl" style={{ background: 'var(--wash-green)' }}>{top.text}</mark></p>
                <div className="mt-2.5 text-body-sm text-mute">{[top.title, [...top.to].map((t) => (t === 'x' ? 'on X' : 'as a Substack Note')).join(' and ')].filter(Boolean).join(' · ')}</div>
              </>
            ) : quote ? (
              <>
                <div className="flex items-baseline justify-between gap-3 text-body-sm">
                  <span className="text-mute">A highlight {rangeLabel.toLowerCase()}</span>
                  {pool.length > 1 && (
                    <button onClick={() => setPick((x) => x + 1)} className="inline-flex items-center gap-1.5 text-mute transition-colors hover:text-ink"><RotateCw className="size-3.5" /> Another</button>
                  )}
                </div>
                <p className="mt-3 line-clamp-5 font-serif text-[17px] leading-relaxed text-ink"><mark className="passage-hl" style={{ background: `var(--wash-${quote.color ?? 'yellow'})` }}>{quote.text}</mark></p>
                {quote.note?.trim() && <p className="mt-2 line-clamp-2 text-body-md text-body"><span className="text-mute">Your note · </span>{quote.note.trim()}</p>}
                <div className="mt-2.5 text-body-sm text-mute">{quote.title}{quote.page != null ? ` · page ${quote.page + 1}` : ''}</div>
              </>
            ) : (
              <p className="text-body-md text-mute">Quotes you share from a highlight (to X or as a Substack Note) are counted here.</p>
            )}
          </Card>
        </div>
      </div>
    </Section>
  )
}

// ── Your year, and the books ───────────────────────────────────────────

export function YearAndBooks({ daily, goal, books, sessions, highlightsByBook }: {
  daily: Daily
  goal: number
  books: Book[]
  sessions: Session[]
  highlightsByBook: Map<string, number>
}) {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [hover, setHover] = useState<number | null>(null)
  const today = startOfDay(Date.now())
  const N = 365
  const days = useMemo(() => Array.from({ length: N }, (_, i) => {
    const d = addDays(today, i - (N - 1))
    return { d, secs: daily.get(dayKey(d))?.seconds ?? 0 }
  }), [daily, today])
  const size = mobile ? 300 : 340
  const r = size / 2 - 20
  const total = days.reduce((a, x) => a + x.secs, 0)
  const read = days.filter((x) => x.secs >= 60).length
  const year = new Date().getFullYear()
  const finished = finishedBooks(books, year)
  const onTrack = onTrackFor(finished.length)
  const took = finished.map((b) => daysTaken(b, sessions)).filter((x): x is number => x != null)
  const reading = booksInProgress(books).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)).slice(0, 4)
  const h = hover != null ? days[hover] : null
  const months = days
    .map((x, i) => ({ ...x, i }))
    .filter((x) => new Date(x.d).getDate() === 1)
    .map((x) => {
      const a = ((-150 + (300 * x.i) / (N - 1)) * Math.PI) / 180
      return { key: x.d, t: new Date(x.d).toLocaleDateString(undefined, { month: 'short' }), x: size / 2 + (r + 14) * Math.sin(a), y: size / 2 - (r + 14) * Math.cos(a) }
    })
  return (
    <Section title="Your year & the books you read" note="last 12 months">
      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="flex flex-col items-center !px-3">
          <div className="relative" style={{ width: size, height: size }} onMouseLeave={() => setHover(null)}>
            {days.map((x, i) => {
              const f = goal ? Math.min(1, x.secs / goal) : Math.min(1, x.secs / 3600)
              return (
                <i
                  key={x.d}
                  onMouseEnter={() => setHover(i)}
                  className={`ir-fade absolute left-1/2 top-1/2 rounded-[1px] ${hover === i ? 'bg-link' : x.secs < 60 ? 'bg-hairline' : 'bg-ink'}`}
                  style={{
                    ['--i' as string]: Math.round(i / 3),
                    width: 1.8,
                    marginLeft: -0.9,
                    height: 7 + Math.min(80, x.secs / 60) * 0.3,
                    opacity: hover === i || x.secs < 60 ? 1 : 0.35 + f * 0.65,
                    transformOrigin: '50% 0',
                    transform: `rotate(${-150 + (300 * i) / (N - 1)}deg) translateY(-${r}px)`,
                  }}
                />
              )
            })}
            {months.map((m) => (
              <span key={m.key} className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] text-faint" style={{ left: m.x, top: m.y }}>{m.t}</span>
            ))}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-body-sm text-mute">{h ? new Date(h.d).toLocaleDateString(undefined, { weekday: 'long' }) : 'Last 12 months'}</span>
              <span className="mt-1 text-[36px] font-medium leading-tight tracking-[-1.2px] text-ink">{h ? (h.secs >= 60 ? formatDuration(h.secs) : '—') : `${Math.round(total / 3600)} h`}</span>
              <span className="mt-1 text-body-sm text-mute">{h ? new Date(h.d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : `${read} days read`}</span>
            </div>
          </div>
          <div className="text-body-sm text-mute">Each tick is a day. Point at one to see it.</div>
        </Card>
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
            <span className="text-mute">Books finished this year</span>
            <span className="text-faint">
              {finished.length}
              {onTrack && onTrack > finished.length ? `, on track for ${onTrack}` : ''}
              {took.length ? ` · ${Math.round(took.reduce((a, b) => a + b, 0) / took.length)} days each on average` : ''}
            </span>
          </div>
          {finished.length ? (
            <div className="mt-4 grid grid-cols-3 gap-3.5 sm:grid-cols-5">
              {finished.slice(0, 10).map((b) => {
                const t = daysTaken(b, sessions)
                return (
                  <button key={b.id} onClick={() => navigate(`/book/${b.id}`)} className="min-w-0 text-left">
                    <div className="rounded-[3px] shadow-cover"><BookCover book={b} rounded="rounded-[3px]" /></div>
                    <div className="mt-2 text-body-sm text-ink">{new Date(b.finishedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                    {t != null && <div className="text-[11px] text-mute">took {pluralize(t, 'day')}</div>}
                    {(highlightsByBook.get(b.id) ?? 0) > 0 && <div className="text-[11px] text-faint">{pluralize(highlightsByBook.get(b.id)!, 'highlight')}</div>}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="py-6 text-body-md text-mute">No book finished yet this year: the first one shows up here.</p>
          )}
          {reading.length > 0 && (
            <>
              <div className="mb-1 mt-6 text-body-sm text-mute">Reading now</div>
              {reading.map((b) => {
                const g = finishGuess(b, sessions)
                const p = bookProgress(b)
                const lit = Math.round(p * 40)
                return (
                  <button key={b.id} onClick={() => navigate(`/read/${b.id}`)} className="flex w-full items-center gap-3 border-t border-hairline py-2.5 text-left">
                    <div className="w-[26px] shrink-0 rounded-[2px] shadow-cover"><BookCover book={b} rounded="rounded-[2px]" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-body-md">
                        <span className="truncate font-medium text-ink">{b.title}</span>
                        <span className="shrink-0 text-body-sm text-mute">{g.date != null ? (g.days === 0 ? 'ends today' : `ends ${new Date(g.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`) : ''}</span>
                      </div>
                      <div className="mt-1.5 flex gap-[2px]" aria-hidden="true">
                        {Array.from({ length: 40 }, (_, i) => <i key={i} className={`h-2.5 flex-1 rounded-[1px] ${i < lit ? 'ir-lit bg-ink' : 'bg-hairline'}`} style={{ '--i': i } as CSSProperties} />)}
                      </div>
                    </div>
                    <span className="w-10 shrink-0 text-right text-body-sm text-mute">{Math.round(p * 100)}%</span>
                  </button>
                )
              })}
            </>
          )}
        </Card>
      </div>
    </Section>
  )
}
