import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Session, type WebRead } from '../db/db'
import { startOfDay } from './stats'

/** Substack reading (from the Chrome extension), newest first. */
export function useWebReads() {
  return useLiveQuery(() => db.webReads.orderBy('start').reverse().toArray(), [])
}

/** Seconds read between `from` and `to`. */
export function webSeconds(reads: WebRead[], from: number, to = Infinity) {
  return reads.reduce((a, r) => (r.start >= from && r.start < to ? a + r.seconds : a), 0)
}

export const webToday = (reads: WebRead[]) => webSeconds(reads, startOfDay(Date.now()))

// ── Substack in the reading stats ─────────────────────────────────────────

const WEB = 'web:'
/** Substack reads as reading sessions, so the same stats (streak, charts, calendar) count them. */
export function webSessions(reads: WebRead[]): Session[] {
  return reads.map((r) => ({
    id: `${WEB}${r.id}`,
    bookId: `substack:${publicationOf(r)}`,
    start: r.start,
    end: Math.max(r.end, r.start),
    seconds: r.seconds,
    pages: [],
  }))
}
export const isWebSession = (s: Session) => s.id.startsWith(WEB)

/** Books and Substack together — everything you read. */
export function useAllReading() {
  return useLiveQuery(async () => {
    const [books, reads] = await Promise.all([db.sessions.toArray(), db.webReads.toArray()])
    return { books, reads, web: webSessions(reads), all: [...books, ...webSessions(reads)] }
  }, [])
}

// ── Articles and newsletters ──────────────────────────────────────────────

export const publicationOf = (r: Pick<WebRead, 'publication' | 'url'>) => {
  if (r.publication?.trim()) return r.publication.trim()
  try {
    return new URL(r.url).hostname.replace(/^www\./, '').replace(/\.substack\.com$/, '')
  } catch {
    return 'Substack'
  }
}

/** One article, however many days you read it on. */
export interface Article {
  url: string
  title: string
  publication: string
  author?: string
  seconds: number
  first: number
  last: number
  /** Days you came back to it. */
  days: number
}

export function articlesOf(reads: WebRead[]): Article[] {
  const by = new Map<string, WebRead[]>()
  for (const r of reads) by.set(r.url, [...(by.get(r.url) ?? []), r])
  return [...by.entries()]
    .map(([url, rs]) => {
      const latest = rs.reduce((a, b) => (b.end > a.end ? b : a))
      return {
        url,
        title: latest.title?.trim() || url,
        publication: publicationOf(latest),
        author: rs.find((r) => r.author)?.author,
        seconds: rs.reduce((a, r) => a + r.seconds, 0),
        first: Math.min(...rs.map((r) => r.start)),
        last: Math.max(...rs.map((r) => r.end)),
        days: new Set(rs.map((r) => startOfDay(r.start))).size,
      }
    })
    .sort((a, b) => b.last - a.last)
}

export interface Newsletter {
  name: string
  seconds: number
  articles: number
  last: number
}

export function newslettersOf(articles: Article[]): Newsletter[] {
  const by = new Map<string, Newsletter>()
  for (const a of articles) {
    const n = by.get(a.publication) ?? { name: a.publication, seconds: 0, articles: 0, last: 0 }
    n.seconds += a.seconds
    n.articles += 1
    n.last = Math.max(n.last, a.last)
    by.set(a.publication, n)
  }
  return [...by.values()].sort((a, b) => b.last - a.last)
}

/** A newsletter's "cover": its initials on a colour of its own, the same every time. */
export function monogram(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const hue = h % 360
  return { letters, bg: `hsl(${hue} 42% 90%)`, ink: `hsl(${hue} 45% 28%)`, bgDark: `hsl(${hue} 30% 22%)`, inkDark: `hsl(${hue} 55% 80%)` }
}
