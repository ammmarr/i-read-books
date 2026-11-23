import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownUp, BookOpen, FilePlus, Globe, Plus, Search, X } from 'lucide-react'
import { SubstackContinueCard, SubstackShelf } from './LibrarySubstack'
import { ContinueCard, Shelf, TodayCard, type Arrange } from './LibraryShelf'
import { db, type Book, type BookStatus } from '../db/db'
import { bookProgress } from '../db/books'
import { PageContainer } from '../components/AppShell'
import { BookCover } from '../components/BookCover'
import { BookMenu } from '../components/BookActions'
import { useImporter } from '../components/Importer'
import { Button } from '../components/ui/Button'
import { Menu } from '../components/ui/Menu'
import { ProgressBar } from '../components/ui/Progress'
import { Segmented } from '../components/ui/Segmented'
import { useWebReads } from '../lib/web'
import { greeting, pluralize } from '../lib/format'
import { useIsTouch } from '../lib/hooks'
import { useAuth } from '../lib/supabase'

type Filter = 'all' | BookStatus
type View = 'books' | 'substack'
type Sort = 'recent' | 'added' | 'title' | 'progress'
/** The shelf of spines (by shelf or by colour), or the covers grid it replaced. */
type Layout = Arrange | 'covers'
const LAYOUTS: Layout[] = ['shelf', 'colour', 'covers']

const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Recently read' },
  { key: 'added', label: 'Recently added' },
  { key: 'title', label: 'Title' },
  { key: 'progress', label: 'Progress' },
]

export default function Library() {
  const books = useLiveQuery(() => db.books.toArray(), [])
  const sessions = useLiveQuery(() => db.sessions.toArray(), [])
  const reads = useWebReads()
  const [view, setViewState] = useState<View>(() => {
    try {
      return (localStorage.getItem('irb-library-view') as View) || 'books'
    } catch {
      return 'books'
    }
  })
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem('irb-library-view', v)
    } catch {
      /* ignore */
    }
  }
  // The sidebar's Library and Web links say which side to show (?view=books / ?view=web).
  const [params, setParams] = useSearchParams()
  const asked = params.get('view')
  const [seen, setSeen] = useState<string | null>(null)
  if (asked !== seen) {
    setSeen(asked)
    if (asked === 'web' && view !== 'substack') setView('substack')
    else if (asked === 'books' && view !== 'books') setView('books')
  }
  const [pub, setPub] = useState<string | null>(null)
  const { pick } = useImporter()
  const { name } = useAuth()
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('irb-sort') as Sort) || 'recent')
  const [query, setQuery] = useState('')
  const [layout, setLayoutState] = useState<Layout>(() => {
    try {
      const v = localStorage.getItem('irb-library-arrange') as Layout
      return LAYOUTS.includes(v) ? v : 'shelf'
    } catch {
      return 'shelf'
    }
  })
  const setLayout = (v: Layout) => {
    setLayoutState(v)
    try {
      localStorage.setItem('irb-library-arrange', v)
    } catch {
      /* ignore */
    }
  }

  const current = useMemo(
    () =>
      books
        ?.filter((b) => b.lastOpenedAt && b.status !== 'finished')
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0],
    [books],
  )

  const visible = useMemo(() => {
    if (!books) return []
    const q = query.trim().toLowerCase()
    return books
      .filter((b) => filter === 'all' || b.status === filter)
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
      .sort((a, b) => {
        switch (sort) {
          case 'recent': return (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt)
          case 'added': return b.addedAt - a.addedAt
          case 'title': return a.title.localeCompare(b.title)
          case 'progress': return bookProgress(b) - bookProgress(a)
        }
      })
  }, [books, filter, sort, query])
  // The book taken off the shelf: your pick while it's still there; otherwise the one you're reading, else the first.
  const [picked, setSelected] = useState<string | null>(null)
  const selected = picked && books?.some((b) => b.id === picked) ? picked : (current?.id ?? books?.[0]?.id ?? null)

  if (!books || !reads) return <LibrarySkeleton />
  if (books.length === 0 && reads.length === 0) return <EmptyLibrary onAdd={pick} />

  const count = (s: BookStatus) => books.filter((b) => b.status === s).length

  return (
    <PageContainer>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-mono-eyebrow text-mute">
          {greeting()}
          {name ? `, ${name.split(' ')[0]}` : ''} · {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </div>
        <Segmented<View>
          size="sm"
          value={view}
          onChange={(v) => {
            setView(v)
            setParams({ view: v === 'substack' ? 'web' : 'books' }, { replace: true })
          }}
          ariaLabel="Books or the web"
          options={[
            { value: 'books', label: <span className="inline-flex items-center gap-1.5"><BookOpen className="size-3.5" /> Books</span> },
            // Substack, X articles and any page you turn on in the extension (the value stays 'substack' for saved choices).
            { value: 'substack', label: <span className="inline-flex items-center gap-1.5"><Globe className="size-3.5" /> Web</span> },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {view === 'substack' ? (
          <SubstackContinueCard reads={reads} onPick={setPub} />
        ) : current ? (
          <ContinueCard book={current} sessions={sessions ?? []} />
        ) : (
          <PickSomething books={books} />
        )}
        <TodayCard sessions={sessions ?? []} reads={reads} />
      </div>

      {view === 'substack' ? (
        <SubstackShelf reads={reads} pub={pub} setPub={setPub} />
      ) : (
      <>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="text-heading-md text-ink">Your shelf</h2>
        <div className="-mx-4 order-last w-full overflow-x-auto px-4 pb-1 sm:order-none sm:mx-0 sm:w-auto sm:px-0 sm:pb-0">
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter books"
            options={[
              { value: 'all', label: <>All <Count n={books.length} /></> },
              { value: 'reading', label: <>Reading <Count n={count('reading')} /></> },
              { value: 'queued', label: <>Up next <Count n={count('queued')} /></> },
              { value: 'finished', label: <>Finished <Count n={count('finished')} /></> },
            ]}
          />
        </div>
        <div className="relative ml-auto w-40 sm:w-52">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your books"
            className="h-9 w-full rounded-sm border border-hairline bg-canvas-elevated pl-9 pr-8 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-faint hover:text-ink">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {layout === 'covers' && (
          <Menu
            label="Sort by"
            items={SORTS.map((s) => ({
              label: s.label,
              checked: sort === s.key,
              onSelect: () => {
                setSort(s.key)
                try { localStorage.setItem('irb-sort', s.key) } catch { /* ignore */ }
              },
            }))}
            trigger={(p) => (
              <Button {...p} variant="outline" size="md" className="px-3">
                <ArrowDownUp className="size-4 text-body" />
                <span className="hidden sm:inline">{SORTS.find((s) => s.key === sort)?.label}</span>
              </Button>
            )}
          />
        )}
        <Segmented<Layout>
          size="sm"
          value={layout}
          onChange={setLayout}
          ariaLabel="Arrange your books"
          options={[
            { value: 'shelf', label: 'Shelf', title: 'Reading and up next, then finished' },
            { value: 'colour', label: 'Colour', title: 'Every book by the colour of its spine' },
            { value: 'covers', label: 'Covers', title: 'Covers in a grid, sorted as you like' },
          ]}
        />
      </div>

      {layout === 'covers' ? (
        <>
          <motion.div layout className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 md:gap-x-6">
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.map((b, i) => (
                <BookCard key={b.id} book={b} index={i} />
              ))}
            </AnimatePresence>
          </motion.div>
          {visible.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-16 text-center">
              <p className="text-label-sm text-ink">{query ? `No books match “${query}”` : 'Nothing here yet'}</p>
              <p className="mt-1 text-body-md text-mute">{query ? 'Try a different title or author.' : 'Books you move to this shelf will show up here.'}</p>
            </motion.div>
          )}
        </>
      ) : (
        <Shelf books={books} sessions={sessions ?? []} filter={filter} query={query} arrange={layout} selected={selected} onSelect={setSelected} />
      )}
      </>
      )}
    </PageContainer>
  )
}

function Count({ n }: { n: number }) {
  return <span className="tabular text-faint">{n}</span>
}

function BookCard({ book, index }: { book: Book; index: number }) {
  const navigate = useNavigate()
  const touch = useIsTouch()
  const progress = bookProgress(book)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: Math.min(index, 12) * 0.035, type: 'spring', stiffness: 300, damping: 28 } }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      className="group relative flex flex-col"
    >
      <motion.button
        onClick={() => navigate(book.pageCount > 0 ? `/read/${book.id}` : `/book/${book.id}`)}
        whileHover={touch ? undefined : { y: -6 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 26 }}
        className="relative block w-full rounded-[4px] text-left shadow-cover transition-shadow duration-300 hover:shadow-cover-lift"
        aria-label={`Open ${book.title}`}
      >
        <BookCover book={book} />
        {book.status === 'finished' && (
          <span className="absolute right-2 top-2 rounded-full bg-ink/85 px-2 py-0.5 text-[11px] font-medium text-canvas backdrop-blur">
            Finished
          </span>
        )}
        {book.pageCount === 0 && book.status !== 'finished' && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-canvas-elevated/90 px-2 py-0.5 text-[11px] font-medium text-body shadow-whisper backdrop-blur">
            <FilePlus className="size-3" /> No PDF yet
          </span>
        )}
      </motion.button>
      {progress > 0 && progress < 1 && <ProgressBar value={progress} thin className="mt-3" />}
      <div className={`flex items-start gap-1 ${progress > 0 && progress < 1 ? 'mt-2' : 'mt-3'}`}>
        <Link to={`/book/${book.id}`} className="min-w-0 flex-1">
          <div className="line-clamp-2 text-label-sm text-ink hover:underline hover:decoration-hairline hover:underline-offset-4">{book.title}</div>
          <div className="mt-0.5 truncate text-body-sm text-mute">
            {progress > 0 && progress < 1 ? `${Math.round(progress * 100)}% · ` : ''}
            {book.author || (book.pageCount ? pluralize(book.pageCount, 'page') : 'On your list')}
          </div>
        </Link>
        <BookMenu book={book} className={`-mr-1.5 -mt-1 shrink-0 ${touch ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100'}`} />
      </div>
    </motion.div>
  )
}

function PickSomething({ books }: { books: Book[] }) {
  const navigate = useNavigate()
  const readable = books.filter((b) => b.pageCount > 0)
  const next = readable.filter((b) => b.status === 'queued').sort((a, b) => a.queueOrder - b.queueOrder)[0] ?? readable[0]
  if (!next) return <AddFirstPdf />
  return (
    <div className="flex items-center gap-5 rounded-md border border-hairline bg-canvas-elevated p-6">
      <div className="w-[72px] shrink-0 rounded-[4px] shadow-cover">
        <BookCover book={next} />
      </div>
      <div className="min-w-0">
        <div className="text-mono-eyebrow text-mute">Start something</div>
        <h2 className="mt-2 line-clamp-2 text-heading-md text-ink">{next.title}</h2>
        <Button className="mt-4" onClick={() => navigate(`/read/${next.id}`)}>
          <BookOpen className="size-4" /> Start reading
        </Button>
      </div>
    </div>
  )
}

function EmptyLibrary({ onAdd }: { onAdd: () => void }) {
  const touch = useIsTouch()
  const covers = ['#e8e2d4', '#d3e5ff', '#171717', '#f2f2f2', '#ffd9ec']
  return (
    <PageContainer className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
      <div className="relative mb-10 h-40 w-64">
        {covers.map((c, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 30, rotate: 0 }}
            animate={{ opacity: 1, y: [0, -4, 0], rotate: (i - 2) * 9 }}
            transition={{
              opacity: { delay: i * 0.08 },
              rotate: { delay: i * 0.08, type: 'spring', stiffness: 120, damping: 14 },
              y: { delay: 0.8 + i * 0.2, duration: 3.2, repeat: Infinity, ease: 'easeInOut' },
            }}
            className="absolute bottom-0 left-1/2 h-32 w-[88px] origin-bottom rounded-[4px] border border-black/5 shadow-cover"
            style={{ background: c, marginLeft: -44 + (i - 2) * 30 }}
          />
        ))}
      </div>
      <h1 className="text-heading-lg text-ink">Your shelf is waiting</h1>
      <p className="mt-3 max-w-md text-body-lg text-body">
        Add a PDF or EPUB to start reading. Everything — books, highlights, reading time — stays privately on this device.
      </p>
      <Button size="lg" className="mt-8" onClick={onAdd}>
        <Plus className="size-4" /> Add your first book
      </Button>
      {!touch && <p className="mt-4 text-body-sm text-faint">or drop PDF or EPUB files anywhere on this window</p>}
    </PageContainer>
  )
}

function LibrarySkeleton() {
  return (
    <PageContainer>
      <div className="skeleton mb-4 h-3 w-40 rounded-full" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="skeleton h-[200px] rounded-md" />
        <div className="skeleton h-[200px] rounded-md" />
      </div>
      <div className="mt-12 grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton aspect-[2/3] rounded-[4px]" />
        ))}
      </div>
    </PageContainer>
  )
}

/** Shown in the hero slot when the library only has reading-list entries. */
function AddFirstPdf() {
  const { pick } = useImporter()
  return (
    <div className="flex items-center gap-5 rounded-md border border-dashed border-hairline bg-canvas-elevated p-6">
      <div className="grid size-14 shrink-0 place-items-center rounded-full bg-hairline-soft text-mute">
        <FilePlus className="size-6" />
      </div>
      <div className="min-w-0">
        <div className="text-mono-eyebrow text-mute">Start something</div>
        <p className="mt-2 text-label-sm text-ink">Add a PDF for any book on your list</p>
        <p className="mt-0.5 text-body-md text-mute">It snaps onto the matching entry automatically.</p>
        <Button className="mt-4" onClick={pick}>
          <Plus className="size-4" /> Add PDF
        </Button>
      </div>
    </div>
  )
}
