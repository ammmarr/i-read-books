import { db, type Book, type Highlight, type Session } from '../db/db'
import { buildPageIndex, normalizeQuery } from '../reader/textIndex'
import { openEpub } from './epub'
import { readCount } from './pages'
import { closePdf, openPdfBlob } from './pdf'
import { addDays, dailyTotals, finishGuesses, finishedBooks, onTrackFor, startOfDay, streaks, todaySeconds, type FinishGuess } from './stats'

/**
 * The welcome screen (components/WelcomeBack.tsx): one of your highlights
 * inside its page, and a line about how your reading is going.
 */

// ── The passage around a highlight ───────────────────────────────────────

export interface Passage {
  /** The sentences just before it, as the book has them (may be empty). */
  before: string
  text: string
  /** …and just after. */
  after: string
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Where one sentence ends and the next starts: ". ", "?” ", "…) ". */
const SENTENCE_END = /[.!?…]["'”’»)\]]*\s+/g

/**
 * The last whole sentences of `s`, at most about `max` characters. `s` ends
 * where the highlight starts — so a sentence the highlight is in the middle of
 * is kept whole. Longer than `max` with no sentence break: cut at a word, with "…".
 */
export function tailSentences(raw: string, max = 320) {
  const s = raw.replace(/\s+/g, ' ')
  if (!s.trim()) return ''
  const win = s.length <= max ? s : s.slice(-max)
  const starts: number[] = s.length <= max ? [0] : []
  const re = new RegExp(SENTENCE_END.source, 'g')
  for (let m = re.exec(win); m; m = re.exec(win)) starts.push(m.index + m[0].length)
  const end = win.trimEnd().length
  const first = starts.filter((i) => i < end).sort((a, b) => a - b)[0]
  if (first != null) return win.slice(first).trim()
  const space = win.indexOf(' ')
  return `…${win.slice(space < 0 ? 0 : space + 1).trim()}`
}

/** The first whole sentences of `s` (which starts where the highlight ends), at most about `max` characters. */
export function headSentences(raw: string, max = 260) {
  const s = raw.replace(/\s+/g, ' ')
  if (!s.trim()) return ''
  if (s.trim().length <= max) return s.trim()
  const win = s.slice(0, max)
  const re = new RegExp(SENTENCE_END.source, 'g')
  let last = -1
  for (let m = re.exec(s); m && m.index < max; m = re.exec(s)) last = m.index + m[0].trimEnd().length
  if (last > 0) return s.slice(0, last).trim()
  const space = win.lastIndexOf(' ')
  return `${win.slice(0, space > 0 ? space : max).trim()}…`
}

const BLOCK = /^(p|div|li|blockquote|h[1-6]|section|article|td|dd|dt|figcaption|pre|body)$/i

async function epubPassage(book: Book, h: Highlight, blob: Blob): Promise<Passage | null> {
  if (!h.cfi) return null
  const CFI = await import('foliate-js/epubcfi.js')
  const ebook = await openEpub(blob, book.fileName)
  try {
    const parts = CFI.parse(h.cfi)
    const head = Array.isArray(parts) ? parts : parts.parent
    const index = CFI.fake.toIndex(head.shift())
    const doc = await ebook.sections[index]?.createDocument?.()
    if (!doc) return null
    const range = CFI.toRange(doc, parts)
    // The highlight's own paragraph gives the sentences around it.
    const blockOf = (n: Node) => {
      let el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement
      while (el && !BLOCK.test(el.localName)) el = el.parentElement
      return el ?? doc.documentElement
    }
    const pre = doc.createRange()
    pre.selectNodeContents(blockOf(range.startContainer))
    pre.setEnd(range.startContainer, range.startOffset)
    const post = doc.createRange()
    post.selectNodeContents(blockOf(range.endContainer))
    post.setStart(range.endContainer, range.endOffset)
    return { before: tailSentences(pre.toString()), text: clean(h.text), after: headSentences(post.toString()) }
  } finally {
    ebook.destroy?.()
  }
}

async function pdfPassage(h: Highlight, blob: Blob): Promise<Passage | null> {
  const doc = await openPdfBlob(blob)
  try {
    if (h.page + 1 > doc.numPages) return null
    const index = buildPageIndex(await (await doc.getPage(h.page + 1)).getTextContent())
    const q = normalizeQuery(h.text)
    if (!q) return null
    let start = index.norm.indexOf(q)
    let end = start < 0 ? -1 : start + q.length
    if (start < 0) {
      // Line-break hyphens and the like can differ: find its first and last words instead.
      const first = q.slice(0, 40)
      const last = q.slice(-30)
      start = index.norm.indexOf(first)
      if (start < 0) return null
      const t = index.norm.indexOf(last, start)
      // Not on this page: it carries on over the next one.
      end = t >= 0 && t - start < q.length + 80 ? t + last.length : -1
    }
    const text = (a: number, b: number) => index.disp.slice(a, b).join('')
    return {
      before: tailSentences(text(0, start)),
      text: clean(h.text),
      after: end >= 0 ? headSentences(text(end, index.norm.length)) : '',
    }
  } finally {
    closePdf(doc)
  }
}

// Found passages are kept (this device only), so a highlight opens instantly next time.
const CONTEXT_KEY = 'irb-passages'
const CONTEXT_MAX = 80
type CachedPassage = { id: string; k: string; b: string; a: string }
const versionOf = (h: Highlight) => `${h.text.length}:${h.text.slice(0, 24)}`

function readCache(): CachedPassage[] {
  try {
    return JSON.parse(localStorage.getItem(CONTEXT_KEY) || '[]') as CachedPassage[]
  } catch {
    return []
  }
}
function writeCache(entry: CachedPassage) {
  try {
    const rest = readCache().filter((e) => e.id !== entry.id)
    localStorage.setItem(CONTEXT_KEY, JSON.stringify([entry, ...rest].slice(0, CONTEXT_MAX)))
  } catch {
    /* full or private: it's only a cache */
  }
}

/**
 * The highlight with the sentences around it, read from the book on this
 * device. A book whose file isn't here (or that can't be read) gives just the
 * highlight — nothing is downloaded for this.
 */
export async function passageFor(h: Highlight, book: Book, { timeout = 1500 } = {}): Promise<Passage> {
  const bare: Passage = { before: '', text: clean(h.text), after: '' }
  const hit = readCache().find((e) => e.id === h.id && e.k === versionOf(h))
  if (hit) return { before: hit.b, text: bare.text, after: hit.a }
  const work = (async () => {
    const blob = (await db.files.get(book.id))?.blob
    if (!blob) return null
    const p = await (h.cfi ? epubPassage(book, h, blob) : pdfPassage(h, blob)).catch(() => null)
    writeCache({ id: h.id, k: versionOf(h), b: p?.before ?? '', a: p?.after ?? '' })
    return p
  })()
  const late = new Promise<null>((r) => setTimeout(() => r(null), timeout))
  return (await Promise.race([work, late])) ?? bare
}

// ── Which highlight ──────────────────────────────────────────────────────

const RECENT_KEY = 'irb-welcome-recent'
function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]
  } catch {
    return []
  }
}
export function markShown(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 40)))
  } catch {
    /* ignore */
  }
}

/**
 * A highlight to show: one not seen lately, from a book that's on this device
 * when there is one (so it can be shown in its page), never `exclude`.
 */
export async function pickHighlight(exclude?: string): Promise<{ highlight: Highlight; book: Book; others: string[] } | null> {
  const [highlights, books, fileIds] = await Promise.all([db.highlights.toArray(), db.books.toArray(), db.files.toCollection().primaryKeys()])
  const byId = new Map(books.map((b) => [b.id, b]))
  const local = new Set(fileIds.map(String))
  const ok = highlights.filter((h) => byId.has(h.bookId) && h.id !== exclude && clean(h.text ?? '').length >= 12 && h.text.length <= 600)
  if (!ok.length) return null
  // Prefer ones on this device; among those, ones not shown lately — or, when
  // every one has been, the third shown longest ago.
  const here = ok.filter((h) => local.has(h.bookId))
  const pool = here.length ? here : ok
  const recent = readRecent()
  const fresh = pool.filter((h) => !recent.includes(h.id))
  const from = fresh.length
    ? fresh
    : [...pool].sort((a, b) => recent.indexOf(b.id) - recent.indexOf(a.id)).slice(0, Math.max(1, Math.ceil(pool.length / 3)))
  const highlight = from[Math.floor(Math.random() * from.length)]
  // A few of your other highlights: the chosen one's words roll in through theirs.
  const others: string[] = []
  for (let i = 0; i < 60 && others.length < 24 && ok.length > 1; i++) {
    const h = ok[Math.floor(Math.random() * ok.length)]
    if (h.id !== highlight.id) others.push(h.text)
  }
  return { highlight, book: byId.get(highlight.bookId)!, others }
}

// ── How your reading is going ────────────────────────────────────────────

export type LineKind = 'finished' | 'month' | 'streak' | 'finishing' | 'allTime' | 'year'
export interface Line {
  kind: LineKind
  head: string
  /** `head` in pieces: the numbers roll up to their value on the welcome screen, the text doesn't. */
  parts: Part[]
  sub: string
  /** For 'finished': the book, so it's celebrated once. */
  bookId?: string
}

/** `spoken` in pieces, numbers apart: [1, " hour ", 20, " minutes"]. */
function spokenParts(seconds: number): Part[] {
  const m = Math.max(0, Math.round(seconds / 60))
  if (m < 60) return [m, ` ${m === 1 ? 'minute' : 'minutes'}`]
  const h = Math.floor(m / 60)
  const r = m % 60
  const hours: Part[] = [h, ` ${h === 1 ? 'hour' : 'hours'}`]
  return r && h < 10 ? [...hours, ' ', r, ` ${r === 1 ? 'minute' : 'minutes'}`] : hours
}

/** "45 minutes", "1 hour 20 minutes", "11 hours" — for sentences. */
export function spoken(seconds: number) {
  return spokenParts(seconds).join('')
}

const longDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
const books = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`
const bookParts = (n: number): Part[] => [n, ` ${n === 1 ? 'book' : 'books'}`]
const line = (kind: LineKind, parts: Part[], sub: string, bookId?: string): Line => ({ kind, head: parts.join(''), parts, sub, ...(bookId ? { bookId } : {}) })

export interface Progress {
  streak: number
  bestStreak: number
  todaySeconds: number
  goalSeconds: number
  finishedThisYear: number
  onTrack: number | null
  /** The book you'd continue (most recently opened, not finished). */
  current: Book | null
  /** When you'd finish `current`, if it can be told. */
  currentFinish: FinishGuess | null
  /** Every line that's true today: the finished-book news first, then the rotation, in order. */
  lines: Line[]
}

/** The order lines take turns in. */
const ROTATION: LineKind[] = ['month', 'streak', 'finishing', 'allTime', 'year']

export function readingProgress({ all, bookSessions, allBooks, goalMinutes, now = Date.now() }: {
  /** Every session, books and Substack. */
  all: Session[]
  /** Book sessions only (for paces in books). */
  bookSessions: Session[]
  allBooks: Book[]
  goalMinutes: number
  now?: number
}): Progress {
  const st = streaks(dailyTotals(all), now)
  const today = todaySeconds(all, now)
  const goal = goalMinutes * 60
  const year = new Date(now).getFullYear()
  const finished = finishedBooks(allBooks, year)
  const onTrack = onTrackFor(finished.length, now)
  const guesses = finishGuesses(allBooks, bookSessions, now)
  const current = allBooks
    .filter((b) => b.lastOpenedAt && b.status !== 'finished' && b.pageCount > 0)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0] ?? null
  const currentFinish = current ? (guesses.find((g) => g.book.id === current.id && g.date != null && (g.days ?? 0) > 0) ?? null) : null

  const todayLine =
    goal > 0 && today >= goal
      ? 'Today’s goal is done.'
      : today >= 60
        ? goal > 0
          ? `${spoken(today)} today already; ${spoken(Math.max(60, goal - today))} more and today’s goal is done.`
          : `${spoken(today)} today already.`
        : 'Read a little today to keep it going.'

  const lines: Line[] = []

  // A book you just finished (in the last two days).
  const justDone = finished.find((b) => now - b.finishedAt! < 2 * 86_400_000)
  if (justDone) {
    const when = startOfDay(justDone.finishedAt!) === startOfDay(now) ? 'today' : 'yesterday'
    lines.push(
      line(
        'finished',
        ['You finished ', justDone.title, ` ${when}.`],
        `That’s ${books(finished.length)} this year${onTrack && onTrack > finished.length ? `, on track for ${onTrack}` : ''}.`,
        justDone.id,
      ),
    )
  }

  // This month, and how it compares with last month at the same point.
  const d = new Date(now)
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const sumBetween = (a: number, b: number) => all.reduce((t, s) => (s.start >= a && s.start < b ? t + s.seconds : t), 0)
  const month = sumBetween(monthStart, Infinity)
  if (month >= 15 * 60) {
    const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime()
    const prevSamePoint = Math.min(monthStart, addDays(prevStart, d.getDate()))
    const ahead = month - sumBetween(prevStart, prevSamePoint)
    const prevName = new Date(prevStart).toLocaleDateString(undefined, { month: 'long' })
    lines.push(
      line(
        'month',
        ['You’ve read ', ...spokenParts(month), ' this month.'],
        // Only ever said when you're ahead: it's there to cheer, not to scold.
        `About ${spoken(month / d.getDate())} a day${sumBetween(prevStart, prevSamePoint) > 0 && ahead >= 10 * 60 ? `, ${spoken(ahead)} ahead of where ${prevName} was by now` : ''}.`,
      ),
    )
  }

  if (st.current >= 2) {
    const best: Part[] = st.longest > st.current ? [' Your best is ', st.longest, '.'] : st.current >= 3 ? [' Your longest yet.'] : []
    lines.push(line('streak', [st.current, ' days in a row now.', ...best], todayLine))
  }

  const next = guesses.find((g) => g.date != null && (g.days ?? 0) > 0)
  if (next) {
    const left = Math.max(0, next.book.pageCount - readCount(next.book))
    lines.push(
      line(
        'finishing',
        ['At your pace, you’ll finish ', next.book.title, ` on ${longDate(next.date!)}.`],
        `${Math.round(next.progress * 100)}% read, ${left} ${left === 1 ? 'page' : 'pages'} to go.`,
      ),
    )
  }

  const total = all.reduce((t, s) => t + s.seconds, 0)
  const first = all.reduce((m, s) => Math.min(m, s.start), Infinity)
  if (total >= 3600 && Number.isFinite(first)) {
    const everFinished = finishedBooks(allBooks).length
    const pages = new Set(bookSessions.flatMap((s) => s.pages.map((p) => `${s.bookId}:${p}`))).size
    lines.push(
      line(
        'allTime',
        [...spokenParts(total), ` of reading since you started in ${new Date(first).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.`],
        everFinished
          ? `${books(everFinished)} finished along the way, and ${pages.toLocaleString()} pages read.`
          : `${pages.toLocaleString()} pages read along the way.`,
      ),
    )
  }

  if (finished.length >= 1) {
    lines.push(
      line(
        'year',
        [...bookParts(finished.length), ' finished this year.'],
        onTrack && onTrack > finished.length ? `At this pace, ${onTrack} by the end of December.` : 'Every one of them counted here.',
      ),
    )
  }

  return {
    streak: st.current,
    bestStreak: st.longest,
    todaySeconds: today,
    goalSeconds: goal,
    finishedThisYear: finished.length,
    onTrack,
    current,
    currentFinish,
    lines,
  }
}

// Lines take turns, so you don't see the same one twice in a row.
const LINE_KEY = 'irb-welcome-line'
const CELEBRATED_KEY = 'irb-welcome-celebrated'

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * The line to show: a book you just finished, the first time; otherwise the
 * next one in the rotation after `after` (default: the last one shown).
 */
export function chooseLine(lines: Line[], after?: LineKind): Line | null {
  if (!after) {
    const celebrated = readJson<string[]>(CELEBRATED_KEY, [])
    const news = lines.find((l) => l.kind === 'finished' && l.bookId && !celebrated.includes(l.bookId))
    if (news) return news
  }
  const turns = lines.filter((l) => l.kind !== 'finished')
  if (!turns.length) return lines[0] ?? null
  const last = after ?? readJson<LineKind | null>(LINE_KEY, null)
  const from = last ? ROTATION.indexOf(last) : -1
  for (let i = 1; i <= ROTATION.length; i++) {
    const kind = ROTATION[(from + i + ROTATION.length) % ROTATION.length]
    const line = turns.find((l) => l.kind === kind)
    if (line) return line
  }
  return turns[0]
}

export function lineShown(line: Line) {
  try {
    if (line.kind === 'finished' && line.bookId) {
      localStorage.setItem(CELEBRATED_KEY, JSON.stringify([line.bookId, ...readJson<string[]>(CELEBRATED_KEY, [])].slice(0, 50)))
    } else {
      localStorage.setItem(LINE_KEY, JSON.stringify(line.kind))
    }
  } catch {
    /* ignore */
  }
}

/** "Sunday evening". */
export function partOfDay(now = Date.now()) {
  const d = new Date(now)
  const h = d.getHours()
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night'
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${part}`
}

// ── The welcome screen's motion ──────────────────────────────────────────

/** A line's head in pieces: on the welcome screen the numbers roll up to their value, the words don't. */
export type Part = string | number

export interface RollWord {
  word: string
  /** The four words it rolls through before it settles. */
  decoys: string[]
}

/** Written right to left, or without spaces between words: shown still rather than rolled. */
const NO_ROLL =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
const bare = (w: string) => w.replace(/[^\p{L}\p{N}'’-]/gu, '')

/**
 * How the highlight's words roll into place on the welcome screen: each one
 * through four words of about its length, taken from your other highlights
 * (and the text around this one, when you have few). Null when the text
 * shouldn't roll: see NO_ROLL, or a word too long to wrap.
 */
export function rollPlan(text: string, from: string[]): RollWord[] | null {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 120 || NO_ROLL.test(text) || words.some((w) => w.length > 24)) return null
  const pool = [...new Set(from.join(' ').split(/\s+/).map(bare).filter((w) => w.length > 1 && w.length <= 24))]
  const all = pool.length >= 8 ? pool : [...pool, ...words.map(bare).filter((w) => w.length > 1)]
  if (!all.length) return null
  const byLength = new Map<number, string[]>()
  const near = (len: number) => {
    let list = byLength.get(len)
    if (!list) {
      list = all
      for (const d of [1, 2, 3]) {
        const m = all.filter((w) => Math.abs(w.length - len) <= d)
        if (m.length >= 4) {
          list = m
          break
        }
      }
      byLength.set(len, list)
    }
    return list
  }
  return words.map((word) => {
    const list = near(word.length)
    return { word, decoys: Array.from({ length: 4 }, () => list[Math.floor(Math.random() * list.length)]) }
  })
}
