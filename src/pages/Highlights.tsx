import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bookmark as BookmarkIcon, ChevronDown, Copy, ExternalLink, Highlighter, Pencil, Search, StickyNote, Trash2 } from 'lucide-react'
import { db, type Book, type Bookmark, type Highlight, type HighlightColor, type WebAnnotation } from '../db/db'
import { PageContainer, PageHeader } from '../components/AppShell'
import { BookCover } from '../components/BookCover'
import { Button, IconButton } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { useToast } from '../components/ui/Toast'
import { pluralize, relativeTime } from '../lib/format'
import { HL_COLORS } from '../reader/HighlightTools'
import type { OpenAt } from '../reader/Reader'

type Kind = 'all' | 'highlights' | 'notes' | 'bookmarks'
type Sort = 'new' | 'old' | 'book'

/** A book, or an article read on the web. */
interface Source {
  id: string
  title: string
  sub?: string
  book?: Book
  url?: string
}

interface Item {
  key: string
  /** `note`: an article's own notes, not on any quote. */
  type: 'highlight' | 'note' | 'bookmark'
  source: Source
  text: string
  note: string
  color?: HighlightColor
  page?: number
  /** How far down the page (a bookmark's before anything on its page). */
  top: number
  at: number
  /** What it's filtered by: its words, your note and where it's from. */
  words: string
  row: { table: 'highlights'; value: Highlight } | { table: 'bookmarks'; value: Bookmark } | { table: 'webAnnotations'; value: WebAnnotation }
}

function collect(highlights: Highlight[], bookmarks: Bookmark[], web: WebAnnotation[], books: Book[]): Item[] {
  const shelf = new Map(books.map((b) => [b.id, b]))
  const bookSource = (id: string): Source => {
    const book = shelf.get(id)
    return book ? { id: `b:${id}`, title: book.title, sub: book.author || undefined, book } : { id: `b:${id}`, title: 'A removed book' }
  }
  const webSource = (a: WebAnnotation): Source => ({ id: `w:${a.url}`, title: a.title || a.url, sub: a.publication, url: a.url })
  const wordsOf = (s: Source, text: string, note: string) => [text, note, s.title, s.sub].filter(Boolean).join(' ').toLowerCase()
  return [
    ...highlights.map((h): Item => {
      const source = bookSource(h.bookId)
      return { key: `h:${h.id}`, type: 'highlight', source, text: h.text, note: h.note?.trim() ?? '', color: h.color, page: h.page, top: h.rects[0]?.[1] ?? 0, at: h.createdAt, words: wordsOf(source, h.text, h.note ?? ''), row: { table: 'highlights', value: h } }
    }),
    ...bookmarks.map((b): Item => {
      const source = bookSource(b.bookId)
      return { key: `b:${b.id}`, type: 'bookmark', source, text: '', note: '', page: b.page, top: -1, at: b.createdAt, words: wordsOf(source, '', ''), row: { table: 'bookmarks', value: b } }
    }),
    ...web
      // An article's notes, emptied, are just nothing there.
      .filter((a) => a.kind === 'highlight' || a.note?.trim())
      .map((a): Item => {
        const source = webSource(a)
        return { key: `w:${a.id}`, type: a.kind === 'note' ? 'note' : 'highlight', source, text: a.text ?? '', note: a.note?.trim() ?? '', color: a.kind === 'note' ? undefined : (a.color ?? 'yellow'), top: 0, at: a.createdAt, words: wordsOf(source, a.text ?? '', a.note ?? ''), row: { table: 'webAnnotations', value: a } }
      }),
  ]
}

/** Newest or oldest first; or book by book (the latest you marked first), in page order within each. */
function ordered(list: Item[], sort: Sort) {
  if (sort === 'new') return [...list].sort((a, b) => b.at - a.at)
  if (sort === 'old') return [...list].sort((a, b) => a.at - b.at)
  const latest = new Map<string, number>()
  for (const i of list) latest.set(i.source.id, Math.max(latest.get(i.source.id) ?? 0, i.at))
  return [...list].sort((a, b) =>
    a.source.id === b.source.id
      ? (a.page ?? 0) - (b.page ?? 0) || a.top - b.top || a.at - b.at
      : latest.get(b.source.id)! - latest.get(a.source.id)! || a.source.id.localeCompare(b.source.id),
  )
}

function bySource(list: Item[]) {
  const groups: { source: Source; items: Item[] }[] = []
  for (const i of list) {
    const last = groups[groups.length - 1]
    if (last?.source.id === i.source.id) last.items.push(i)
    else groups.push({ source: i.source, items: [i] })
  }
  return groups
}

function toMarkdown(list: Item[]) {
  return [
    '# Highlights',
    '',
    ...bySource(ordered(list, 'book')).flatMap(({ source: s, items }) => [
      `## ${s.title}${s.sub ? ` — ${s.sub}` : ''}`,
      '',
      ...items.flatMap((i) =>
        i.type === 'bookmark'
          ? [`- Bookmark: p. ${(i.page ?? 0) + 1}`, '']
          : [...(i.text ? [`> ${i.text}`, ...(i.page != null ? [`— p. ${i.page + 1}`] : []), ''] : []), ...(i.note ? [i.note, ''] : [])],
      ),
    ]),
  ].join('\n')
}

const PAGE = 100
const SPOT_KEY = 'irb-highlights-spot'

/** This visit's place in the browser's history: Back returns to it, a new visit from the menu has its own. */
const historyStep = () => (window.history.state as { idx?: number } | null)?.idx ?? 0

/** Where you were in the list: back from the reader, you're there again. */
function savedSpot(search: string): { y: number; limit: number } | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SPOT_KEY) || 'null') as { search: string; step: number; y: number; limit: number } | null
    return s && s.search === search && s.step === historyStep() ? s : null
  } catch {
    return null
  }
}

/** Everything you've marked, from all your books and articles, to go through and find again. */
export default function Highlights() {
  const highlights = useLiveQuery(() => db.highlights.toArray(), [])
  const bookmarks = useLiveQuery(() => db.bookmarks.toArray(), [])
  const web = useLiveQuery(() => db.webAnnotations.toArray(), [])
  const books = useLiveQuery(() => db.books.toArray(), [])
  const navigate = useNavigate()
  const { toast } = useToast()

  // The filters live in the address, so Back from a highlight brings them back too.
  const [params, setParams] = useSearchParams()
  const setParam = (name: string, value: string, unset: string) =>
    setParams(
      (p) => {
        if (value === unset) p.delete(name)
        else p.set(name, value)
        return p
      },
      { replace: true },
    )
  const kind: Kind = (['highlights', 'notes', 'bookmarks'] as string[]).includes(params.get('kind') ?? '') ? (params.get('kind') as Kind) : 'all'
  const sort: Sort = params.get('sort') === 'old' || params.get('sort') === 'book' ? (params.get('sort') as Sort) : 'new'
  const wantedColor = HL_COLORS.some((c) => c.key === params.get('color')) ? (params.get('color') as HighlightColor) : 'all'
  // A bookmark has no colour: it isn't one more reason for none to show.
  const color = kind === 'bookmarks' ? 'all' : wantedColor
  const urlQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim() !== urlQuery) setParam('q', query.trim(), '')
    }, 300)
    return () => clearTimeout(t)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  const needle = useDeferredValue(query.trim().toLowerCase())

  const items = useMemo(() => (highlights && bookmarks && web && books ? collect(highlights, bookmarks, web, books) : null), [highlights, bookmarks, web, books])

  const sources = useMemo(() => {
    const m = new Map<string, Source & { count: number }>()
    for (const i of items ?? []) {
      const s = m.get(i.source.id)
      if (s) s.count++
      else m.set(i.source.id, { ...i.source, count: 1 })
    }
    const all = [...m.values()].sort((a, b) => a.title.localeCompare(b.title))
    return { ids: m, books: all.filter((s) => !s.url), articles: all.filter((s) => s.url) }
  }, [items])
  const wantedSource = params.get('book') ?? 'all'
  const source = wantedSource === 'substack' ? (sources.articles.length ? 'substack' : 'all') : sources.ids.has(wantedSource) ? wantedSource : 'all'

  const matching = useMemo(
    () =>
      (items ?? []).filter(
        (i) =>
          (source === 'all' || i.source.id === source || (source === 'substack' && !!i.source.url)) &&
          (color === 'all' || i.color === color) &&
          (!needle || i.words.includes(needle)),
      ),
    [items, source, color, needle],
  )
  const counts = useMemo(
    () => ({
      all: matching.length,
      highlights: matching.filter((i) => i.type === 'highlight').length,
      notes: matching.filter((i) => i.note).length,
      bookmarks: matching.filter((i) => i.type === 'bookmark').length,
    }),
    [matching],
  )
  const shown = useMemo(() => {
    const list = matching.filter((i) => (kind === 'all' ? true : kind === 'highlights' ? i.type === 'highlight' : kind === 'notes' ? !!i.note : i.type === 'bookmark'))
    return ordered(list, sort)
  }, [matching, kind, sort])

  // A long list comes a part at a time; changing a filter starts it again.
  const filters = `${source}|${kind}|${color}|${needle}|${sort}`
  const [spot] = useState(() => savedSpot(window.location.hash.split('?')[1] ?? ''))
  const [more, setMore] = useState({ filters, limit: spot?.limit ?? PAGE })
  const limit = more.filters === filters ? more.limit : PAGE
  const visible = shown.slice(0, limit)

  const restored = useRef(false)
  useLayoutEffect(() => {
    if (restored.current || !items) return
    restored.current = true
    if (spot) window.scrollTo(0, spot.y)
  }, [items, spot])

  if (!items) return <PageContainer><div className="skeleton h-8 w-48 rounded-sm" /></PageContainer>

  const openInBook = (i: Item) => {
    if (!i.source.book || i.page == null) return
    try {
      sessionStorage.setItem(SPOT_KEY, JSON.stringify({ search: window.location.hash.split('?')[1] ?? '', step: historyStep(), y: window.scrollY, limit }))
    } catch {
      /* ignore */
    }
    const at: OpenAt = { page: i.page, top: Math.max(0, i.top), highlightId: i.row.table === 'highlights' ? i.row.value.id : undefined }
    navigate(`/read/${i.source.book.id}`, { state: { openAt: at } })
  }

  const remove = async ({ row }: Item) => {
    if (row.table === 'highlights') {
      await db.highlights.delete(row.value.id)
      toast({ message: 'Highlight deleted', action: { label: 'Undo', onClick: () => void db.highlights.put(row.value) } })
    } else if (row.table === 'bookmarks') {
      await db.bookmarks.delete(row.value.id)
      toast({ message: 'Bookmark deleted', action: { label: 'Undo', onClick: () => void db.bookmarks.put(row.value) } })
    } else {
      await db.webAnnotations.delete(row.value.id)
      toast({ message: row.value.kind === 'note' ? 'Note deleted' : 'Highlight deleted', action: { label: 'Undo', onClick: () => void db.webAnnotations.put(row.value) } })
    }
  }

  const saveNote = async ({ row }: Item, note: string) => {
    const text = note.trim()
    if (row.table === 'highlights') await db.highlights.update(row.value.id, { note: text || undefined })
    else if (row.table === 'webAnnotations') await db.webAnnotations.update(row.value.id, { note: text || undefined })
  }

  const copyOne = async (i: Item) => {
    await navigator.clipboard?.writeText(i.text || i.note).catch(() => {})
    toast({ id: 'hl-copied', message: 'Copied', duration: 1500 })
  }

  const copyAll = async () => {
    await navigator.clipboard?.writeText(toMarkdown(shown)).catch(() => {})
    toast({ message: `${pluralize(shown.length, 'item')} copied`, description: 'As Markdown — paste anywhere.' })
  }

  const filtered = source !== 'all' || kind !== 'all' || color !== 'all' || !!needle
  const clearFilters = () => {
    setQuery('')
    setParams((p) => {
      for (const name of ['book', 'kind', 'color', 'q']) p.delete(name)
      return p
    }, { replace: true })
  }

  const totals = {
    highlights: items.filter((i) => i.type === 'highlight').length,
    notes: items.filter((i) => i.note).length,
    bookmarks: items.filter((i) => i.type === 'bookmark').length,
  }
  const colorsThere = HL_COLORS.filter((c) => items.some((i) => i.color === c.key))
  const oneSource = source !== 'all' && source !== 'substack'
  const groups = sort === 'book' ? bySource(visible) : null

  const rowOf = (i: Item, showSource: boolean) => (
    <Row key={i.key} item={i} showSource={showSource} onOpen={() => openInBook(i)} onCopy={() => void copyOne(i)} onDelete={() => void remove(i)} onSaveNote={(n) => saveNote(i, n)} />
  )

  return (
    <PageContainer className="max-w-[880px]">
      <PageHeader
        eyebrow="Notebook"
        title="Highlights"
        subtitle={
          items.length
            ? `${pluralize(totals.highlights, 'highlight')}, ${pluralize(totals.notes, 'note')} and ${pluralize(totals.bookmarks, 'bookmark')} from ${[sources.books.length && pluralize(sources.books.length, 'book'), sources.articles.length && pluralize(sources.articles.length, 'article')].filter(Boolean).join(' and ')}`
            : 'Everything you mark while reading collects here.'
        }
        actions={
          shown.length > 0 && (
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy className="size-3.5" /> Copy as Markdown
            </Button>
          )
        }
      />

      {items.length === 0 ? (
        <div className="flex flex-col items-center rounded-md border border-dashed border-hairline bg-canvas-elevated px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-hairline-soft text-ink">
            <Highlighter className="size-5" />
          </span>
          <p className="mt-4 text-heading-md text-ink">Nothing marked yet</p>
          <p className="mt-1.5 max-w-[440px] text-body-md text-body">
            While reading, select text to highlight it or add a note, and press B to bookmark a page. They land here, from all your books.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-5 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find in your highlights and notes"
                  aria-label="Find in your highlights and notes"
                  className="h-9 w-full rounded-sm border border-hairline bg-canvas-elevated pl-9 pr-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
                />
              </label>
              <label className="relative min-w-0 sm:w-[280px]">
                <select
                  value={source}
                  onChange={(e) => setParam('book', e.target.value, 'all')}
                  aria-label="Book"
                  className="h-9 w-full appearance-none truncate rounded-sm border border-hairline bg-canvas-elevated pl-3 pr-8 text-body-md text-ink outline-none transition-[border-color,box-shadow] focus:border-link focus:ring-3 focus:ring-link/15"
                >
                  <option value="all">All books{sources.articles.length ? ' and articles' : ''}</option>
                  {sources.books.length > 0 && (
                    <optgroup label="Books">
                      {sources.books.map((s) => (
                        <option key={s.id} value={s.id}>{s.title} ({s.count})</option>
                      ))}
                    </optgroup>
                  )}
                  {sources.articles.length > 0 && (
                    <optgroup label="Substack">
                      <option value="substack">All of Substack</option>
                      {sources.articles.map((s) => (
                        <option key={s.id} value={s.id}>{s.title} ({s.count})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <div className="max-w-full overflow-x-auto [scrollbar-width:none]!">
                <Segmented
                  value={kind}
                  onChange={(v) => setParam('kind', v, 'all')}
                  size="sm"
                  ariaLabel="Show"
                  options={[
                    { value: 'all', label: <>All <Count n={counts.all} /></> },
                    { value: 'highlights', label: <>Highlights <Count n={counts.highlights} /></> },
                    { value: 'notes', label: <>Notes <Count n={counts.notes} /></> },
                    { value: 'bookmarks', label: <>Bookmarks <Count n={counts.bookmarks} /></> },
                  ]}
                />
              </div>
              {kind !== 'bookmarks' && colorsThere.length > 1 && (
                <div className="flex items-center sm:gap-0.5" role="group" aria-label="Colour">
                  <button
                    onClick={() => setParam('color', 'all', 'all')}
                    aria-pressed={color === 'all'}
                    className={`hidden h-7 rounded-full px-2.5 text-body-sm font-medium transition-colors sm:block ${color === 'all' ? 'bg-ink text-canvas' : 'text-body hover:bg-hairline-soft'}`}
                  >
                    Any
                  </button>
                  {colorsThere.map((c) => (
                    <button
                      key={c.key}
                      aria-label={`Only ${c.label}`}
                      aria-pressed={color === c.key}
                      onClick={() => setParam('color', color === c.key ? 'all' : c.key, 'all')}
                      className={`grid size-7 place-items-center rounded-full ${color === c.key ? 'bg-hairline' : 'hover:bg-hairline-soft'}`}
                    >
                      <span className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: c.swatch }} />
                    </button>
                  ))}
                </div>
              )}
              <Segmented
                value={sort}
                onChange={(v) => setParam('sort', v, 'new')}
                size="sm"
                ariaLabel="Sort"
                className="ml-auto"
                options={[
                  { value: 'new', label: 'Newest' },
                  { value: 'old', label: 'Oldest' },
                  { value: 'book', label: oneSource ? 'By page' : 'By book' },
                ]}
              />
            </div>

            {filtered && (
              <p className="flex items-center gap-2 text-body-sm text-mute">
                <span className="tabular">{shown.length} of {items.length}</span>
                <button onClick={clearFilters} className="text-link hover:underline">Clear filters</button>
              </p>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-body-md text-mute">{needle ? `Nothing here has “${query.trim()}” in it.` : 'Nothing here with these filters.'}</p>
          ) : groups ? (
            <div className="space-y-4">
              {groups.map((g) => (
                <section key={g.source.id} className="rounded-md border border-hairline bg-canvas-elevated">
                  {!oneSource && <GroupHeader source={g.source} count={g.items.length} />}
                  <ul className="divide-y divide-hairline">{g.items.map((i) => rowOf(i, false))}</ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-hairline rounded-md border border-hairline bg-canvas-elevated">{visible.map((i) => rowOf(i, !oneSource))}</ul>
          )}

          {shown.length > visible.length && (
            <div className="mt-4 text-center">
              <Button variant="outline" size="sm" onClick={() => setMore({ filters, limit: limit + PAGE })}>
                Show {Math.min(PAGE, shown.length - visible.length)} more
              </Button>
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}

function Count({ n }: { n: number }) {
  return <span className="tabular text-faint">{n}</span>
}

function GroupHeader({ source: s, count }: { source: Source; count: number }) {
  return (
    <header className="flex items-center gap-3 border-b border-hairline px-4 py-3 sm:px-5">
      {s.book && <BookCover book={s.book} width={30} rounded="rounded-[2px]" className="shrink-0" />}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-body-md font-semibold text-ink">{s.title}</h2>
        {s.sub && <p className="truncate text-body-sm text-mute">{s.sub}</p>}
      </div>
      <span className="shrink-0 text-body-sm tabular text-faint">{count}</span>
    </header>
  )
}

function Row({ item: i, showSource, onOpen, onCopy, onDelete, onSaveNote }: { item: Item; showSource: boolean; onOpen: () => void; onCopy: () => void; onDelete: () => void; onSaveNote: (note: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const s = i.source
  const swatch = HL_COLORS.find((c) => c.key === i.color)?.swatch
  const when = [i.type !== 'bookmark' && i.page != null ? `p. ${i.page + 1}` : null, relativeTime(i.at)].filter(Boolean).join(' · ')

  const body = (
    <>
      {i.type === 'bookmark' && <span className="block text-body-lg font-medium text-ink">Page {(i.page ?? 0) + 1}</span>}
      {i.text && <span dir="auto" className="block whitespace-pre-wrap text-start text-body-lg text-ink">{i.text}</span>}
      {i.note && (
        <span dir="auto" className={`block whitespace-pre-wrap text-start ${i.text ? 'mt-2 rounded-sm bg-hairline-soft px-2.5 py-2 text-body-md text-body' : 'text-body-lg text-ink'}`}>
          {i.note}
        </span>
      )}
    </>
  )
  // The whole row opens it; what's on top of that (the buttons, the note box) sits above.
  const opens = 'block w-full text-start outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-link/60'

  return (
    <li className="group relative flex gap-3 px-4 py-3.5 transition-colors first:rounded-t-[inherit] last:rounded-b-[inherit] hover:bg-hairline-soft/50 sm:px-5">
      <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
        {i.type === 'bookmark' ? (
          <BookmarkIcon className="mt-1 size-4 fill-link text-link" />
        ) : i.type === 'note' ? (
          <StickyNote className="mt-1 size-4 text-faint" />
        ) : (
          <span className="w-[3px] self-stretch rounded-full" style={{ background: swatch ?? '#fcd34d' }} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        {s.url ? (
          <a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.title}`} className={opens}>{body}</a>
        ) : s.book ? (
          <button onClick={onOpen} className={opens}>{body}</button>
        ) : (
          <div>{body}</div>
        )}
        <div className="mt-1 flex min-h-8 items-center gap-2">
          {/* On a phone the title gets its own line: beside the buttons there'd be no room to read it. */}
          <p className="flex min-w-0 flex-1 flex-col text-body-sm text-faint sm:flex-row sm:items-center sm:gap-1">
            {showSource && <span className="min-w-0 truncate text-mute">{s.title}</span>}
            {showSource && <span aria-hidden="true" className="hidden sm:inline">·</span>}
            <span className="flex shrink-0 items-center gap-1">
              {when}
              {s.url && <ExternalLink className="size-3 shrink-0" />}
            </span>
          </p>
          <div className="relative z-10 flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
            {i.type !== 'bookmark' && (
              <IconButton label="Copy" size="icon-sm" onClick={onCopy}>
                <Copy className="size-3.5" />
              </IconButton>
            )}
            {i.type !== 'bookmark' && (
              <IconButton label={i.note ? 'Edit note' : 'Add a note'} size="icon-sm" active={editing} onClick={() => setEditing((e) => !e)}>
                {i.note ? <Pencil className="size-3.5" /> : <StickyNote className="size-3.5" />}
              </IconButton>
            )}
            <IconButton label="Delete" size="icon-sm" className="hover:bg-error/10 hover:text-error" onClick={onDelete}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </div>
        {editing && (
          <NoteEditor
            initial={i.note}
            onCancel={() => setEditing(false)}
            onSave={(note) => {
              setEditing(false)
              void onSaveNote(note)
            }}
          />
        )}
      </div>
    </li>
  )
}

function NoteEditor({ initial, onSave, onCancel }: { initial: string; onSave: (note: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="relative z-10 mt-1">
      <textarea
        autoFocus
        dir="auto"
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(value)
        }}
        aria-label="Your note"
        placeholder="Why did this matter?"
        className="block w-full resize-y rounded-sm border border-hairline bg-canvas-elevated px-3 py-2 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSave(value)}>Save note</Button>
      </div>
    </div>
  )
}
