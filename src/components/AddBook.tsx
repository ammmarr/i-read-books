import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BookPlus, Check, CircleAlert, FileText, FileUp, Link2, Search, X } from 'lucide-react'
import type { BookStatus } from '../db/db'
import { addAnalyzedPdf, addListBook, analyzePdf, DuplicateTitleError, type PdfAnalysis } from '../db/books'
import { suggestBooks, type CatalogBook } from '../lib/readingList'
import { useObjectUrl } from '../lib/hooks'
import { Sheet } from './ui/Sheet'
import { Segmented } from './ui/Segmented'
import { Button } from './ui/Button'
import { Spinner } from './auth/AuthFlow'

export type AddTab = 'pdf' | 'manual'

interface Props {
  open: boolean
  onClose: () => void
  tab: AddTab
  onTab: (t: AddTab) => void
  /** Files dropped/picked, handed over for review. `batch` changes per hand-over. */
  incoming: { batch: number; files: File[] }
  onBrowse: () => void
  onAdded: (r: { added: number; attached: number; lastId?: string; listOnly?: boolean; title?: string }) => void
}

const SHELVES: { value: BookStatus; label: string }[] = [
  { value: 'queued', label: 'Up next' },
  { value: 'reading', label: 'Reading' },
  { value: 'finished', label: 'Finished' },
]

export function AddBookSheet(p: Props) {
  return (
    <Sheet open={p.open} onClose={p.onClose} title="Add a book" width={520}>
      <Segmented
        stretch
        value={p.tab}
        onChange={p.onTab}
        ariaLabel="How to add"
        options={[
          { value: 'pdf', label: <><FileText className="size-3.5" /> I have the PDF</> },
          { value: 'manual', label: <><BookPlus className="size-3.5" /> No PDF yet</> },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={p.tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="pt-5"
        >
          {p.tab === 'pdf' ? <PdfTab {...p} /> : <ManualTab {...p} />}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  )
}

// ── From a PDF ──────────────────────────────────────────────────────────

interface Item {
  key: string
  file: File
  state: 'analyzing' | 'ready' | 'error'
  a?: PdfAnalysis
  title: string
  author: string
  /** Fill in the matching reading-list entry instead of adding a new book. */
  attach: boolean
}

function PdfTab({ incoming, onBrowse, onAdded, onClose }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [shelf, setShelf] = useState<BookStatus>('queued')
  const [busy, setBusy] = useState(false)
  const handled = useRef(0)

  const analyze = async (files: File[]) => {
    const fresh = files
      .filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      .map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, file: f, state: 'analyzing' as const, title: '', author: '', attach: true }))
    setItems((xs) => [...xs, ...fresh])
    for (const it of fresh) {
      try {
        const a = await analyzePdf(it.file)
        setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, state: 'ready', a, title: a.match?.title ?? a.title, author: a.match?.author || a.author } : x)))
      } catch {
        setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, state: 'error' } : x)))
      }
    }
  }

  useEffect(() => {
    if (incoming.batch && incoming.batch !== handled.current) {
      handled.current = incoming.batch
      void analyze(incoming.files)
    }
  }, [incoming])

  const addable = items.filter((i) => i.state === 'ready' && !i.a?.duplicate)
  const analyzing = items.some((i) => i.state === 'analyzing')

  const add = async () => {
    setBusy(true)
    let added = 0
    let attached = 0
    let lastId: string | undefined
    for (const it of addable) {
      const r = await addAnalyzedPdf(it.a!, { title: it.title, author: it.author, status: shelf, attachTo: it.attach ? undefined : null })
      if (r.attached) attached++
      else added++
      lastId = r.book.id
    }
    setBusy(false)
    setItems([])
    onAdded({ added, attached, lastId })
    onClose()
  }

  return (
    <div>
      <button
        onClick={onBrowse}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-hairline px-4 text-center transition-colors hover:border-faint hover:bg-hairline-soft/50 ${
          items.length ? 'py-4' : 'py-10'
        }`}
      >
        <motion.span whileHover={{ y: -3 }} className="grid size-10 place-items-center rounded-full bg-hairline-soft text-body">
          <FileUp className="size-5" />
        </motion.span>
        <span className="text-label-sm text-ink">{items.length ? 'Add more PDFs' : 'Drop PDFs here, or browse'}</span>
        {!items.length && <span className="text-body-sm text-mute">We’ll read the title and author from each file — you can edit them before adding.</span>}
      </button>

      <ul className="mt-4 space-y-2">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.li
              key={it.key}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              className="rounded-md border border-hairline p-3"
            >
              <PdfRow item={it} onChange={(patch) => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, ...patch } : x)))} onRemove={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {items.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-label-sm text-ink">Put new books on</div>
          <Segmented stretch size="sm" value={shelf} onChange={setShelf} options={SHELVES} />
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={add} disabled={!addable.length || analyzing || busy}>
          {(busy || analyzing) && <Spinner />}
          {analyzing ? 'Reading files…' : addable.length > 1 ? `Add ${addable.length} books` : 'Add book'}
        </Button>
      </div>
    </div>
  )
}

function PdfRow({ item, onChange, onRemove }: { item: Item; onChange: (p: Partial<Item>) => void; onRemove: () => void }) {
  const cover = useObjectUrl(item.a?.cover)
  return (
    <div className="flex gap-3">
      <div className="h-[72px] w-[50px] shrink-0 overflow-hidden rounded-[3px] bg-hairline-soft shadow-cover">
        {item.state === 'analyzing' ? <div className="skeleton size-full" /> : cover ? <img src={cover} alt="" className="size-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        {item.state === 'analyzing' && (
          <div className="space-y-2 pt-1">
            <div className="truncate text-body-sm text-mute">Reading {item.file.name}…</div>
            <div className="skeleton h-3 w-2/3 rounded-full" />
          </div>
        )}
        {item.state === 'error' && (
          <div className="pt-1 text-body-sm text-error">
            <CircleAlert className="mr-1 inline size-3.5" />
            Couldn’t open {item.file.name}. It may be damaged or password-protected.
          </div>
        )}
        {item.state === 'ready' && item.a && (
          <>
            {item.a.duplicate ? (
              <div className="pt-1">
                <div className="truncate text-label-sm text-ink">{item.a.duplicate.title}</div>
                <div className="text-body-sm text-mute">Already in your library — skipped.</div>
              </div>
            ) : (
              <>
                <input
                  value={item.title}
                  onChange={(e) => onChange({ title: e.target.value })}
                  aria-label="Title"
                  placeholder="Title"
                  disabled={item.attach && !!item.a.match}
                  className="h-8 w-full rounded-sm border border-transparent bg-transparent px-1.5 -mx-1.5 text-label-sm text-ink outline-none transition-colors hover:border-hairline focus:border-link focus:bg-canvas-elevated disabled:hover:border-transparent"
                />
                <input
                  value={item.author}
                  onChange={(e) => onChange({ author: e.target.value })}
                  aria-label="Author"
                  placeholder="Author"
                  className="h-7 w-full rounded-sm border border-transparent bg-transparent px-1.5 -mx-1.5 text-body-sm text-body outline-none transition-colors hover:border-hairline focus:border-link focus:bg-canvas-elevated"
                />
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-mute">
                  <span>{item.a.pageCount} pages</span>
                  {item.a.match && (
                    <button
                      onClick={() => onChange({ attach: !item.attach, title: !item.attach ? item.a!.match!.title : item.a!.title })}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium transition-colors ${
                        item.attach ? 'bg-link-soft text-link' : 'bg-hairline-soft text-body'
                      }`}
                      title={item.attach ? 'Click to add as a separate book instead' : 'Click to fill in your list entry'}
                    >
                      <Link2 className="size-3" />
                      {item.attach ? `Fills in “${item.a.match.title}” from your list` : 'Add as a separate book'}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <button onClick={onRemove} aria-label="Remove" className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
        <X className="size-4" />
      </button>
    </div>
  )
}

// ── Without a PDF ───────────────────────────────────────────────────────

function ManualTab({ onAdded, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [shelf, setShelf] = useState<BookStatus>('queued')
  const [picked, setPicked] = useState<CatalogBook | null>(null)
  const [results, setResults] = useState<CatalogBook[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(-1)
  const [showList, setShowList] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<string[]>([])
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (picked || title.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await suggestBooks(`${title} ${author}`.trim(), ctrl.signal)
        setResults(r)
        setActive(-1)
      } catch {
        /* offline — typing still works */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, 320)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [title, author, picked])

  const choose = (b: CatalogBook) => {
    setPicked(b)
    setTitle(b.title)
    if (b.author) setAuthor(b.author)
    setShowList(false)
    setError(null)
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim()) {
      setError('Add a title.')
      titleRef.current?.focus()
      return
    }
    try {
      const b = await addListBook({ title, author, status: shelf, coverUrl: picked?.cover, estPages: picked?.pages })
      setJustAdded((xs) => [b.title, ...xs].slice(0, 5))
      onAdded({ added: 1, attached: 0, lastId: b.id, listOnly: true, title: b.title })
      setTitle('')
      setAuthor('')
      setPicked(null)
      setError(null)
      titleRef.current?.focus()
    } catch (err) {
      setError(err instanceof DuplicateTitleError ? `“${err.book.title}” is already in your library.` : 'Couldn’t add that book.')
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="-mt-1 mb-4 text-body-md text-mute">Put a book on your reading list now — add the PDF whenever you get it.</p>

      <div className="relative">
        <label className="mb-1.5 block text-label-sm text-ink" htmlFor="add-title">
          Title
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            id="add-title"
            ref={titleRef}
            autoFocus
            value={title}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="Search or type a title"
            onChange={(e) => {
              setTitle(e.target.value)
              setPicked(null)
              setShowList(true)
              setError(null)
            }}
            onFocus={() => setShowList(true)}
            onBlur={() => setTimeout(() => setShowList(false), 150)}
            onKeyDown={(e) => {
              if (!showList || !results.length) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => (a + 1) % results.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => (a - 1 + results.length) % results.length)
              } else if (e.key === 'Enter' && active >= 0) {
                e.preventDefault()
                choose(results[active])
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setShowList(false)
              }
            }}
            role="combobox"
            aria-expanded={showList && results.length > 0}
            aria-controls="add-suggestions"
            className={`h-11 w-full rounded-sm border bg-canvas-elevated pl-9 pr-9 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:ring-3 ${
              error ? 'border-error focus:ring-error/15' : 'border-hairline focus:border-link focus:ring-link/15'
            }`}
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-faint">
              <Spinner />
            </span>
          )}
        </div>
        <AnimatePresence>
          {showList && results.length > 0 && (
            <motion.ul
              id="add-suggestions"
              role="listbox"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              className="absolute inset-x-0 top-full z-10 mt-1 max-h-[300px] overflow-y-auto rounded-md border border-hairline bg-canvas-elevated p-1 shadow-floating"
            >
              {results.map((r, i) => (
                <li key={`${r.title}-${r.author}-${i}`} role="option" aria-selected={active === i}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(r)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left ${active === i ? 'bg-hairline-soft' : ''}`}
                  >
                    <span className="h-12 w-8 shrink-0 overflow-hidden rounded-[2px] bg-hairline-soft">
                      {r.cover && <img src={r.cover.replace('-L.jpg', '-S.jpg')} alt="" className="size-full object-cover" loading="lazy" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-md text-ink">{r.title}</span>
                      <span className="block truncate text-body-sm text-mute">
                        {[r.author, r.year].filter(Boolean).join(' · ') || 'Unknown author'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              <li className="px-2 pb-1 pt-1.5 text-[11px] text-faint">Suggestions from Open Library</li>
            </motion.ul>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {picked && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex items-center gap-3 rounded-md border border-hairline bg-hairline-soft/50 p-3">
              <span className="h-16 w-11 shrink-0 overflow-hidden rounded-[3px] bg-hairline shadow-cover">
                {picked.cover && <img src={picked.cover.replace('-L.jpg', '-M.jpg')} alt="" className="size-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1 text-body-sm text-mute">
                <span className="block truncate text-label-sm text-ink">{picked.title}</span>
                {[picked.author, picked.year, picked.pages && `${picked.pages} pages`].filter(Boolean).join(' · ')}
              </span>
              <button type="button" onClick={() => setPicked(null)} aria-label="Clear selection" className="grid size-8 place-items-center rounded-full text-faint hover:bg-hairline hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-label-sm text-ink">
          Author <span className="font-normal text-faint">(optional)</span>
        </span>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          autoComplete="off"
          placeholder="Who wrote it?"
          className="h-11 w-full rounded-sm border border-hairline bg-canvas-elevated px-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
        />
      </label>

      <div className="mt-4">
        <div className="mb-1.5 text-label-sm text-ink">Shelf</div>
        <Segmented stretch size="sm" value={shelf} onChange={setShelf} options={SHELVES} />
      </div>

      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="mt-3 text-body-sm text-error">
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {justAdded.length > 0 && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-1">
            {justAdded.map((t, i) => (
              <motion.li
                key={`${t}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 text-body-sm text-body"
              >
                <Check className="size-3.5 text-success" /> Added “{t}”
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {justAdded.length ? 'Done' : 'Cancel'}
        </Button>
        <Button type="submit" disabled={!title.trim()}>
          <BookPlus className="size-4" /> Add to reading list
        </Button>
      </div>
    </form>
  )
}
