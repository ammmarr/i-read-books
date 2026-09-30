import { db, type Recap, type RecapQuestion } from '../db/db'
import { updateSettings, useSettings, getSettings } from './settings'
import type { OutlineItem } from './pdf'

// ── The three questions ────────────────────────────────────────────────
// Recall it (retrieval), make it concrete (a real example), then decide what
// changes (an intention you can check yourself against later).

export interface RecapPrompt {
  key: RecapQuestion
  /** Short label for lists and exports. */
  label: string
  title: string
  hint: string
  placeholder: string
}

export const RECAP_QUESTIONS: RecapPrompt[] = [
  {
    key: 'learned',
    label: 'What I learned',
    title: 'What did you learn from this chapter?',
    hint: 'The main ideas in your own words — from memory, without looking back. Rough is fine.',
    placeholder: 'The big idea is…',
  },
  {
    key: 'example',
    label: 'Real-life example',
    title: 'Give an example from real life or your own experience.',
    hint: 'A moment, a person, a company, a mistake you made — anything that makes the idea concrete.',
    placeholder: 'I saw this when…',
  },
  {
    key: 'apply',
    label: 'What I’ll do',
    title: 'What will you do differently because of it?',
    hint: 'One specific thing you’ll try, change or keep in mind — and when. Next time you read this recap, check if you did.',
    placeholder: 'Next time I…, I’ll…',
  },
]

/** "Pages 12–30" — unless the title already says so (books without a table of contents). */
export function pageRange(c: { title: string; start: number; end: number }) {
  const r = `Pages ${c.start + 1}–${c.end + 1}`
  return c.title === r ? null : r
}

export const hasAnswers = (r: Pick<Recap, 'answers'> | undefined) => !!r && RECAP_QUESTIONS.some((q) => r.answers[q.key]?.trim())

// ── Chapters from the table of contents ────────────────────────────────

export interface Chapter {
  title: string
  /** 0-based, inclusive. */
  start: number
  end: number
  /** Titles of the sections inside it (from the table of contents). */
  sections: string[]
}

/** Front and back matter — not chapters you'd recap. */
const MATTER =
  /^(cover|title( page)?|half[- ]title|copyright( page)?|(table of )?contents|dedication|epigraph|acknowledge?ments?|about the (authors?|publisher)|about this book|key terms|(a )?note to (the )?readers?|also by\b.*|praise for\b.*|books by\b.*|other books\b.*|index|notes|endnotes|bibliography|references|sources|further reading|recommended reading|glossary|credits|colophon|permissions|list of (figures|tables|illustrations)|frontispiece|back cover|newsletter\b.*|sign up\b.*|appendix\b.*|appendices)$/i
const PART = /^(part|book|section|volume)\s+([\divxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i

const clean = (t: string) => t.replace(/\s+/g, ' ').trim()
const isMatter = (t: string) => MATTER.test(clean(t).replace(/^[\divxlc]+[.):\s-]+/i, '').replace(/[.:]$/, ''))

/** Chapters shorter than this don't prompt a recap by themselves (you can still write one). */
export const MIN_RECAP_PAGES = 5
/** Share of a chapter's pages you must have actually read before it asks. */
export const RECAP_COVERAGE = 0.75

interface Node {
  title: string
  page: number
  depth: number
  leaf: boolean
  sections: string[]
}

/**
 * Works out the book's chapters from its outline. Outlines nest differently
 * (parts → chapters → sections, or a single title wrapping everything), so it
 * picks the shallowest level that looks like chapters: at least three of
 * them, not "Part One"-style groupings, and not huge. Front and back matter
 * (contents, index, notes…) still end the chapter before them but aren't
 * chapters themselves.
 */
export function chaptersOf(outline: OutlineItem[], pageCount: number): Chapter[] {
  if (!outline.length || pageCount < 2) return []
  const nodes: Node[] = []
  const walk = (items: OutlineItem[], depth: number) => {
    for (const it of items) {
      const kids = it.items.filter((c) => c.page != null || c.items.length)
      if (it.page != null && it.page < pageCount)
        nodes.push({ title: clean(it.title), page: it.page, depth, leaf: !kids.length, sections: kids.map((c) => clean(c.title)).filter((t) => t && !isMatter(t)) })
      walk(it.items, depth + 1)
    }
  }
  walk(outline, 0)
  if (!nodes.length) return []
  const maxDepth = Math.min(3, Math.max(...nodes.map((n) => n.depth)))

  const at = (level: number): Chapter[] => {
    const bounds = [...new Set(nodes.filter((n) => n.depth <= level).map((n) => n.page))].sort((a, b) => a - b)
    const seen = new Set<number>()
    const out: Chapter[] = []
    for (const n of [...nodes].sort((a, b) => a.page - b.page || a.depth - b.depth)) {
      if (!(n.depth === level || (n.depth < level && n.leaf)) || isMatter(n.title) || seen.has(n.page)) continue
      seen.add(n.page)
      const next = bounds.find((p) => p > n.page)
      out.push({ title: n.title, start: n.page, end: (next ?? pageCount) - 1, sections: n.sections })
    }
    return out
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

  let fallback: Chapter[] = []
  for (let level = 0; level <= maxDepth; level++) {
    const chs = at(level)
    if (!fallback.length) fallback = chs
    if (chs.length < 3) continue
    const deeper = level < maxDepth
    const groupings = chs.filter((c) => PART.test(c.title) && c.sections.length).length >= chs.length / 2
    if (deeper && groupings) continue
    if (deeper && median(chs.map((c) => c.end - c.start + 1)) > 60) continue
    return chs
  }
  return fallback
}

/** Share of the chapter's pages you've actually read. */
export function coverage(c: Pick<Chapter, 'start' | 'end'>, read: Set<number>) {
  let n = 0
  for (let p = c.start; p <= c.end; p++) if (read.has(p)) n++
  return n / (c.end - c.start + 1)
}

/**
 * The chapter you most recently finished, seen from `page`: the one you're in
 * if you've read its last page, otherwise the one before it.
 */
export function lastFinishedChapter(chapters: Chapter[], page: number, read: Set<number>) {
  for (let i = chapters.length - 1; i >= 0; i--) {
    const c = chapters[i]
    if (c.start > page) continue
    if (page > c.end || read.has(c.end)) return c
  }
  return null
}

/** The chapter a manual "Recap" means: the one you're in — or the one you just left, if you've only just started this one. */
export function chapterForRecap(chapters: Chapter[], page: number) {
  let idx = -1
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= page) idx = i
  if (idx < 0) return chapters[0] ?? null
  if (idx > 0 && page - chapters[idx].start < 2) return chapters[idx - 1]
  return chapters[idx]
}

/**
 * Books without a table of contents: recap "what you've read since the last
 * recap", up to the page you're on.
 */
export function pagesChapter(recaps: Recap[], page: number): Chapter {
  const containing = recaps.find((r) => r.start <= page && page <= r.end)
  if (containing) return { title: containing.chapter, start: containing.start, end: containing.end, sections: containing.sections ?? [] }
  const start = recaps.filter((r) => r.end < page).reduce((m, r) => Math.max(m, r.end + 1), 0)
  return { title: `Pages ${start + 1}–${page + 1}`, start, end: page, sections: [] }
}

// ── Storage ────────────────────────────────────────────────────────────

/** Same chapter, same id on every device — so two devices can't make two recaps of it. */
export const recapId = (bookId: string, start: number) => `${bookId}:${start}`

export const findRecap = (bookId: string, start: number) => db.recaps.where('[bookId+start]').equals([bookId, start]).first()

/** Notes that you finished a chapter, so its recap waits for you (idempotent). */
export async function markRecapDue(bookId: string, c: Chapter) {
  const existing = await findRecap(bookId, c.start)
  if (existing) return existing
  const now = Date.now()
  const r: Recap = { id: recapId(bookId, c.start), bookId, start: c.start, end: c.end, chapter: c.title, sections: c.sections, answers: {}, state: 'due', createdAt: now, updatedAt: now }
  await db.recaps.add(r)
  return r
}

export function recapsMarkdown(book: { title: string; author?: string }, recaps: Recap[]) {
  const done = recaps.filter((r) => r.state === 'done').sort((a, b) => a.start - b.start)
  return [
    `# ${book.title}${book.author ? ` — ${book.author}` : ''} · chapter recaps`,
    '',
    ...done.flatMap((r) => {
      const range = pageRange({ title: r.chapter, start: r.start, end: r.end })
      return [
        `## ${r.chapter}`,
        ...(range ? [`_${range}_`] : []),
        '',
        ...RECAP_QUESTIONS.flatMap((q) => (r.answers[q.key]?.trim() ? [`**${q.label}**`, '', r.answers[q.key]!.trim(), ''] : [])),
      ]
    }),
  ].join('\n')
}

// ── Preferences (synced with your other settings) ──────────────────────

export const setRecapsEnabled = (enabled: boolean) => updateSettings({ chapterRecaps: enabled })
export function setBookRecaps(bookId: string, on: boolean) {
  const off = getSettings().recapsOffBooks
  updateSettings({ recapsOffBooks: on ? off.filter((b) => b !== bookId) : [...new Set([...off, bookId])] })
}

export function useRecapPrefs() {
  const s = useSettings()
  return { enabled: s.chapterRecaps, offBooks: s.recapsOffBooks }
}
