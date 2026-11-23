import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { BookA, BookOpen, ChevronDown, Copy, ExternalLink, Search, Trash2, Volume2 } from 'lucide-react'
import { db, type Book } from '../db/db'
import { PageContainer, PageHeader } from '../components/AppShell'
import { Button } from '../components/ui/Button'
import { BookCover } from '../components/BookCover'
import { useToast } from '../components/ui/Toast'
import { canSpeak, MeaningBody, sayWord, useMeaning, webSearchUrl } from '../components/Meaning'
import { fillMissingMeanings, groupLookups, type WordEntry } from '../lib/words'
import { pluralize, relativeTime } from '../lib/format'
import type { OpenAt } from '../reader/Reader'

/** Every word you've looked up while reading, from all your books. */
export default function Words() {
  const lookups = useLiveQuery(() => db.lookups.toArray(), [])
  const books = useLiveQuery(() => db.books.toArray(), [])
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => void fillMissingMeanings(), [])

  const titles = useMemo(() => new Map((books ?? []).map((b: Book) => [b.id, b.title])), [books])
  const shelf = useMemo(() => new Map((books ?? []).map((b: Book) => [b.id, b])), [books])
  const entries = useMemo(() => groupLookups(lookups ?? []), [lookups])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? entries.filter((e) => e.key.includes(q) || e.gist?.toLowerCase().includes(q) || (e.latest.context ?? '').toLowerCase().includes(q)) : entries
    // The journal is kept by when you met each word, newest first.
    return [...list].sort((x, y) => y.firstAt - x.firstAt)
  }, [entries, query])
  const days = useMemo(() => journal(shown), [shown])
  const week = useMemo(() => thisWeek(entries, titles), [entries, titles])

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

  let n = 0
  return (
    <PageContainer className="max-w-[960px]">
      <PageHeader
        eyebrow="Keep"
        title="Words"
        subtitle={entries.length ? `${pluralize(entries.length, 'word')} you looked up while reading, kept by the day you met them` : 'Words you look up while reading collect here.'}
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
          <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
            <WeekCard i={0} label="New this week" value={String(week.fresh)} sub={week.fromBook ? `most from ${week.fromBook}` : 'look one up while you read'} />
            <WeekCard i={1} label="Looked up again" value={String(week.again)} sub={week.top ? `${week.top.word}, ${week.top.count} times now` : 'none twice yet'} />
            <WeekCard i={2} label="Longest" value={week.longest?.word ?? '—'} serif sub={week.longest ? pluralize(week.longest.key.length, 'letter') : ''} />
          </div>

          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your words, their meanings and sentences"
              aria-label="Search your words"
              className="h-10 w-full rounded-md border border-hairline bg-canvas-elevated pl-9 pr-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
            />
          </label>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-body-md text-mute">No words match “{query}”.</p>
          ) : (
            days.map((d) => (
              <section key={d.label} className="mt-7">
                <div className="mb-1 flex items-baseline gap-3">
                  <h2 className="text-label-sm text-ink">{d.label}</h2>
                  <span className="text-body-sm text-faint">{pluralize(d.items.length, 'word')}</span>
                </div>
                <ul>
                  {d.items.map((e) => (
                    <WordRow
                      key={e.key}
                      order={n++}
                      entry={e}
                      book={shelf.get(e.latest.bookId)}
                      titles={titles}
                      open={open === e.key}
                      onToggle={() => setOpen((o) => (o === e.key ? null : e.key))}
                      onRemove={() => remove(e)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </PageContainer>
  )
}

function WeekCard({ label, value, sub, serif, i }: { label: string; value: string; sub: string; serif?: boolean; i: number }) {
  return (
    <div className="ir-rise min-w-0 rounded-md border border-hairline bg-canvas-elevated px-3 py-2.5 sm:px-4 sm:py-3.5" style={{ '--i': i } as React.CSSProperties}>
      <div className="truncate text-body-sm text-mute">{label}</div>
      <div className={`mt-1 truncate text-[16px] font-medium sm:text-[22px] leading-tight tracking-[-0.5px] text-ink ${serif ? 'font-serif font-normal' : ''}`}>{value}</div>
      <div className="mt-0.5 truncate text-body-sm text-faint">{sub}</div>
    </div>
  )
}

/** Days you met words: Today, Yesterday, This week, Last week, then by month. */
function journal(list: WordEntry[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const t0 = today.getTime()
  const DAY = 86_400_000
  const labelOf = (at: number) => {
    if (at >= t0) return 'Today'
    if (at >= t0 - DAY) return 'Yesterday'
    if (at >= t0 - 6 * DAY) return 'This week'
    if (at >= t0 - 13 * DAY) return 'Last week'
    return new Date(at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  const out: { label: string; items: WordEntry[] }[] = []
  for (const e of list) {
    const l = labelOf(e.firstAt)
    const last = out[out.length - 1]
    if (last?.label === l) last.items.push(e)
    else out.push({ label: l, items: [e] })
  }
  return out
}

/** The week at a glance: new words, the ones you looked up again, the longest. */
function thisWeek(entries: WordEntry[], titles: Map<string, string>) {
  const since = Date.now() - 7 * 86_400_000
  const fresh = entries.filter((e) => e.firstAt >= since)
  const by = new Map<string, number>()
  for (const e of fresh) by.set(e.latest.bookId, (by.get(e.latest.bookId) ?? 0) + 1)
  const topBook = [...by.entries()].sort((a, b) => b[1] - a[1])[0]
  const repeated = entries.filter((e) => e.count > 1)
  return {
    fresh: fresh.length,
    fromBook: topBook ? titles.get(topBook[0]) : undefined,
    again: repeated.length,
    top: [...repeated].sort((a, b) => b.count - a.count)[0],
    longest: [...entries].sort((a, b) => b.key.length - a.key.length)[0],
  }
}

/** "noun · A force…" → the part of speech and the meaning. */
function splitGist(gist?: string) {
  if (!gist) return { pos: '', meaning: gist }
  const i = gist.indexOf(' · ')
  return i > 0 && i < 24 ? { pos: gist.slice(0, i), meaning: gist.slice(i + 3) } : { pos: '', meaning: gist }
}

function WordRow({ entry: e, book, titles, open, onToggle, onRemove, order = 0 }: { order?: number; entry: WordEntry; book?: Book; titles: Map<string, string>; open: boolean; onToggle: () => void; onRemove: () => void }) {
  const title = titles.get(e.latest.bookId)
  const otherBooks = e.bookIds.length - 1
  const { pos, meaning } = splitGist(e.gist)
  return (
    <li className="ir-rise border-t border-hairline" style={{ '--i': order } as React.CSSProperties}>
      <button onClick={onToggle} aria-expanded={open} className="grid w-full gap-x-6 gap-y-1 rounded-sm py-3.5 text-left transition-colors hover:bg-hairline-soft/40 sm:grid-cols-[170px_minmax(0,1fr)_16px] sm:px-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-serif text-[21px] leading-tight tracking-[-0.2px] text-ink">{e.word}</span>
            {e.count > 1 && <span className="text-body-sm tabular text-faint">{e.count}×</span>}
          </div>
          {pos && <div className="text-body-sm italic text-mute">{pos}</div>}
        </div>
        <div className="min-w-0">
          {e.latest.context && (
            <p className={`font-serif text-[15px] leading-[1.55] text-body ${open ? '' : 'line-clamp-2'}`}>
              <Emphasis text={e.latest.context} word={e.latest.word} />
            </p>
          )}
          {meaning ? (
            <p className={`mt-1 text-body-sm text-ink ${open ? '' : 'line-clamp-1'}`}>{meaning}</p>
          ) : (
            <p className="mt-1 text-body-sm italic text-faint">{e.gist === '' ? 'No dictionary entry' : 'Looked up offline — the meaning comes when you’re online'}</p>
          )}
          <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-faint">
            {book && <BookCover book={book} width={11} rounded="rounded-[1px]" className="shrink-0" />}
            {title ? `${title} · p. ${e.latest.page + 1}` : 'A removed book'}
            {otherBooks > 0 && ` · and ${pluralize(otherBooks, 'other book')}`} · {relativeTime(e.firstAt)}
          </p>
        </div>
        <ChevronDown className={`mt-1.5 hidden size-4 shrink-0 text-faint transition-transform sm:block ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden sm:pl-[194px]"
          >
            <WordDetail entry={e} book={title} onRemove={onRemove} />
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
    <div className="pb-4 sm:px-2">
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
