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

export type RecapKind = 'chapter' | 'section'
export const kindOf = (r: Pick<Recap, 'kind'> | Pick<Chapter, 'kind'>): RecapKind => r.kind ?? 'chapter'
/** A question as asked about this unit ("…from this section?"). */
export const questionTitle = (q: RecapPrompt, kind: RecapKind) => (kind === 'section' ? q.title.replace('this chapter', 'this section') : q.title)

/** "Pages 12–30" — unless the title already says so (books without a table of contents). */
export function pageRange(c: { title: string; start: number; end: number }) {
  const r = `Pages ${c.start + 1}–${c.end + 1}`
  return c.title === r ? null : r
}

export const hasAnswers = (r: Pick<Recap, 'answers'> | undefined) => !!r && RECAP_QUESTIONS.some((q) => r.answers[q.key]?.trim())

// ── Chapters and sections from the table of contents ───────────────────

/** Something you can recap: a chapter, or a section inside one. */
export interface Chapter {
  title: string
  /** 0-based, inclusive: the pages it's on. */
  start: number
  end: number
  /**
   * Exact extent as book positions (page + how far down it, 0–1): from its
   * heading to where the next heading begins — its last line.
   */
  from?: number
  to?: number
  /** Titles of the sections inside it (from the table of contents). */
  sections: string[]
  /** Default 'chapter'. */
  kind?: RecapKind
  /** For a section: the chapter it belongs to. */
  parent?: string
  /** For a chapter: its sections, with their pages. */
  parts?: Chapter[]
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

interface Kid {
  title: string
  page: number
  /** Book position of its heading: page + how far down (0–1). */
  pos: number
}
interface Node extends Kid {
  depth: number
  leaf: boolean
  /** Direct children with a page: the sections, if this turns out to be a chapter. */
  kids: Kid[]
}

/** Book position of an outline entry (top of the page when the PDF doesn't say). */
const posOf = (it: OutlineItem) => it.page! + Math.min(0.99, Math.max(0, it.top ?? 0))

/**
 * The page holding a unit's last line, given where the next heading begins.
 * A heading near the top of a page means the unit ended on the page before.
 */
function lastPage(to: number, start: number) {
  const p = Math.floor(to + 1e-9)
  return Math.max(start, to - p < 0.15 ? p - 1 : p)
}

/**
 * A chapter's sections, each running from its heading to the next one (the
 * last to the end of the chapter). Entries pointing at the same spot merge
 * into one ("A · B").
 */
function partsOf(chapter: Chapter, kids: Kid[]): Chapter[] {
  const from = chapter.from ?? chapter.start
  const to = chapter.to ?? chapter.end + 1
  const ks = kids.filter((k) => k.pos >= from - 1e-6 && k.pos < to && k.title && !isMatter(k.title)).sort((a, b) => a.pos - b.pos)
  const merged: Kid[] = []
  for (const k of ks) {
    const last = merged[merged.length - 1]
    if (last && k.pos - last.pos < 0.01) last.title = `${last.title} · ${k.title}`
    else merged.push({ ...k })
  }
  return merged.map((k, i) => {
    const end = i + 1 < merged.length ? merged[i + 1].pos : to
    return { title: k.title, start: k.page, end: lastPage(end, k.page), from: k.pos, to: end, sections: [], kind: 'section' as const, parent: chapter.title }
  })
}

/**
 * Works out the book's chapters from its outline. Outlines nest differently
 * (parts → chapters → sections, or a single title wrapping everything), so it
 * picks the shallowest level that looks like chapters: at least three of
 * them, not "Part One"-style groupings, and not huge. Front and back matter
 * (contents, index, notes…) still end the chapter before them but aren't
 * chapters themselves. Each chapter's own entries become its sections.
 */
export function chaptersOf(outline: OutlineItem[], pageCount: number): Chapter[] {
  if (!outline.length || pageCount < 2) return []
  const nodes: Node[] = []
  const walk = (items: OutlineItem[], depth: number) => {
    for (const it of items) {
      const kids = it.items.filter((c) => c.page != null || c.items.length)
      if (it.page != null && it.page < pageCount)
        nodes.push({
          title: clean(it.title),
          page: it.page,
          pos: posOf(it),
          depth,
          leaf: !kids.length,
          kids: kids.filter((c) => c.page != null && c.page < pageCount).map((c) => ({ title: clean(c.title), page: c.page!, pos: posOf(c) })),
        })
      walk(it.items, depth + 1)
    }
  }
  walk(outline, 0)
  if (!nodes.length) return []
  const maxDepth = Math.min(3, Math.max(...nodes.map((n) => n.depth)))

  const at = (level: number): Chapter[] => {
    const bounds = [...new Set(nodes.filter((n) => n.depth <= level).map((n) => n.pos))].sort((a, b) => a - b)
    const seen = new Set<number>()
    const out: Chapter[] = []
    for (const n of [...nodes].sort((a, b) => a.pos - b.pos || a.depth - b.depth)) {
      if (!(n.depth === level || (n.depth < level && n.leaf)) || isMatter(n.title) || seen.has(n.page)) continue
      seen.add(n.page)
      const to = bounds.find((p) => p > n.pos + 1e-6) ?? pageCount
      const c: Chapter = {
        title: n.title, start: n.page, end: lastPage(to, n.page), from: n.pos, to,
        sections: n.kids.map((k) => k.title).filter((t) => t && !isMatter(t)),
      }
      c.parts = partsOf(c, n.kids)
      out.push(c)
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

/** Every chapter's sections, in reading order. */
export const sectionsOf = (chapters: Chapter[]) => chapters.flatMap((c) => c.parts ?? [])

/** Share of the chapter's pages you've actually read. */
export function coverage(c: Pick<Chapter, 'start' | 'end'>, read: Set<number>) {
  let n = 0
  for (let p = c.start; p <= c.end; p++) if (read.has(p)) n++
  return n / (c.end - c.start + 1)
}

/**
 * The chapter (or section) you most recently finished, seen from `page`: the
 * one you're in if you've read its last page, otherwise the one before it.
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

/** The section you're in (none on a chapter's opening pages, before its first section). */
export function sectionForRecap(sections: Chapter[], page: number) {
  return sections.find((s) => s.start <= page && page <= s.end) ?? null
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

/** The unit a stored recap is about. */
export const unitOf = (r: Recap): Chapter => ({ title: r.chapter, start: r.start, end: r.end, sections: r.sections ?? [], kind: kindOf(r), parent: r.parent })

// ── Storage ────────────────────────────────────────────────────────────

/** Short, stable hash of a title (sections can start on the same page as their chapter). */
function titleHash(t: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/**
 * Same chapter or section, same id on every device — so two devices can't
 * make two recaps of it. Chapters: "{book}:{first page}"; sections add their
 * title: "{book}:{first page}:{hash}".
 */
export const recapId = (bookId: string, c: Pick<Chapter, 'start' | 'title' | 'kind'>) =>
  kindOf(c) === 'section' ? `${bookId}:${c.start}:${titleHash(c.title)}` : `${bookId}:${c.start}`

/** A section's id has three parts — how to tell sections apart where the cloud doesn't store `kind`. */
export const kindFromId = (id: string): RecapKind => (id.split(':').length === 3 ? 'section' : 'chapter')

export async function findRecap(bookId: string, c: Pick<Chapter, 'start' | 'title' | 'kind'>) {
  const byId = await db.recaps.get(recapId(bookId, c))
  if (byId || kindOf(c) === 'section') return byId
  // Chapters written before ids were derived from the chapter.
  return db.recaps
    .where('[bookId+start]')
    .equals([bookId, c.start])
    .filter((r) => kindOf(r) === 'chapter')
    .first()
}

/** Notes that you finished a chapter, so its recap waits for you (idempotent). */
export async function markRecapDue(bookId: string, c: Chapter) {
  const existing = await findRecap(bookId, c)
  if (existing) return existing
  const now = Date.now()
  const r: Recap = {
    id: recapId(bookId, c), bookId, start: c.start, end: c.end, chapter: c.title, sections: c.sections, kind: kindOf(c), parent: c.parent,
    answers: {}, state: 'due', createdAt: now, updatedAt: now,
  }
  await db.recaps.add(r)
  return r
}

/** Recaps grouped by chapter, in reading order: each chapter's own recap (if any), then its sections'. */
export function groupRecaps(recaps: Recap[]) {
  const sorted = [...recaps].sort((a, b) => a.start - b.start || (kindOf(a) === 'chapter' ? -1 : 1))
  const groups: { title: string; start: number; chapter?: Recap; sections: Recap[] }[] = []
  const byTitle = new Map<string, (typeof groups)[number]>()
  for (const r of sorted) {
    const key = kindOf(r) === 'section' ? r.parent || 'Sections' : r.chapter
    let g = byTitle.get(key)
    if (!g) {
      g = { title: key, start: r.start, sections: [] }
      byTitle.set(key, g)
      groups.push(g)
    }
    if (kindOf(r) === 'chapter') g.chapter = r
    else g.sections.push(r)
  }
  return groups.sort((a, b) => a.start - b.start)
}

export function recapsMarkdown(book: { title: string; author?: string }, recaps: Recap[]) {
  const answers = (r: Recap) =>
    RECAP_QUESTIONS.flatMap((q) => (r.answers[q.key]?.trim() ? [`**${q.label}**`, '', r.answers[q.key]!.trim(), ''] : []))
  return [
    `# ${book.title}${book.author ? ` — ${book.author}` : ''} · recaps`,
    '',
    ...groupRecaps(recaps.filter((r) => r.state === 'done')).flatMap((g) => {
      const range = g.chapter && pageRange({ title: g.chapter.chapter, start: g.chapter.start, end: g.chapter.end })
      return [
        `## ${g.title}`,
        ...(range ? [`_${range}_`] : []),
        '',
        ...(g.chapter ? answers(g.chapter) : []),
        ...g.sections.flatMap((s) => [`### ${s.chapter}`, '', ...answers(s)]),
      ]
    }),
  ].join('\n')
}

// ── Preferences (synced with your other settings) ──────────────────────

export const setRecapsEnabled = (enabled: boolean) => updateSettings({ chapterRecaps: enabled })
export const setSectionRecaps = (on: boolean) => updateSettings({ recapSections: on })
export function setBookRecaps(bookId: string, on: boolean) {
  const off = getSettings().recapsOffBooks
  updateSettings({ recapsOffBooks: on ? off.filter((b) => b !== bookId) : [...new Set([...off, bookId])] })
}

export function useRecapPrefs() {
  const s = useSettings()
  return { enabled: s.chapterRecaps, sections: s.recapSections, offBooks: s.recapsOffBooks }
}
