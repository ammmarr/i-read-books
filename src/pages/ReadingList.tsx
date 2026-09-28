import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { BookCheck, BookOpen, FilePlus, GripVertical, ListPlus, Play } from 'lucide-react'
import { useImporter } from '../components/Importer'
import { db, type Book, type Session } from '../db/db'
import { bookProgress, reorderQueue } from '../db/books'
import { PageContainer, PageHeader } from '../components/AppShell'
import { BookCover } from '../components/BookCover'
import { BookMenu } from '../components/BookActions'
import { Button } from '../components/ui/Button'
import { ProgressBar } from '../components/ui/Progress'
import { bookStats, summarize } from '../lib/stats'
import { formatDate, formatDuration, formatDurationLong, pluralize } from '../lib/format'

/** Assumed pace before we've measured yours: ~40 pages an hour. */
const DEFAULT_PPH = 40

export default function ReadingList() {
  const books = useLiveQuery(() => db.books.toArray(), [])
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? []
  const pph = summarize(sessions, 0, Infinity).pagesPerHour || DEFAULT_PPH

  if (!books) return <PageContainer><div className="skeleton h-8 w-48 rounded-sm" /></PageContainer>

  const reading = books.filter((b) => b.status === 'reading').sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
  const queued = books.filter((b) => b.status === 'queued').sort((a, b) => a.queueOrder - b.queueOrder)
  const finished = books.filter((b) => b.status === 'finished').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  const queuePages = queued.reduce((a, b) => a + b.pageCount, 0)

  return (
    <PageContainer className="max-w-[880px]">
      <PageHeader
        eyebrow="Plan"
        title="Reading list"
        subtitle={
          queued.length
            ? `${queued.length} ${queued.length === 1 ? 'book' : 'books'} up next · about ${formatDurationLong((queuePages / pph) * 3600)} of reading`
            : 'Line up what you want to read next.'
        }
      />

      {reading.length > 0 && (
        <Section title="Currently reading" count={reading.length}>
          <div className="grid gap-3 sm:grid-cols-2">
            {reading.map((b, i) => (
              <ReadingCard key={b.id} book={b} sessions={sessions} pph={pph} index={i} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Up next" count={queued.length} hint={queued.length > 1 ? 'Drag to reorder' : undefined}>
        {queued.length ? <Queue books={queued} pph={pph} /> : <EmptyQueue hasBooks={books.length > 0} />}
      </Section>

      {finished.length > 0 && (
        <Section title="Finished" count={finished.length}>
          <ul className="divide-y divide-hairline rounded-md border border-hairline bg-canvas-elevated">
            {finished.map((b) => {
              const st = bookStats(b, sessions)
              return (
                <li key={b.id} className="flex items-center gap-4 px-4 py-3">
                  <Link to={`/book/${b.id}`} className="w-10 shrink-0 rounded-[3px] shadow-cover">
                    <BookCover book={b} rounded="rounded-[3px]" />
                  </Link>
                  <Link to={`/book/${b.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-label-sm text-ink">{b.title}</div>
                    <div className="truncate text-body-sm text-mute">
                      {b.finishedAt ? `Finished ${formatDate(b.finishedAt)}` : 'Finished'}
                      {st.seconds > 60 && ` · ${formatDuration(st.seconds, { short: true })} reading`}
                    </div>
                  </Link>
                  <BookCheck className="size-4 shrink-0 text-success" />
                  <BookMenu book={b} />
                </li>
              )
            })}
          </ul>
        </Section>
      )}
    </PageContainer>
  )
}

function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="mb-10">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-heading-md text-ink">{title}</h2>
        <span className="text-body-md tabular text-faint">{count}</span>
        {hint && <span className="ml-auto text-body-sm text-faint">{hint}</span>}
      </div>
      {children}
    </motion.section>
  )
}

function ReadingCard({ book, sessions, pph, index }: { book: Book; sessions: Session[]; pph: number; index: number }) {
  const navigate = useNavigate()
  const st = bookStats(book, sessions, pph)
  const p = bookProgress(book)
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group flex gap-4 rounded-md border border-hairline bg-canvas-elevated p-4 transition-colors hover:border-faint/40"
    >
      <button onClick={() => navigate(book.pageCount > 0 ? `/read/${book.id}` : `/book/${book.id}`)} className="w-14 shrink-0 self-start rounded-[3px] shadow-cover transition-transform duration-300 group-hover:-rotate-2">
        <BookCover book={book} rounded="rounded-[3px]" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-1">
          <Link to={`/book/${book.id}`} className="min-w-0 flex-1">
            <div className="line-clamp-2 text-label-sm text-ink">{book.title}</div>
            <div className="truncate text-body-sm text-mute">{book.author || (book.pageCount ? pluralize(book.pageCount, 'page') : 'No PDF yet')}</div>
          </Link>
          <BookMenu book={book} className="-mr-2 -mt-1" />
        </div>
        <div className="mt-auto pt-3">
          <ProgressBar value={p} thin />
          <div className="mt-1.5 flex justify-between text-body-sm text-mute">
            <span className="tabular">{Math.round(p * 100)}%</span>
            <span>{st.remainingSeconds ? `~${formatDurationLong(st.remainingSeconds)} left` : ''}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function Queue({ books, pph }: { books: Book[]; pph: number }) {
  const [order, setOrder] = useState(books)
  const ids = books.map((b) => b.id).join()
  // Re-sync when the queue changes elsewhere (added/removed books).
  useEffect(() => setOrder(books), [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books])
  return (
    <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-2">
      <AnimatePresence initial={false}>
        {order.map((b, i) => (
          <QueueItem key={b.id} book={byId.get(b.id) ?? b} position={i + 1} pph={pph} onDrop={() => reorderQueue(order.map((x) => x.id))} />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  )
}

function QueueItem({ book, position, pph, onDrop }: { book: Book; position: number; pph: number; onDrop: () => void }) {
  const controls = useDragControls()
  const navigate = useNavigate()
  const { attach } = useImporter()
  const [dragging, setDragging] = useState(false)
  return (
    <Reorder.Item
      value={book}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false)
        onDrop()
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, scale: dragging ? 1.02 : 1 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
      className={`relative flex items-center gap-3 rounded-md border bg-canvas-elevated py-2.5 pl-1.5 pr-3 transition-shadow sm:gap-4 ${
        dragging ? 'z-10 border-faint/40 shadow-floating' : 'border-hairline'
      }`}
    >
      <button
        aria-label="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
        className="grid h-10 w-7 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-faint hover:text-ink active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 shrink-0 text-center font-mono text-[13px] tabular text-mute">{position}</span>
      <div className="w-10 shrink-0 rounded-[3px] shadow-cover">
        <BookCover book={book} rounded="rounded-[3px]" />
      </div>
      <Link to={`/book/${book.id}`} className="min-w-0 flex-1">
        <div className="truncate text-label-sm text-ink">{book.title}</div>
        <div className="truncate text-body-sm text-mute">
          {book.author ? `${book.author} · ` : ''}
          {book.pageCount || book.estPages
            ? `${pluralize(book.pageCount || book.estPages!, 'page')} · ~${formatDurationLong(((book.pageCount || book.estPages!) / pph) * 3600)}`
            : 'No PDF yet'}
        </div>
      </Link>
      {book.pageCount === 0 ? (
        <Button size="sm" variant={position === 1 ? 'default' : 'ghost'} onClick={() => attach(book.id)} className={`shrink-0 ${position === 1 ? '' : 'hidden sm:inline-flex'}`}>
          <FilePlus className="size-3.5" /> <span className="hidden sm:inline">Add PDF</span>
        </Button>
      ) : position === 1 ? (
        <Button size="sm" onClick={() => navigate(`/read/${book.id}`)} className="shrink-0">
          <Play className="size-3.5 fill-current" /> <span className="hidden sm:inline">Start</span>
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => navigate(`/read/${book.id}`)} className="hidden shrink-0 sm:inline-flex">
          <BookOpen className="size-3.5" /> Start
        </Button>
      )}
      <BookMenu book={book} />
    </Reorder.Item>
  )
}

function EmptyQueue({ hasBooks }: { hasBooks: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-hairline px-6 py-10 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-hairline-soft text-mute">
        <ListPlus className="size-5" />
      </div>
      <p className="mt-4 text-label-sm text-ink">Nothing queued</p>
      <p className="mx-auto mt-1 max-w-sm text-body-md text-mute">
        {hasBooks ? 'Use the ••• menu on any book and choose “Up next” to plan your next read.' : 'New books you add land here automatically.'}
      </p>
    </div>
  )
}
