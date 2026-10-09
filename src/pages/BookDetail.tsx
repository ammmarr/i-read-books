import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, BookOpen, Copy, ExternalLink, FilePlus, Pencil, Trash2 } from 'lucide-react'
import { useImporter } from '../components/Importer'
import { readCount } from '../lib/pages'
import { db, type Highlight, type HighlightColor } from '../db/db'
import type { OpenAt } from '../reader/Reader'
import { bookProgress, renameBook, setPagesRead, setStatus } from '../db/books'
import { PageContainer } from '../components/AppShell'
import { BookCover } from '../components/BookCover'
import { useBookActions } from '../components/BookActions'
import { BarChart } from '../components/charts/BarChart'
import { Button } from '../components/ui/Button'
import { ProgressBar } from '../components/ui/Progress'
import { Segmented } from '../components/ui/Segmented'
import { Sheet } from '../components/ui/Sheet'
import { useToast } from '../components/ui/Toast'
import { addDays, bookStats, dailyTotals, dayKey, startOfDay, summarize } from '../lib/stats'
import { formatBytes, formatDate, formatDuration, formatDurationLong, relativeTime, pluralize } from '../lib/format'
import { HL_COLORS, swatchOf } from '../reader/HighlightTools'
import { RecapSection } from '../components/recap/RecapSection'

export default function BookDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const book = useLiveQuery(() => (id ? db.books.get(id) : undefined), [id])
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? []
  const highlights = useLiveQuery(() => (id ? db.highlights.where('bookId').equals(id).toArray() : []), [id]) ?? []
  const { remove } = useBookActions()
  const { attach } = useImporter()
  const [editing, setEditing] = useState(false)
  const [editingProgress, setEditingProgress] = useState(false)
  const [color, setColor] = useState<HighlightColor | 'all'>('all')

  const own = useMemo(() => sessions.filter((s) => s.bookId === id), [sessions, id])
  const chart = useMemo(() => {
    const daily = dailyTotals(own)
    const today = startOfDay(Date.now())
    return Array.from({ length: 30 }, (_, i) => {
      const ts = addDays(today, i - 29)
      const d = new Date(ts)
      const t = daily.get(dayKey(ts))
      return {
        key: dayKey(ts),
        label: String(d.getDate()),
        title: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
        value: (t?.seconds ?? 0) / 60,
        detail: t?.pages ? `${t.pages} pages` : undefined,
        isCurrent: i === 29,
      }
    })
  }, [own])

  if (book === undefined) return <PageContainer><div className="skeleton h-64 rounded-md" /></PageContainer>
  if (!book)
    return (
      <PageContainer className="text-center">
        <p className="text-heading-md text-ink">This book isn’t in your library</p>
        <Button className="mt-6" onClick={() => navigate('/')}>Back to library</Button>
      </PageContainer>
    )

  const overall = summarize(sessions, 0, Infinity).pagesPerHour
  const st = bookStats(book, sessions, overall)
  const p = bookProgress(book)
  const list = highlights.filter((h) => color === 'all' || h.color === color).sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1])

  // Opens the reader at the note; where you left off reading stays put
  // ("Back to page N" there takes you back).
  const openAt = (h: Highlight) => {
    const at: OpenAt = { page: h.page, top: h.rects[0]?.[1] ?? 0, highlightId: h.id }
    navigate(`/read/${book.id}`, { state: { openAt: at } })
  }

  const copyAll = async () => {
    const md = [`# ${book.title}${book.author ? ` — ${book.author}` : ''}`, '', ...list.flatMap((h) => [`> ${h.text}`, `— p. ${h.page + 1}`, ...(h.note ? ['', h.note] : []), ''])].join('\n')
    await navigator.clipboard?.writeText(md).catch(() => {})
    toast({ message: `${list.length} highlights copied`, description: 'As Markdown — paste anywhere.' })
  }

  return (
    <PageContainer className="max-w-[960px]">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 rounded-sm text-label-sm text-body transition-colors hover:text-ink">
        <ArrowLeft className="size-4" /> Library
      </Link>

      <div className="flex flex-col gap-8 sm:flex-row">
        <motion.div
          initial={{ opacity: 0, y: 16, rotate: -2 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          whileHover={{ rotate: -1.5, y: -4 }}
          className="w-[150px] shrink-0 self-center rounded-[4px] shadow-cover-lift sm:w-[190px] sm:self-start"
        >
          <BookCover book={book} />
        </motion.div>

        <div className="min-w-0 flex-1">
          <div className="text-mono-eyebrow text-mute">
            {book.status === 'finished' ? 'Finished' : book.status === 'reading' ? 'Reading' : 'Up next'}
          </div>
          <div className="group mt-2 flex items-start gap-2">
            <h1 className="text-[26px] font-semibold leading-8 tracking-[-1px] text-ink md:text-heading-lg">{book.title}</h1>
            <button onClick={() => setEditing(true)} aria-label="Edit title and author" className="mt-1.5 shrink-0 rounded-full p-1.5 text-faint opacity-0 transition-opacity hover:bg-hairline-soft hover:text-ink group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
              <Pencil className="size-4" />
            </button>
          </div>
          {book.author && <p className="mt-1 text-body-lg text-body">{book.author}</p>}
          <p className="mt-2 text-body-sm text-mute">
            {book.pageCount > 0
              ? `${pluralize(book.pageCount, 'page')} · ${formatBytes(book.fileSize)} · added ${formatDate(book.addedAt)}`
              : `On your reading list${book.estPages ? ` · about ${book.estPages} pages` : ''} · added ${formatDate(book.addedAt)}`}
            {book.sourceUrl && (
              <>
                {' · '}
                <a href={book.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">
                  Store page <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </p>

          {book.pageCount > 0 && <div className="mt-6 max-w-md">
            <div className="mb-2 flex justify-between text-body-sm">
              <span className="text-ink">
                <span className="font-medium">{Math.round(p * 100)}%</span> <span className="text-mute">· {readCount(book)} of {book.pageCount} pages read</span>
                <button onClick={() => setEditingProgress(true)} className="ml-2 text-link hover:underline">
                  Edit
                </button>
              </span>
              {st.remainingSeconds ? <span className="text-mute">~{formatDurationLong(st.remainingSeconds)} left</span> : null}
            </div>
            <ProgressBar value={p} />
          </div>}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {book.pageCount > 0 ? (
              <Button size="lg" onClick={() => navigate(`/read/${book.id}`)}>
                <BookOpen className="size-4" />
                {book.status === 'finished' ? 'Read again' : book.lastOpenedAt ? 'Resume' : 'Start reading'}
              </Button>
            ) : (
              <Button size="lg" onClick={() => attach(book.id)}>
                <FilePlus className="size-4" /> Add PDF
              </Button>
            )}
            <Segmented
              value={book.status === 'none' ? 'queued' : book.status}
              onChange={(s) => setStatus(book.id, s)}
              ariaLabel="Status"
              options={[
                { value: 'queued', label: 'Up next' },
                { value: 'reading', label: 'Reading' },
                { value: 'finished', label: 'Finished' },
              ]}
            />
          </div>
        </div>
      </div>

      {book.pageCount > 0 && <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Time spent" value={st.seconds ? formatDuration(st.seconds, { short: true }) : '—'} />
        <Stat label="Sessions" value={String(st.sessions)} sub={st.lastRead ? `last ${relativeTime(st.lastRead)}` : undefined} />
        <Stat label="Your pace" value={st.pagesPerHour ? `${Math.round(st.pagesPerHour)}` : '—'} sub="pages per hour" />
        <Stat label={book.status === 'finished' ? 'Finished' : 'Started'} value={book.finishedAt && book.status === 'finished' ? formatDate(book.finishedAt) : book.startedAt ? formatDate(book.startedAt) : '—'} />
      </div>}

      {own.length > 0 && (
        <section className="mt-4 rounded-md border border-hairline bg-canvas-elevated p-5 sm:p-6">
          <h2 className="text-heading-md text-ink">Last 30 days</h2>
          <p className="mb-6 text-body-md text-mute">Minutes spent in this book each day</p>
          <BarChart
            ariaLabel={`Minutes reading ${book.title} per day, last 30 days`}
            data={chart}
            height={160}
            format={(m) => formatDurationLong(m * 60)}
            tick={(m) => `${Math.round(m)}m`}
          />
        </section>
      )}

      {book.pageCount > 0 && <RecapSection book={book} onJumpToHighlight={openAt} />}

      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-heading-md text-ink">
            Highlights & notes <span className="text-body-md tabular text-faint">{highlights.length}</span>
          </h2>
          {highlights.length > 0 && (
            <>
              <div className="flex items-center gap-1">
                <button onClick={() => setColor('all')} className={`h-7 rounded-full px-2.5 text-body-sm font-medium transition-colors ${color === 'all' ? 'bg-ink text-canvas' : 'text-body hover:bg-hairline-soft'}`}>
                  All
                </button>
                {HL_COLORS.filter((c) => highlights.some((h) => h.color === c.key)).map((c) => (
                  <button key={c.key} aria-label={`Only ${c.label}`} onClick={() => setColor(c.key)} className={`grid size-7 place-items-center rounded-full ${color === c.key ? 'bg-hairline' : 'hover:bg-hairline-soft'}`}>
                    <span className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: c.swatch }} />
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={copyAll}>
                <Copy className="size-3.5" /> Copy as Markdown
              </Button>
            </>
          )}
        </div>
        {highlights.length === 0 ? (
          <div className="rounded-md border border-dashed border-hairline px-6 py-10 text-center text-body-md text-mute">
            Select text while reading to highlight it. Your highlights and notes collect here.
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            <AnimatePresence initial={false}>
              {list.map((h) => (
                <motion.li key={h.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className="group relative">
                  <button onClick={() => openAt(h)} className="flex h-full w-full gap-3 rounded-md border border-hairline bg-canvas-elevated p-4 text-left transition-colors hover:border-faint/40">
                    <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ background: swatchOf(h.color) }} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-6 text-body-md text-ink">{h.text}</span>
                      {h.note && <span className="mt-2 block rounded-sm bg-hairline-soft px-2.5 py-2 text-body-sm text-body">{h.note}</span>}
                      <span className="mt-2 block text-body-sm text-faint">Page {h.page + 1} · {relativeTime(h.createdAt)}</span>
                    </span>
                  </button>
                  <button
                    aria-label="Delete highlight"
                    onClick={async () => {
                      await db.highlights.delete(h.id)
                      toast({ message: 'Highlight deleted', action: { label: 'Undo', onClick: () => db.highlights.put(h) } })
                    }}
                    className="absolute right-2 top-2 grid size-8 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:bg-error/10 hover:text-error group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      <div className="mt-14 border-t border-hairline pt-6">
        <Button
          variant="ghost"
          className="text-error hover:bg-error/10 hover:text-error"
          onClick={async () => {
            await remove(book)
            navigate('/')
          }}
        >
          <Trash2 className="size-4" /> Remove from library
        </Button>
      </div>

      <EditProgress open={editingProgress} onClose={() => setEditingProgress(false)} read={readCount(book)} total={book.pageCount} onSave={(n) => setPagesRead(book.id, n)} />
      <EditBook open={editing} onClose={() => setEditing(false)} title={book.title} author={book.author} onSave={(t, a) => renameBook(book.id, t, a)} />
    </PageContainer>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-hairline bg-canvas-elevated p-4">
      <div className="text-body-sm text-mute">{label}</div>
      <div className="mt-2 text-[22px] font-semibold tracking-[-0.8px] text-ink">{value}</div>
      {sub && <div className="text-body-sm text-mute">{sub}</div>}
    </div>
  )
}

function EditBook({ open, onClose, title, author, onSave }: { open: boolean; onClose: () => void; title: string; author: string; onSave: (t: string, a: string) => void }) {
  const [t, setT] = useState(title)
  const [a, setA] = useState(author)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit details"
      width={420}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              onSave(t, a)
              onClose()
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(t, a)
          onClose()
        }}
        className="space-y-4 pt-1"
      >
        <Field label="Title" value={t} onChange={setT} autoFocus />
        <Field label="Author" value={a} onChange={setA} placeholder="Unknown" />
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

function Field({ label, value, onChange, autoFocus, placeholder }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-label-sm text-ink">{label}</span>
      <input
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-sm border border-hairline bg-canvas-elevated px-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
      />
    </label>
  )
}

function EditProgress({ open, onClose, read, total, onSave }: { open: boolean; onClose: () => void; read: number; total: number; onSave: (n: number) => void }) {
  const [n, setN] = useState(read)
  useEffect(() => {
    if (open) setN(read)
  }, [open, read])
  const pct = total ? Math.round((n / total) * 100) : 0
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit progress"
      description="Set how many pages you’ve read. It replaces the tracked progress on all your devices."
      width={420}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(n)
              onClose()
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="pt-2">
        <div className="flex items-baseline justify-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={total}
            value={n}
            onChange={(e) => setN(Math.max(0, Math.min(total, parseInt(e.target.value || '0', 10))))}
            aria-label="Pages read"
            className="w-24 rounded-sm border border-hairline bg-canvas-elevated py-1 text-center text-[32px] font-semibold tabular text-ink outline-none focus:border-link focus:ring-3 focus:ring-link/15"
          />
          <span className="text-body-md text-mute">of {total} pages · {pct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          aria-label="Pages read"
          className="scrubber mt-5"
          style={{ '--fill': `${total ? (n / total) * 100 : 0}%` } as React.CSSProperties}
        />
        <p className="mt-3 text-body-sm text-faint">Counts pages 1–{Math.max(1, n)} as read. Reading from here on keeps adding to it as usual.</p>
      </div>
    </Sheet>
  )
}
