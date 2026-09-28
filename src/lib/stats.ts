import type { Book, Session } from '../db/db'
import { readCount } from './pages'

export type RangeKey = '7d' | '30d' | '90d' | '1y' | 'all'

export const RANGES: { key: RangeKey; label: string; long: string }[] = [
  { key: '7d', label: '7D', long: 'Last 7 days' },
  { key: '30d', label: '30D', long: 'Last 30 days' },
  { key: '90d', label: '90D', long: 'Last 90 days' },
  { key: '1y', label: '1Y', long: 'Last 12 months' },
  { key: 'all', label: 'All', long: 'All time' },
]

const DAY = 86_400_000

export function startOfDay(ts: number) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function addDays(ts: number, n: number) {
  const d = new Date(ts)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

export function dayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface DayTotal {
  seconds: number
  pages: number
  sessions: number
}

/** Seconds, distinct pages and session count per local day. */
export function dailyTotals(sessions: Session[]) {
  const map = new Map<string, DayTotal>()
  const pageSets = new Map<string, Set<string>>()
  for (const s of sessions) {
    const k = dayKey(s.start)
    const t = map.get(k) ?? { seconds: 0, pages: 0, sessions: 0 }
    t.seconds += s.seconds
    t.sessions += 1
    let set = pageSets.get(k)
    if (!set) pageSets.set(k, (set = new Set()))
    for (const p of s.pages) set.add(`${s.bookId}:${p}`)
    t.pages = set.size
    map.set(k, t)
  }
  return map
}

/** A day "counts" toward a streak once you've read at least a minute. */
const STREAK_MIN_SECONDS = 60

export function streaks(daily: Map<string, DayTotal>, now = Date.now()) {
  const read = (ts: number) => (daily.get(dayKey(ts))?.seconds ?? 0) >= STREAK_MIN_SECONDS
  // Today not read yet doesn't break a streak — it's still "alive" until midnight.
  let cursor = read(now) ? startOfDay(now) : addDays(startOfDay(now), -1)
  let current = 0
  while (read(cursor)) {
    current++
    cursor = addDays(cursor, -1)
  }

  const days = [...daily.entries()]
    .filter(([, t]) => t.seconds >= STREAK_MIN_SECONDS)
    .map(([k]) => new Date(`${k}T00:00:00`).getTime())
    .sort((a, b) => a - b)
  let longest = 0
  let run = 0
  let prev = -Infinity
  for (const d of days) {
    run = Math.round((d - prev) / DAY) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  return { current, longest: Math.max(longest, current), readToday: read(now) }
}

export function rangeStart(range: RangeKey, sessions: Session[], now = Date.now()) {
  const today = startOfDay(now)
  switch (range) {
    case '7d': return addDays(today, -6)
    case '30d': return addDays(today, -29)
    case '90d': return addDays(today, -89)
    case '1y': {
      const d = new Date(today)
      d.setMonth(d.getMonth() - 11, 1)
      return d.getTime()
    }
    case 'all': {
      const first = sessions.reduce((m, s) => Math.min(m, s.start), Infinity)
      if (!Number.isFinite(first)) return addDays(today, -29)
      const d = new Date(startOfDay(first))
      d.setDate(1)
      return Math.min(d.getTime(), addDays(today, -29))
    }
  }
}

export interface Bucket {
  key: string
  label: string
  /** Longer label for tooltips/table. */
  title: string
  start: number
  end: number
  seconds: number
  pages: number
  isCurrent: boolean
}

type Grain = 'day' | 'week' | 'month'

export function grainFor(range: RangeKey, start: number, now = Date.now()): Grain {
  if (range === '7d' || range === '30d') return 'day'
  if (range === '90d') return 'week'
  if (range === 'all' && now - start < 120 * DAY) return now - start < 45 * DAY ? 'day' : 'week'
  return 'month'
}

export function buckets(range: RangeKey, sessions: Session[], now = Date.now()): { grain: Grain; buckets: Bucket[] } {
  const start = rangeStart(range, sessions, now)
  const grain = grainFor(range, start, now)
  const daily = dailyTotals(sessions)
  const out: Bucket[] = []
  const end = addDays(startOfDay(now), 1)

  let cursor = start
  if (grain === 'week') {
    // Align to Monday so weeks read naturally.
    const d = new Date(cursor)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    cursor = d.getTime()
  }
  while (cursor < end) {
    let next: number
    let label: string
    let title: string
    const d = new Date(cursor)
    if (grain === 'day') {
      next = addDays(cursor, 1)
      label = range === '7d' ? d.toLocaleDateString(undefined, { weekday: 'short' }) : String(d.getDate())
      title = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    } else if (grain === 'week') {
      next = addDays(cursor, 7)
      label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      title = `Week of ${label}`
    } else {
      const n = new Date(cursor)
      n.setMonth(n.getMonth() + 1, 1)
      next = n.getTime()
      label = d.toLocaleDateString(undefined, { month: 'short' })
      title = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    }
    let seconds = 0
    let pages = 0
    for (let t = Math.max(cursor, start); t < next && t < end; t = addDays(t, 1)) {
      const tot = daily.get(dayKey(t))
      if (tot) {
        seconds += tot.seconds
        pages += tot.pages
      }
    }
    out.push({
      key: dayKey(cursor),
      label,
      title,
      start: cursor,
      end: next,
      seconds,
      pages,
      isCurrent: now >= cursor && now < next,
    })
    cursor = next
  }
  return { grain, buckets: out }
}

export interface Summary {
  seconds: number
  pages: number
  sessions: number
  activeDays: number
  days: number
  avgSecondsPerDay: number
  pagesPerHour: number
  longestSession: number
  booksTouched: number
}

export function summarize(sessions: Session[], start: number, end: number): Summary {
  const inRange = sessions.filter((s) => s.start >= start && s.start < end)
  const daily = dailyTotals(inRange)
  const seconds = inRange.reduce((a, s) => a + s.seconds, 0)
  const pages = [...daily.values()].reduce((a, d) => a + d.pages, 0)
  const days = Math.max(1, Math.round((Math.min(end, addDays(startOfDay(Date.now()), 1)) - start) / DAY))
  return {
    seconds,
    pages,
    sessions: inRange.length,
    activeDays: [...daily.values()].filter((d) => d.seconds >= STREAK_MIN_SECONDS).length,
    days,
    avgSecondsPerDay: seconds / days,
    pagesPerHour: seconds > 120 ? pages / (seconds / 3600) : 0,
    longestSession: inRange.reduce((m, s) => Math.max(m, s.seconds), 0),
    booksTouched: new Set(inRange.map((s) => s.bookId)).size,
  }
}

/** The same-length window immediately before [start, end). */
export function previousWindow(range: RangeKey, start: number, end: number) {
  if (range === 'all') return null
  if (range === '1y') {
    const s = new Date(start)
    s.setFullYear(s.getFullYear() - 1)
    return { start: s.getTime(), end: start }
  }
  const len = end - start
  return { start: start - len, end: start }
}

/** Reading seconds by hour of day, splitting sessions that cross an hour. */
export function hourOfDay(sessions: Session[]) {
  const hours = new Array(24).fill(0) as number[]
  for (const s of sessions) {
    const wall = Math.max(1, s.end - s.start)
    const ratio = s.seconds / (wall / 1000)
    let t = s.start
    while (t < s.end) {
      const d = new Date(t)
      const hourEnd = new Date(d)
      hourEnd.setMinutes(60, 0, 0)
      const chunkEnd = Math.min(s.end, hourEnd.getTime())
      hours[d.getHours()] += ((chunkEnd - t) / 1000) * ratio
      t = chunkEnd
    }
    if (s.end <= s.start) hours[new Date(s.start).getHours()] += s.seconds
  }
  return hours
}

export interface HeatCell {
  key: string
  ts: number
  seconds: number
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
}

/** A GitHub-style year grid: columns are weeks (Mon→Sun), newest on the right. */
export function heatmap(sessions: Session[], weeks: number, goalSeconds: number, now = Date.now()) {
  const daily = dailyTotals(sessions)
  const today = startOfDay(now)
  const mondayThisWeek = addDays(today, -((new Date(today).getDay() + 6) % 7))
  const first = addDays(mondayThisWeek, -(weeks - 1) * 7)
  const goal = Math.max(60, goalSeconds)
  const cols: HeatCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const ts = addDays(first, w * 7 + d)
      const seconds = daily.get(dayKey(ts))?.seconds ?? 0
      // Levels are anchored to the daily goal so colour means something:
      // 1 = a start, 2 = half-way, 3 = goal met, 4 = double goal.
      const level: HeatCell['level'] =
        seconds < 60 ? 0 : seconds < goal * 0.5 ? 1 : seconds < goal ? 2 : seconds < goal * 2 ? 3 : 4
      col.push({ key: dayKey(ts), ts, seconds, level, future: ts > today })
    }
    cols.push(col)
  }
  return cols
}

export interface BookStats {
  seconds: number
  pages: number
  sessions: number
  pagesPerHour: number
  /** Estimated seconds to finish at your pace in this book (or overall pace). */
  remainingSeconds: number | null
  lastRead?: number
}

export function bookStats(book: Book, sessions: Session[], fallbackPagesPerHour = 0): BookStats {
  const own = sessions.filter((s) => s.bookId === book.id)
  const seconds = own.reduce((a, s) => a + s.seconds, 0)
  const pages = new Set(own.flatMap((s) => s.pages)).size
  // Pace is throughput (pages turned per hour), not unique pages — otherwise
  // re-reading a chapter would make you look slower than you are.
  const turned = own.reduce((a, s) => a + s.pages.length, 0)
  const pph = seconds > 300 && turned > 2 ? turned / (seconds / 3600) : fallbackPagesPerHour
  const remainingPages = Math.max(0, book.pageCount - readCount(book))
  return {
    seconds,
    pages,
    sessions: own.length,
    pagesPerHour: pph,
    remainingSeconds: book.status === 'finished' ? 0 : pph > 0 ? (remainingPages / pph) * 3600 : null,
    lastRead: own.reduce<number | undefined>((m, s) => (m === undefined || s.end > m ? s.end : m), undefined),
  }
}

export function todaySeconds(sessions: Session[], now = Date.now()) {
  const start = startOfDay(now)
  return sessions.filter((s) => s.start >= start).reduce((a, s) => a + s.seconds, 0)
}
