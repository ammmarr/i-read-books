import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { Copy, Eye, EyeOff, NotebookPen, Pencil, Trash2 } from 'lucide-react'
import { db, type Book, type Highlight, type Recap, type RecapQuestion } from '../../db/db'
import {
  groupRecaps, hasAnswers, isWritten, kindOf, pageRange, questionTitle, RECAP_QUESTIONS, recapsMarkdown, setBookRecaps, setRecapsEnabled, unitOf, useRecapPrefs, type Chapter,
} from '../../lib/recaps'
import { useSyncState } from '../../lib/sync'
import { useAuth } from '../../lib/supabase'
import { relativeTime } from '../../lib/format'
import { Button, IconButton } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { RecapWriter } from './RecapWriter'

const asChapter = unitOf
const NO_RECAPS: Recap[] = []

/**
 * Your recaps for a book, in reading order — each chapter's, with its
 * sections' underneath. "Test yourself" hides the answers so you can recall
 * each one before revealing it.
 */
export function RecapSection({ book, onJumpToHighlight }: { book: Book; onJumpToHighlight?: (h: Highlight) => void }) {
  const { toast } = useToast()
  const recaps = useLiveQuery(() => db.recaps.where('bookId').equals(book.id).toArray(), [book.id]) ?? NO_RECAPS
  const prefs = useRecapPrefs()
  const sync = useSyncState()
  const { session } = useAuth()
  const [test, setTest] = useState(false)
  const [writer, setWriter] = useState<{ chapter: Chapter; initial?: number | 'summary' } | null>(null)

  // Everything with answers — finished, or started and not finished yet — shows
  // in full; chapters finished but not recapped yet wait above.
  const done = recaps.filter(isWritten).sort((a, b) => a.start - b.start)
  const due = recaps.filter((r) => r.state === 'due' && !hasAnswers(r)).sort((a, b) => a.start - b.start)
  const offHere = prefs.offBooks.includes(book.id)

  const copy = async () => {
    await navigator.clipboard?.writeText(recapsMarkdown(book, done)).catch(() => {})
    toast({ message: `${done.length} ${done.length === 1 ? 'recap' : 'recaps'} copied`, description: 'As Markdown — paste anywhere.' })
  }

  const remove = async (r: Recap) => {
    await db.recaps.delete(r.id)
    toast({ message: 'Recap deleted', description: r.chapter, action: { label: 'Undo', onClick: () => db.recaps.put(r) } })
  }

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-heading-md text-ink">
            Questions &amp; answers <span className="text-body-md tabular text-faint">{done.length}</span>
          </h2>
          <p className="text-body-sm text-mute">Your recaps after each chapter{prefs.sections ? ' and section' : ''}.</p>
        </div>
        {done.length > 0 && (
          <>
            <Button variant={test ? 'default' : 'outline'} size="sm" onClick={() => setTest((t) => !t)} aria-pressed={test}>
              {test ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} Test yourself
            </Button>
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy className="size-3.5" /> Copy as Markdown
            </Button>
          </>
        )}
      </div>

      <AnimatePresence initial={false}>
        {test && done.length > 0 && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3 overflow-hidden text-body-md text-mute">
            Answers are hidden. Try to recall each one, then tap to check yourself.
          </motion.p>
        )}
      </AnimatePresence>

      {session && !sync.recapsCloud && (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm text-body">
          Showing recaps written on this device. Ones from your other devices can’t arrive until the cloud database gets one update — run the latest{' '}
          <code className="rounded-[4px] bg-hairline-soft px-1">supabase/schema.sql</code>. Everything written here is kept and syncs after that.
        </p>
      )}

      {(!prefs.enabled || offHere) && (
        <p className="mb-3 rounded-md bg-hairline-soft px-3 py-2 text-body-sm text-body">
          {prefs.enabled ? 'Recaps are off for this book' : 'Chapter recaps are turned off'} — you won’t be asked after chapters.{' '}
          <button onClick={() => (prefs.enabled ? setBookRecaps(book.id, true) : setRecapsEnabled(true))} className="font-medium text-link hover:underline">
            Turn on
          </button>
        </p>
      )}

      {due.length > 0 && (
        <ul className="mb-3 space-y-2">
          <AnimatePresence initial={false}>
            {due.map((r) => (
              <motion.li
                key={r.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-3 rounded-md border border-dashed border-hairline px-4 py-3"
              >
                <NotebookPen className="size-4 shrink-0 text-link" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-md text-ink">{r.chapter}</span>
                  <span className="block text-body-sm text-mute">Finished {relativeTime(r.createdAt)} · recap waiting</span>
                </span>
                <Button size="sm" onClick={() => setWriter({ chapter: asChapter(r) })}>
                  Write it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => db.recaps.update(r.id, { state: 'skipped', updatedAt: Date.now() })}>
                  Skip
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {done.length === 0 ? (
        due.length === 0 && (
          <div className="rounded-md border border-dashed border-hairline px-6 py-10 text-center text-body-md text-mute">
            When you finish a chapter{prefs.sections ? ' or a section' : ''}, you’ll be asked three quick questions — what you learned, a real example, and what you’ll do with it. Your answers collect here to revisit.
          </div>
        )
      ) : (
        <div className="space-y-6">
          {groupRecaps(done).map((g) => (
            <div key={g.title}>
              {!g.chapter && <h3 className="mb-2 text-label-sm text-mute">{g.title}</h3>}
              <ul className="grid gap-3">
                <AnimatePresence initial={false}>
                  {g.chapter && (
                    <RecapCard
                      key={g.chapter.id}
                      recap={g.chapter}
                      test={test}
                      onEdit={() => setWriter({ chapter: asChapter(g.chapter!), initial: g.chapter!.state === 'due' ? undefined : 0 })}
                      onOpen={() => setWriter({ chapter: asChapter(g.chapter!), initial: 'summary' })}
                      onDelete={() => remove(g.chapter!)}
                    />
                  )}
                </AnimatePresence>
              </ul>
              {g.sections.length > 0 && (
                <ul className={`grid gap-2 ${g.chapter ? 'ml-3 mt-2 border-l-2 border-hairline pl-3 sm:ml-5 sm:pl-4' : ''}`}>
                  <AnimatePresence initial={false}>
                    {g.sections.map((r) => (
                      <RecapCard
                        key={r.id}
                        recap={r}
                        test={test}
                        onEdit={() => setWriter({ chapter: asChapter(r), initial: r.state === 'due' ? undefined : 0 })}
                        onOpen={() => setWriter({ chapter: asChapter(r), initial: 'summary' })}
                        onDelete={() => remove(r)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <RecapWriter chapter={writer?.chapter ?? null} initial={writer?.initial} bookId={book.id} onClose={() => setWriter(null)} onJumpToHighlight={onJumpToHighlight} />
    </section>
  )
}

function RecapCard({ recap: r, test, onEdit, onOpen, onDelete }: { recap: Recap; test: boolean; onEdit: () => void; onOpen: () => void; onDelete: () => void }) {
  const [shown, setShown] = useState<Set<RecapQuestion>>(new Set())
  useEffect(() => setShown(new Set()), [test])
  const reveal = (k: RecapQuestion) => setShown((s) => new Set([...s, k]))
  const section = kindOf(r) === 'section'
  const draft = r.state === 'due'
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={`rounded-md border border-hairline bg-canvas-elevated ${section ? 'p-3.5 sm:p-4' : 'p-4 sm:p-5'}`}
    >
      <div className="flex items-start gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          {section && <div className="text-mono-eyebrow text-faint">Section</div>}
          <h3 className="text-label-sm text-ink hover:underline">
            {r.chapter}
            {draft && <span className="ml-2 inline-block rounded-full bg-warning/15 px-2 py-px align-middle text-[11px] font-medium text-warning">Not finished</span>}
          </h3>
          <p className="mt-0.5 text-body-sm text-faint">
            {[pageRange({ title: r.chapter, start: r.start, end: r.end }), relativeTime(r.updatedAt)].filter(Boolean).join(' · ')}
          </p>
        </button>
        {draft ? (
          <Button size="sm" variant="outline" onClick={onEdit}>
            Continue
          </Button>
        ) : (
          <IconButton label="Edit recap" size="icon-sm" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </IconButton>
        )}
        <IconButton label="Delete recap" size="icon-sm" className="hover:bg-error/10 hover:text-error" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <dl className={section ? 'mt-3 space-y-3' : 'mt-4 space-y-4'}>
        {RECAP_QUESTIONS.map((q) => {
          const a = r.answers[q.key]?.trim()
          const hidden = test && !!a && !shown.has(q.key)
          return (
            <div key={q.key}>
              <dt className="text-body-sm font-medium text-mute">{questionTitle(q, kindOf(r))}</dt>
              <dd className={`relative mt-1 ${hidden ? 'min-h-11' : ''}`}>
                {a ? (
                  <p
                    aria-hidden={hidden}
                    className={`whitespace-pre-wrap text-body-md text-ink transition-[filter,opacity] duration-300 ${hidden ? 'pointer-events-none select-none opacity-50 blur-[6px]' : ''}`}
                  >
                    {a}
                  </p>
                ) : (
                  <p className="text-body-md text-faint">{draft ? 'Not answered yet' : '—'}</p>
                )}
                {hidden && (
                  <button onClick={() => reveal(q.key)} className="absolute inset-0 flex items-center justify-center">
                    <span className="rounded-full border border-hairline bg-canvas-elevated px-3 py-1 text-label-sm text-ink shadow-floating">Recall it, then tap to reveal</span>
                  </button>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </motion.li>
  )
}
