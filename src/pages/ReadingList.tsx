import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { ArrowRight, BookPlus, Check, ChevronDown, FilePlus, ListPlus, NotebookPen, Play, Search, SlidersHorizontal, Upload, X } from 'lucide-react'
import { useImporter } from '../components/Importer'
import { db, type Book, type Session } from '../db/db'
import { bookProgress } from '../db/books'
import { readCount, unreadAhead } from '../lib/pages'
import { continueFrom } from '../lib/openBook'
import { PageContainer, PageHeader } from '../components/AppShell'
import { BookCover } from '../components/BookCover'
import { BookMenu } from '../components/BookActions'
import { Button } from '../components/ui/Button'
import { Sheet } from '../components/ui/Sheet'
import { finishGuess, summarize } from '../lib/stats'
import { formatDurationLong } from '../lib/format'
import { useIsMobile } from '../lib/hooks'

/**
 * The reading list as a small library: what you're reading (with how far you
 * are) and what you want to read, found by searching, filtering and sorting.
 * No queue numbers and no order to keep.
 */

/** Assumed pace before we've measured yours: ~40 pages an hour. */
const DEFAULT_PPH = 40

type Sort = 'added' | 'progress' | 'title' | 'author' | 'short'
type Status = 'all' | 'reading' | 'next'
type Pdf = 'all' | 'ready' | 'need'
type Len = 'any' | 'short' | 'medium' | 'long'

const SORTS: [Sort, string][] = [
  ['added', 'Recently added'],
  ['progress', 'Most read first'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['short', 'Shortest first'],
]
const STATUSES: [Status, string][] = [['all', 'All'], ['reading', 'Reading'], ['next', 'Not started']]
const PDFS: [Pdf, string][] = [['all', 'Any'], ['ready', 'Ready to read'], ['need', 'Needs a PDF']]
const LENS: [Len, string][] = [['any', 'Any length'], ['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']]

const pagesOf = (b: Book) => b.pageCount || b.estPages || 0
const lenOf = (b: Book): Len | null => {
  const p = pagesOf(b)
  return !p ? null : p < 200 ? 'short' : p <= 500 ? 'medium' : 'long'
}
const bare = (t: string) => t.replace(/^(the|a|an) /i, '')
const surname = (a: string) => a.trim().split(/\s+/).pop() ?? ''

function loadSort(): Sort {
  try {
    const s = localStorage.getItem('irb-list-sort')
    if (s && SORTS.some(([k]) => k === s)) return s as Sort
  } catch {
    /* private window */
  }
  return 'added'
}

export default function ReadingList() {
  const books = useLiveQuery(() => db.books.toArray(), [])
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? []
  const pph = summarize(sessions, 0, Infinity).pagesPerHour || DEFAULT_PPH
  const mobile = useIsMobile()
  const { openAdd, pickCsv } = useImporter()

  const [q, setQ] = useState('')
  const [sort, setSortState] = useState<Sort>(loadSort)
  const [status, setStatus] = useState<Status>('all')
  const [pdf, setPdf] = useState<Pdf>('all')
  const [len, setLen] = useState<Len>('any')
  const [panel, setPanel] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  const search = useRef<HTMLInputElement>(null)

  const setSort = (s: Sort) => {
    setSortState(s)
    try {
      localStorage.setItem('irb-list-sort', s)
    } catch {
      /* private window */
    }
  }

  // "/" jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== '/' || e.metaKey || e.ctrlKey || t.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      search.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const list = useMemo(() => (books ?? []).filter((b) => b.status === 'reading' || b.status === 'queued'), [books])
  const query = q.trim().toLowerCase()
  const okQ = (b: Book) => !query || `${b.title} ${b.author}`.toLowerCase().includes(query)
  const okS = (b: Book) => status === 'all' || (status === 'reading') === (b.status === 'reading')
  const okP = (b: Book) => pdf === 'all' || (pdf === 'ready') === b.pageCount > 0
  const okL = (b: Book) => len === 'any' || lenOf(b) === len
  const sorter = useMemo(() => {
    const by: Record<Sort, (a: Book, b: Book) => number> = {
      added: (a, b) => b.addedAt - a.addedAt,
      progress: (a, b) => bookProgress(b) - bookProgress(a) || b.addedAt - a.addedAt,
      title: (a, b) => bare(a.title).localeCompare(bare(b.title)),
      author: (a, b) => surname(a.author).localeCompare(surname(b.author)) || bare(a.title).localeCompare(bare(b.title)),
      short: (a, b) => (pagesOf(a) || 1e9) - (pagesOf(b) || 1e9),
    }
    return by[sort]
  }, [sort])

  if (!books) return <PageContainer><div className="skeleton h-8 w-48 rounded-sm" /></PageContainer>

  const shown = list.filter((b) => okQ(b) && okS(b) && okP(b) && okL(b)).sort(sorter)
  const reading = shown.filter((b) => b.status === 'reading')
  const later = shown.filter((b) => b.status !== 'reading')
  const nReading = list.filter((b) => b.status === 'reading').length
  const counts = {
    status: (k: Status) => list.filter((b) => okQ(b) && okP(b) && okL(b) && (k === 'all' || (k === 'reading') === (b.status === 'reading'))).length,
  }
  const sel = selId ? list.find((b) => b.id === selId) ?? null : null
  const applied: { label: string; drop: () => void }[] = [
    ...(status !== 'all' ? [{ label: STATUSES.find(([k]) => k === status)![1], drop: () => setStatus('all') }] : []),
    ...(pdf !== 'all' ? [{ label: PDFS.find(([k]) => k === pdf)![1], drop: () => setPdf('all') }] : []),
    ...(len !== 'any' ? [{ label: LENS.find(([k]) => k === len)![1], drop: () => setLen('any') }] : []),
  ]
  const clearAll = () => {
    setStatus('all')
    setPdf('all')
    setLen('any')
    setSort('added')
  }
  const groups = status === 'all'
    ? [{ label: 'Reading now', items: reading }, { label: 'Not started', items: later }].filter((g) => g.items.length)
    : [{ label: '', items: shown }]
  const pick = (id: string) => {
    setPanel(false)
    setSelId((x) => (x === id ? null : id))
  }

  const panelBody = (
    <FilterPanel
      sort={sort} setSort={setSort}
      status={status} setStatus={setStatus} statusCount={counts.status}
      pdf={pdf} setPdf={setPdf}
      len={len} setLen={setLen}
      canClear={applied.length > 0 || sort !== 'added'}
      clearAll={clearAll}
      showing={shown.length}
      done={() => setPanel(false)}
    />
  )

  return (
    <PageContainer className="max-w-[1180px]">
      <PageHeader
        eyebrow="Plan"
        title="Reading list"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={pickCsv} className="max-sm:hidden">
              <Upload className="size-4" /> Import a list
            </Button>
            <Button onClick={() => openAdd('manual')}>
              <BookPlus className="size-4" /> Add to list
            </Button>
          </div>
        }
      />

      {list.length === 0 ? (
        <EmptyList onAdd={() => openAdd('manual')} onImport={pickCsv} />
      ) : (
        <>
          <div className="flex gap-2">
            <label className="flex h-11 min-w-0 flex-1 cursor-text items-center gap-2.5 rounded-md border border-hairline bg-canvas-elevated px-3 text-mute focus-within:border-faint/60">
              <Search className="size-4 shrink-0" />
              <input
                ref={search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your list: a title or an author"
                className="h-full min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-faint"
              />
              {q ? (
                <button onClick={() => setQ('')} aria-label="Clear the search" className="grid size-6 place-items-center rounded-sm bg-hairline-soft text-mute hover:text-ink">
                  <X className="size-3.5" />
                </button>
              ) : (
                <kbd className="rounded-[4px] border border-hairline px-1.5 font-mono text-[11px] text-faint max-sm:hidden">/</kbd>
              )}
            </label>
            <div className="relative">
              <button
                onClick={() => {
                  if (mobile) setSelId(null)
                  setPanel((x) => !x)
                }}
                aria-expanded={panel}
                className={`flex h-11 items-center gap-2 rounded-md border px-3 text-body-sm transition-colors ${panel ? 'border-faint/60 bg-hairline-soft text-ink' : 'border-hairline bg-canvas-elevated text-body hover:text-ink'}`}
              >
                <SlidersHorizontal className="size-4" />
                <span className="max-sm:hidden">Filter &amp; sort</span>
                {applied.length > 0 && <span className="rounded-[5px] bg-hairline px-1.5 text-[11px] leading-[18px] text-ink">{applied.length}</span>}
                <ChevronDown className="size-3.5 text-mute" />
              </button>
              {panel && !mobile && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPanel(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                    className="absolute right-0 top-[52px] z-40 w-[380px] origin-top-right rounded-md border border-hairline bg-canvas-elevated shadow-floating"
                  >
                    {panelBody}
                  </motion.div>
                </>
              )}
            </div>
          </div>
          {mobile && (
            <Sheet open={panel} onClose={() => setPanel(false)} title="Filter & sort" flush>
              {panelBody}
            </Sheet>
          )}

          <div className="mb-5 mt-3.5 flex min-h-7 flex-wrap items-center gap-1.5">
            <span className="mr-1 text-body-sm text-mute">
              {shown.length === list.length
                ? `${list.length} ${list.length === 1 ? 'book' : 'books'}${nReading ? ` · ${nReading} reading` : ''}`
                : `${shown.length} of ${list.length} books`}
            </span>
            {applied.map((a) => (
              <button key={a.label} onClick={a.drop} className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-hairline bg-hairline-soft pl-2.5 pr-2 text-body-sm text-body hover:text-ink">
                {a.label} <X className="size-3" />
              </button>
            ))}
            <span className="ml-auto text-body-sm text-faint max-sm:hidden">Sorted by {SORTS.find(([k]) => k === sort)![1].toLowerCase()}</span>
          </div>

          <div className={`grid items-start gap-6 ${sel && !mobile ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
            <div className="min-w-0">
              {shown.length === 0 ? (
                <div className="rounded-md border border-dashed border-hairline px-6 py-10 text-center">
                  <p className="text-body-md text-mute">Nothing on your list matches that.</p>
                  <Button variant="outline" className="mt-4" onClick={() => openAdd('manual')}>
                    <Search className="size-4" /> Search the catalogue instead
                  </Button>
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.label || 'all'} className="mb-8">
                    {g.label && (
                      <div className="mb-3 flex items-baseline gap-2">
                        <h2 className="text-heading-md text-ink">{g.label}</h2>
                        <span className="text-body-sm tabular text-faint">{g.items.length}</span>
                      </div>
                    )}
                    <div className={`grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5 ${sel && !mobile ? 'xl:grid-cols-6' : 'lg:grid-cols-6 xl:grid-cols-7'}`}>
                      {g.items.map((b, i) => (
                        <CoverItem key={b.id} order={i} book={b} sessions={sessions} selected={sel?.id === b.id} onPick={() => pick(b.id)} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
            {sel && !mobile && (
              <aside key={sel.id} className="ir-slide sticky top-4 rounded-md border border-hairline bg-canvas-elevated p-5">
                <Detail book={sel} sessions={sessions} pph={pph} onClose={() => setSelId(null)} />
              </aside>
            )}
          </div>
          {mobile && (
            <Sheet open={!!sel} onClose={() => setSelId(null)}>
              {sel && <Detail book={sel} sessions={sessions} pph={pph} />}
            </Sheet>
          )}
        </>
      )}
    </PageContainer>
  )
}

function CoverItem({ book, sessions, selected, onPick, order = 0 }: { book: Book; sessions: Session[]; selected: boolean; onPick: () => void; order?: number }) {
  const reading = book.status === 'reading'
  const p = bookProgress(book)
  const noFile = book.pageCount === 0
  let meta: string
  if (reading) {
    const g = finishGuess(book, sessions)
    meta = `${Math.round(p * 100)}%${g.date != null ? ` · ends ${g.days === 0 ? 'today' : shortDate(g.date)}` : ''}`
  } else meta = noFile ? (book.estPages ? `${book.estPages} pages · no PDF yet` : 'No PDF yet') : `${book.pageCount} pages`
  return (
    <button onClick={onPick} className="ir-rise group min-w-0 text-left" style={{ '--i': order } as CSSProperties}>
      <div className={`relative rounded-[3px] transition-transform duration-200 group-hover:-translate-y-[3px] ${noFile ? 'outline-dashed outline-1 outline-offset-[3px] outline-faint/50' : ''}`}>
        <div className={`overflow-hidden rounded-[3px] shadow-cover transition-shadow ${selected ? 'ring-[1.5px] ring-ink' : ''}`}>
          <BookCover book={book} rounded="rounded-[3px]" />
        </div>
      </div>
      {reading && (
        <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-hairline" aria-hidden="true">
          <i className="ir-grow-x block h-full rounded-full bg-ink" style={{ width: `${Math.max(2, p * 100)}%`, ['--d' as string]: `${300 + order * 45}ms` }} />
        </span>
      )}
      <div className="mt-2.5 truncate text-label-sm text-ink">{book.title}</div>
      {book.author && <div className="truncate text-body-sm text-mute">{book.author}</div>}
      <div className={`truncate text-[11.5px] ${reading ? 'text-body' : 'text-faint'}`}>{meta}</div>
    </button>
  )
}

function Detail({ book, sessions, pph, onClose }: { book: Book; sessions: Session[]; pph: number; onClose?: () => void }) {
  const navigate = useNavigate()
  const { attach } = useImporter()
  const reading = book.status === 'reading'
  const noFile = book.pageCount === 0
  const p = bookProgress(book)
  const pages = pagesOf(book)
  const read = readCount(book)
  const g = reading ? finishGuess(book, sessions) : null
  const rows: [string, string][] = []
  if (reading && !noFile) {
    rows.push(['Pages', `${read} of ${book.pageCount}`])
    const left = Math.max(0, book.pageCount - read)
    if (left) rows.push(['Left', `${left} pages, about ${formatDurationLong((left / pph) * 3600)}`])
    if (g?.date != null) rows.push(['Ends', g.days === 0 ? 'Today' : `${shortDate(g.date)}, at your pace`])
    if (book.startedAt) rows.push(['Started', shortDate(book.startedAt)])
  } else {
    if (pages) rows.push(['Pages', String(pages)], ['At your pace', `about ${formatDurationLong((pages / pph) * 3600)}`])
    rows.push(['Added', new Date(book.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })])
  }
  const unread = unreadAhead(book)
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-mono-eyebrow text-mute">{reading ? `Reading now · ${Math.round(p * 100)}%` : noFile ? 'No PDF yet' : 'Not started'}</span>
        <div className="flex items-center gap-1">
          <BookMenu book={book} />
          {onClose && (
            <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-sm text-mute hover:bg-hairline-soft hover:text-ink">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-end gap-3.5">
        <div className="relative w-[96px] shrink-0 overflow-hidden rounded-[3px] shadow-cover">
          <BookCover book={book} rounded="rounded-[3px]" />
        </div>
        <div className="min-w-0">
          <div className="line-clamp-3 text-[18px] font-semibold leading-tight tracking-[-0.3px] text-ink">{book.title}</div>
          {book.author && <div className="mt-1 truncate text-body-sm text-mute">{book.author}</div>}
        </div>
      </div>
      {reading && !noFile && (
        <div className="mt-4 flex gap-[2px]" aria-hidden="true">
          {Array.from({ length: 30 }, (_, i) => <i key={i} className={`h-2.5 flex-1 rounded-[1px] ${i < Math.round(p * 30) ? 'bg-ink' : 'bg-hairline'}`} />)}
        </div>
      )}
      <div className="mt-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-t border-hairline py-2 text-body-sm">
            <span className="text-mute">{k}</span>
            <span className="text-right text-ink">{v}</span>
          </div>
        ))}
      </div>
      {noFile ? (
        <Button className="mt-4 w-full justify-center" onClick={() => attach(book.id)}>
          <FilePlus className="size-4" /> Add the PDF
        </Button>
      ) : reading ? (
        <Button className="mt-4 w-full justify-center" onClick={() => (unread != null ? continueFrom(navigate, book.id, unread) : navigate(`/read/${book.id}`))}>
          Continue{unread != null ? ` from p. ${unread + 1}` : ''} <ArrowRight className="size-4" />
        </Button>
      ) : (
        <Button className="mt-4 w-full justify-center" onClick={() => navigate(`/read/${book.id}`)}>
          <Play className="size-3.5 fill-current" /> Start reading
        </Button>
      )}
      <Button variant="outline" className="mt-2 w-full justify-center" onClick={() => navigate(`/book/${book.id}`)}>
        <NotebookPen className="size-4" /> {reading ? 'Notes & highlights' : 'Details'}
      </Button>
    </div>
  )
}

function FilterPanel(p: {
  sort: Sort; setSort: (s: Sort) => void
  status: Status; setStatus: (s: Status) => void; statusCount: (s: Status) => number
  pdf: Pdf; setPdf: (s: Pdf) => void
  len: Len; setLen: (s: Len) => void
  canClear: boolean; clearAll: () => void; showing: number; done: () => void
}) {
  return (
    <div>
      <Group title="Sort by">
        <div className="-mx-2 grid grid-cols-2 gap-0.5">
          {SORTS.map(([k, label]) => (
            <button key={k} onClick={() => p.setSort(k)} className={`flex h-8 items-center gap-2.5 rounded-sm px-2 text-left text-body-sm hover:bg-hairline-soft ${p.sort === k ? 'text-ink' : 'text-body'}`}>
              <span className={`grid size-3.5 shrink-0 place-items-center rounded-full border ${p.sort === k ? 'border-ink' : 'border-faint/70'}`}>
                {p.sort === k && <i className="size-1.5 rounded-full bg-ink" />}
              </span>
              {label}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Status">
        <Seg options={STATUSES} value={p.status} onChange={p.setStatus} count={p.statusCount} />
      </Group>
      <Group title="PDF">
        <Seg options={PDFS} value={p.pdf} onChange={p.setPdf} />
      </Group>
      <Group title="Length">
        <Seg options={LENS} value={p.len} onChange={p.setLen} />
        <div className="mt-2 text-[11.5px] text-faint">Short is under 200 pages, long is over 500.</div>
      </Group>
      <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
        <button onClick={p.clearAll} disabled={!p.canClear} className="text-body-sm text-mute hover:text-ink disabled:opacity-40">Clear all</button>
        <Button size="sm" onClick={p.done}>
          {p.showing === 0 ? 'Nothing matches' : `Show ${p.showing} ${p.showing === 1 ? 'book' : 'books'}`}
        </Button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-hairline px-4 py-3.5 [&+&]:border-t">
      <div className="mb-2.5 text-body-sm text-mute">{title}</div>
      {children}
    </div>
  )
}

function Seg<T extends string>({ options, value, onChange, count }: { options: [T, string][]; value: T; onChange: (v: T) => void; count?: (v: T) => number }) {
  return (
    <div className="flex rounded-sm border border-hairline bg-hairline-soft p-0.5">
      {options.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 text-[12px] transition-colors ${value === k ? 'bg-canvas-elevated text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
        >
          {value === k && !count && <Check className="size-3 max-sm:hidden" />}
          {label}
          {count && <span className="text-[11px] text-faint">{count(k)}</span>}
        </button>
      ))}
    </div>
  )
}

function EmptyList({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-hairline px-6 py-12 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-hairline-soft text-mute">
        <ListPlus className="size-5" />
      </div>
      <p className="mt-4 text-label-sm text-ink">Nothing on your list yet</p>
      <p className="mx-auto mt-1 max-w-sm text-body-md text-mute">Add the books you want to read, or bring a list you keep somewhere else.</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="outline" onClick={onImport}><Upload className="size-4" /> Import a list</Button>
        <Button onClick={onAdd}><BookPlus className="size-4" /> Add to list</Button>
      </div>
    </div>
  )
}

function shortDate(t: number) {
  const d = new Date(t)
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
  return days >= 0 && days < 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
