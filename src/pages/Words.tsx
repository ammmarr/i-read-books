import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { BookA, BookOpen, ChevronDown, Copy, ExternalLink, Search, Trash2, Volume2 } from 'lucide-react'
import { db, type Book } from '../db/db'
import { PageContainer, PageHeader } from '../components/AppShell'
import { Button } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { useToast } from '../components/ui/Toast'
import { canSpeak, MeaningBody, sayWord, useMeaning, webSearchUrl } from '../components/Meaning'
import { groupLookups, type WordEntry } from '../lib/words'
import { pluralize, relativeTime } from '../lib/format'
import type { OpenAt } from '../reader/Reader'

type Sort = 'recent' | 'az' | 'most'

/** Every word you've looked up while reading, from all your books. */
export default function Words() {
  const lookups = useLiveQuery(() => db.lookups.toArray(), [])
  const books = useLiveQuery(() => db.books.toArray(), [])
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [open, setOpen] = useState<string | null>(null)

  const titles = useMemo(() => new Map((books ?? []).map((b: Book) => [b.id, b.title])), [books])
  const entries = useMemo(() => groupLookups(lookups ?? []), [lookups])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? entries.filter((e) => e.key.includes(q) || e.gist?.toLowerCase().includes(q)) : entries
    if (sort === 'az') return [...list].sort((a, b) => a.key.localeCompare(b.key))
    if (sort === 'most') return [...list].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    return list
  }, [entries, query, sort])

  if (!lookups) return <PageContainer><div className="skeleton h-8 w-48 rounded-sm" /></PageContainer>

  const remove = async (e: WordEntry) => {
    const rows = e.lookups
    await db.lookups.bulkDelete(rows.map((r) => r.id))
    if (open === e.key) setOpen(null)
    toast({ message: `Removed “${e.word}”`, action: { label: 'Undo', onClick: () => void db.lookups.bulkAdd(rows) } })
  }

  const copyAll = async () => {
    const md = ['# Words', '', ...shown.map((e) => `- **${e.word}**${e.gist ? ` — ${e.gist}` : ''}${titles.get(e.latest.bookId) ? ` (${titles.get(e.latest.bookId)}, p. ${e.latest.page + 1})` : ''}`)].join('\n')
    await navigator.clipboard?.writeText(md).catch(() => {})
    toast({ message: `${pluralize(shown.length, 'word')} copied`, description: 'As Markdown — paste anywhere.' })
  }

  return (
    <PageContainer className="max-w-[880px]">
      <PageHeader
        eyebrow="Vocabulary"
        title="Words"
        subtitle={entries.length ? `${pluralize(entries.length, 'word')} you looked up while reading` : 'Words you look up while reading collect here.'}
        actions={
          entries.length > 0 && (
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy className="size-3.5" /> Copy as Markdown
            </Button>
          )
        }
      />

      {entries.length === 0 ? (
        <div className="flex flex-col items-center rounded-md border border-dashed border-hairline bg-canvas-elevated px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-hairline-soft text-ink">
            <BookA className="size-5" />
          </span>
          <p className="mt-4 text-heading-md text-ink">No words yet</p>
          <p className="mt-1.5 max-w-[440px] text-body-md text-body">
            When a word stops you, look it up without leaving the page: hold <Kbd>Shift</Kbd> and click it — on a tablet, select it and tap the book icon. Every word you look up lands here, from all your books.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a word"
                aria-label="Find a word"
                className="h-9 w-full rounded-sm border border-hairline bg-canvas-elevated pl-9 pr-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
              />
            </label>
            <Segmented
              value={sort}
              onChange={setSort}
              size="sm"
              ariaLabel="Sort words"
              options={[
                { value: 'recent', label: 'Recent' },
                { value: 'az', label: 'A–Z' },
                { value: 'most', label: 'Most looked up' },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-body-md text-mute">No words match “{query}”.</p>
          ) : (
            <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-canvas-elevated">
              {shown.map((e) => (
                <WordRow
                  key={e.key}
                  entry={e}
                  titles={titles}
                  open={open === e.key}
                  onToggle={() => setOpen((o) => (o === e.key ? null : e.key))}
                  onRemove={() => remove(e)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </PageContainer>
  )
}

function WordRow({ entry: e, titles, open, onToggle, onRemove }: { entry: WordEntry; titles: Map<string, string>; open: boolean; onToggle: () => void; onRemove: () => void }) {
  const book = titles.get(e.latest.bookId)
  const otherBooks = e.bookIds.length - 1
  return (
    <li>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hairline-soft/60 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-body-lg font-semibold text-ink">{e.word}</span>
            {e.count > 1 && <span className="text-body-sm tabular text-faint">{e.count}×</span>}
          </div>
          {e.gist && <p className={`text-body-sm text-mute ${open ? '' : 'line-clamp-1'}`}>{e.gist}</p>}
          <p className="mt-0.5 text-body-sm text-faint">
            {book ? `${book} · p. ${e.latest.page + 1}` : 'A removed book'}
            {otherBooks > 0 && ` · and ${pluralize(otherBooks, 'other book')}`} · {relativeTime(e.lastAt)}
          </p>
        </div>
        <ChevronDown className={`mt-1.5 size-4 shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <WordDetail entry={e} book={book} onRemove={onRemove} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function WordDetail({ entry: e, book, onRemove }: { entry: WordEntry; book?: string; onRemove: () => void }) {
  const navigate = useNavigate()
  const state = useMeaning(e.word)
  const l = e.latest
  const openInBook = () => {
    const at: OpenAt = { page: l.page, top: l.top ?? 0 }
    navigate(`/read/${l.bookId}`, { state: { openAt: at } })
  }
  return (
    <div className="px-4 pb-4 sm:px-5">
      {l.context && (
        <blockquote className="mb-3 border-l-2 border-link/40 pl-3 text-body-md italic text-body">
          <Emphasis text={l.context} word={l.word} />
        </blockquote>
      )}
      {state && (
        <div className="rounded-md bg-hairline-soft/50 p-3">
          {state.status === 'done' && state.meaning.formOf && (
            <p className="mb-2 text-body-sm text-mute">
              {state.meaning.formOf.label} <span className="font-medium text-body">{state.meaning.formOf.lemma}</span>
            </p>
          )}
          <MeaningBody state={state} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {book && (
          <Button size="sm" variant="outline" onClick={openInBook}>
            <BookOpen className="size-3.5" /> Open in the book
          </Button>
        )}
        {canSpeak && (
          <Button size="sm" variant="ghost" onClick={() => sayWord(e.word)}>
            <Volume2 className="size-3.5" /> Say it
          </Button>
        )}
        <a
          href={state?.status === 'done' ? state.meaning.url : webSearchUrl(e.word)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1 rounded-sm px-3 text-[13px] text-body hover:bg-hairline-soft hover:text-ink"
        >
          {state?.status === 'done' ? 'Wiktionary' : 'Search the web'} <ExternalLink className="size-3" />
        </a>
        <Button size="sm" variant="ghost" onClick={onRemove} className="ml-auto text-error hover:bg-error/10 hover:text-error">
          <Trash2 className="size-3.5" /> Remove
        </Button>
      </div>
    </div>
  )
}

/** The sentence, with the word in bold. */
function Emphasis({ text, word }: { text: string; word: string }) {
  const i = text.toLowerCase().indexOf(word.toLowerCase())
  if (i < 0) return <>“{text}”</>
  return (
    <>
      “{text.slice(0, i)}
      <strong className="font-semibold not-italic text-ink">{text.slice(i, i + word.length)}</strong>
      {text.slice(i + word.length)}”
    </>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-[4px] border border-hairline bg-hairline-soft px-1.5 py-px font-mono text-[12px] text-ink">{children}</kbd>
}
