import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, ListChecks, Pencil, X } from 'lucide-react'
import { db, type Highlight, type Recap, type RecapQuestion } from '../../db/db'
import { findRecap, hasAnswers, pageRange, recapId, RECAP_QUESTIONS, type Chapter } from '../../lib/recaps'
import { formatDate } from '../../lib/format'
import { vibrate } from '../../lib/hooks'
import { swatchOf } from '../../reader/HighlightTools'
import { Button } from '../ui/Button'

type Answers = Partial<Record<RecapQuestion, string>>
const SUMMARY = RECAP_QUESTIONS.length

interface Props {
  /** The chapter to recap; null closes the writer. */
  chapter: Chapter | null
  bookId: string
  /** Start on a question (index), or on the saved recap. Default: where you left off. */
  initial?: number | 'summary'
  onClose: () => void
  /** Tapping one of your highlights in "Check yourself". */
  onJumpToHighlight?: (h: Highlight) => void
}

/**
 * A quiet, full-screen place to recall a chapter: one question at a time,
 * the book hidden behind it (so it's recall, not copying), saved as you type.
 * Afterwards, "Check yourself" shows what the chapter covered — its sections
 * and your highlights — so you can spot what you missed.
 */
export function RecapWriter({ chapter, ...rest }: Props) {
  return createPortal(
    <AnimatePresence>{chapter && <Writer key={`${rest.bookId}:${chapter.start}`} chapter={chapter} {...rest} />}</AnimatePresence>,
    document.body,
  )
}

function Writer({ chapter, bookId, initial, onClose, onJumpToHighlight }: Props & { chapter: Chapter }) {
  const [loaded, setLoaded] = useState(false)
  const [answers, setAnswers] = useState<Answers>({})
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [justSaved, setJustSaved] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const rec = useRef<Recap | null>(null)
  const answersRef = useRef(answers)
  answersRef.current = answers
  const dirtyRef = useRef(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const chapterRef = useRef(chapter)
  chapterRef.current = chapter

  useEffect(() => {
    let alive = true
    findRecap(bookId, chapter.start).then((r) => {
      if (!alive) return
      rec.current = r ?? null
      setAnswers(r?.answers ?? {})
      setSavedAt(r?.state === 'done' ? r.updatedAt : null)
      const firstEmpty = RECAP_QUESTIONS.findIndex((q) => !r?.answers[q.key]?.trim())
      setStep(initial === 'summary' ? SUMMARY : typeof initial === 'number' ? initial : r?.state === 'done' ? SUMMARY : Math.max(0, firstEmpty))
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [bookId, chapter.start, initial])

  /** Writes the recap. Nothing is stored until you've written something. */
  const save = useCallback(
    async (state?: Recap['state']) => {
      const next = answersRef.current
      const c = chapterRef.current
      // One recap per chapter: pick up a row made meanwhile (e.g. the "chapter finished" prompt).
      const cur = rec.current ?? (await findRecap(bookId, c.start)) ?? null
      if (!cur && !hasAnswers({ answers: next })) return
      const now = Date.now()
      const r: Recap = cur
        ? // Writing in a recap you'd skipped puts it back on your list.
          { ...cur, answers: next, updatedAt: now, ...(state ? { state, reviewedAt: now } : cur.state === 'skipped' ? { state: 'due' as const } : {}) }
        : { id: recapId(bookId, c.start), bookId, start: c.start, end: c.end, chapter: c.title, sections: c.sections, answers: next, state: state ?? 'due', createdAt: now, updatedAt: now }
      rec.current = r
      dirtyRef.current = false
      await db.recaps.put(r)
    },
    [bookId],
  )

  // Autosave while typing, and on the way out — closing never loses words.
  useEffect(() => {
    if (!loaded || !dirtyRef.current) return
    const t = setTimeout(() => void save(), 450)
    return () => clearTimeout(t)
  }, [answers, loaded, save])
  useEffect(() => () => void (dirtyRef.current && save()), [save])

  const go = useCallback(
    (to: number) => {
      setDir(to > step ? 1 : -1)
      setStep(to)
    },
    [step],
  )

  const finish = useCallback(async () => {
    if (!hasAnswers({ answers: answersRef.current })) return
    await save('done')
    vibrate(18)
    setSavedAt(Date.now())
    setJustSaved(true)
    go(SUMMARY)
  }, [save, go])

  const next = useCallback(() => (step < SUMMARY - 1 ? go(step + 1) : finish()), [step, go, finish])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && step < SUMMARY) {
        e.preventDefault()
        e.stopPropagation()
        next()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, next, step])

  // Each question's answer box takes focus as it appears (after the slide),
  // with the cursor after anything you already wrote.
  const areaMounted = useCallback((el: HTMLTextAreaElement | null) => {
    areaRef.current = el
    if (!el) return
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true })
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

  const q = RECAP_QUESTIONS[step]
  const value = q ? answers[q.key] ?? '' : ''
  const words = value.trim() ? value.trim().split(/\s+/).length : 0
  const any = hasAnswers({ answers })

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Recap: ${chapter.title}`}
      className="fixed inset-0 z-[85] flex flex-col bg-canvas"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 340, damping: 34 }}
    >
      {/* Header */}
      <div className="safe-top shrink-0 border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-[760px] items-center gap-3 px-3 sm:px-5">
          <button onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full text-mute transition-colors hover:bg-hairline-soft hover:text-ink">
            <X className="size-[18px]" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-mono-eyebrow text-mute">Chapter recap</div>
            <div className="truncate text-label-sm text-ink">{chapter.title}</div>
          </div>
          <div className="flex items-center gap-1.5" aria-hidden>
            {RECAP_QUESTIONS.map((qq, i) => {
              const filled = step === SUMMARY || i < step || !!answers[qq.key]?.trim()
              return (
                <motion.span
                  key={qq.key}
                  animate={{ width: i === step ? 28 : 12 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                  className={`h-1.5 rounded-full transition-colors duration-300 ${step === SUMMARY ? 'bg-success' : i === step ? 'bg-ink' : filled ? 'bg-ink/45' : 'bg-hairline'}`}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[680px] px-5 pb-10 pt-8 sm:pt-14">
          {loaded && (
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              {step < SUMMARY ? (
                <motion.div
                  key={step}
                  custom={dir}
                  variants={{
                    enter: (d: number) => ({ opacity: 0, x: d * 28 }),
                    center: { opacity: 1, x: 0 },
                    exit: (d: number) => ({ opacity: 0, x: d * -28 }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                >
                  <div className="text-mono-eyebrow text-mute">
                    Question {step + 1} of {SUMMARY}
                  </div>
                  <h2 className="mt-3 text-[24px] font-semibold leading-8 tracking-[-0.8px] text-ink sm:text-[30px] sm:leading-[38px] sm:tracking-[-1.1px]">{q.title}</h2>
                  <p className="mt-2 text-body-md text-mute">{q.hint}</p>
                  <textarea
                    ref={areaMounted}
                    value={value}
                    onChange={(e) => {
                      dirtyRef.current = true
                      const v = e.target.value
                      setAnswers((a) => ({ ...a, [q.key]: v }))
                    }}
                    placeholder={q.placeholder}
                    rows={6}
                    className="field-sizing-content mt-6 block max-h-[55dvh] min-h-[180px] w-full resize-none rounded-md border border-hairline bg-canvas-elevated p-4 text-body-lg text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
                  />
                  <div className="mt-2 flex justify-between text-body-sm text-faint">
                    <span className="tabular">{words ? `${words} ${words === 1 ? 'word' : 'words'}` : 'Saved as you type'}</span>
                    <span className="hidden sm:inline">Ctrl + Enter for next</span>
                  </div>
                </motion.div>
              ) : (
                <Summary
                  key="summary"
                  chapter={chapter}
                  bookId={bookId}
                  answers={answers}
                  justSaved={justSaved}
                  savedAt={savedAt}
                  onEdit={(i) => {
                    setJustSaved(false)
                    go(i)
                  }}
                  onJumpToHighlight={
                    onJumpToHighlight &&
                    ((h) => {
                      onClose()
                      onJumpToHighlight(h)
                    })
                  }
                />
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="safe-bottom shrink-0 border-t border-hairline bg-canvas">
        <div className="mx-auto flex h-16 max-w-[680px] items-center gap-2 px-5">
          {step < SUMMARY ? (
            <>
              {step > 0 && (
                <Button variant="ghost" onClick={() => go(step - 1)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
              )}
              <div className="flex-1" />
              {step === SUMMARY - 1 ? (
                <Button onClick={finish} disabled={!any} title={any ? undefined : 'Write at least one answer'}>
                  <Check className="size-4" /> Save recap
                </Button>
              ) : value.trim() ? (
                <Button onClick={next}>
                  Next <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button variant="outline" onClick={next}>
                  Skip <ArrowRight className="size-4" />
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="flex-1" />
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function Summary({
  chapter, bookId, answers, justSaved, savedAt, onEdit, onJumpToHighlight,
}: {
  chapter: Chapter
  bookId: string
  answers: Answers
  justSaved: boolean
  savedAt: number | null
  onEdit: (i: number) => void
  onJumpToHighlight?: (h: Highlight) => void
}) {
  const highlights =
    useLiveQuery(
      () => db.highlights.where('[bookId+page]').between([bookId, chapter.start], [bookId, chapter.end], true, true).toArray(),
      [bookId, chapter.start, chapter.end],
    ) ?? []
  const sorted = [...highlights].sort((a, b) => a.page - b.page || (a.rects[0]?.[1] ?? 0) - (b.rects[0]?.[1] ?? 0))
  const sections = chapter.sections.slice(0, 16)

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 32 }}>
      <div className="flex flex-col items-center text-center">
        <motion.div
          initial={justSaved ? { scale: 0.4, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.05 }}
          className="relative grid size-14 place-items-center rounded-full bg-success text-white"
        >
          {justSaved && (
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-success"
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            />
          )}
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={justSaved ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.22, ease: 'easeOut' }} />
          </svg>
        </motion.div>
        <h2 className="mt-4 text-heading-md text-ink">{justSaved ? 'Recap saved' : 'Your recap'}</h2>
        <p className="mt-1 text-body-md text-mute">
          {[chapter.title, pageRange(chapter)?.toLowerCase(), savedAt ? formatDate(savedAt) : null].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="mt-8 space-y-3">
        {RECAP_QUESTIONS.map((q, i) => {
          const a = answers[q.key]?.trim()
          return (
            <motion.section
              key={q.key}
              initial={justSaved ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: justSaved ? 0.25 + i * 0.07 : 0, type: 'spring', stiffness: 380, damping: 32 }}
              className="group rounded-md border border-hairline bg-canvas-elevated p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm font-medium text-mute">{q.label}</span>
                <button onClick={() => onEdit(i)} className="-my-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-body-sm text-faint transition-colors hover:bg-hairline-soft hover:text-ink">
                  <Pencil className="size-3.5" /> Edit
                </button>
              </div>
              {a ? <p className="mt-1.5 whitespace-pre-wrap text-body-md text-ink">{a}</p> : <p className="mt-1.5 text-body-md text-faint">Skipped</p>}
            </motion.section>
          )
        })}
      </div>

      {(sections.length > 0 || sorted.length > 0) && (
        <motion.div initial={justSaved ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: justSaved ? 0.5 : 0 }} className="mt-10">
          <h3 className="flex items-center gap-2 text-label-sm text-ink">
            <ListChecks className="size-4 text-link" /> Check yourself
          </h3>
          <p className="mt-1 text-body-md text-mute">What the chapter covered — anything you forgot? Add it to your recap while it’s fresh.</p>
          {sections.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {sections.map((s, i) => (
                <li key={i} className="rounded-full border border-hairline bg-canvas-elevated px-2.5 py-1 text-body-sm text-body">
                  {s}
                </li>
              ))}
              {chapter.sections.length > sections.length && <li className="px-1 py-1 text-body-sm text-faint">+{chapter.sections.length - sections.length} more</li>}
            </ul>
          )}
          {sorted.length > 0 && (
            <>
              <div className="mt-5 text-body-sm font-medium text-mute">Your highlights in this chapter</div>
              <ul className="mt-2 space-y-1">
                {sorted.map((h) => (
                  <li key={h.id}>
                    <button
                      disabled={!onJumpToHighlight}
                      onClick={() => onJumpToHighlight?.(h)}
                      className="flex w-full gap-3 rounded-sm px-2 py-2 text-left transition-colors enabled:hover:bg-hairline-soft"
                    >
                      <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ background: swatchOf(h.color) }} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-3 text-body-md text-ink">{h.text}</span>
                        {h.note && <span className="mt-1 block text-body-sm text-body">{h.note}</span>}
                        <span className="mt-0.5 block text-body-sm text-faint">Page {h.page + 1}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}
