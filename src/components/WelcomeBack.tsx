import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Flame, PenLine, RotateCw } from 'lucide-react'
import { db, type Book, type Highlight } from '../db/db'
import type { OpenAt } from '../reader/Reader'
import { BookCover } from './BookCover'
import { Logo } from './Logo'
import { Button } from './ui/Button'
import { dailyGoal, getSettings } from '../lib/settings'
import { cloudEnabled } from '../lib/supabase'
import { webSessions } from '../lib/web'
import { useIsMobile } from '../lib/hooks'
import {
  chooseLine, headSentences, lineShown, markShown, partOfDay, passageFor, pickHighlight, readingProgress, tailSentences, type Line, type Passage, type Progress,
} from '../lib/welcome'

/** Away this long (app in the background), coming back counts as opening I read again. */
const AWAY_MS = 60 * 60_000

interface Shown {
  highlight: Highlight
  book: Book
  passage: Passage
  line: Line | null
}

/** The first-run screen (auth/Welcome) comes first: it's shown until it has been seen once. */
const onboardingPending = () => {
  try {
    return cloudEnabled && localStorage.getItem('irb-welcome-seen') !== '1'
  } catch {
    return false
  }
}

async function loadProgress(): Promise<Progress> {
  const [bookSessions, reads, allBooks] = await Promise.all([db.sessions.toArray(), db.webReads.toArray(), db.books.toArray()])
  return readingProgress({ all: [...bookSessions, ...webSessions(reads)], bookSessions, allBooks, goalMinutes: dailyGoal(getSettings()) })
}

/**
 * When you open I read: one of your highlights inside its page — the
 * sentences around it faded — and a line about how your reading is going.
 * Off in Settings → Reading.
 */
export function WelcomeBack() {
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<Shown | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const path = useRef(location.pathname)
  useEffect(() => {
    path.current = location.pathname
  }, [location.pathname])
  const busy = useRef(false)
  const continueRef = useRef<HTMLButtonElement>(null)
  // On a phone, fewer sentences around it, so Continue is on the first screen.
  const mobile = useIsMobile()

  const show = useCallback(async () => {
    if (busy.current || !getSettings().welcomeScreen || path.current.startsWith('/read/') || onboardingPending()) return
    busy.current = true
    try {
      const pick = await pickHighlight()
      if (!pick) return
      const [passage, prog] = await Promise.all([passageFor(pick.highlight, pick.book), loadProgress()])
      // Opened a book meanwhile: not now.
      if (path.current.startsWith('/read/')) return
      const line = chooseLine(prog.lines)
      if (line) lineShown(line)
      markShown(pick.highlight.id)
      setProgress(prog)
      setShown({ ...pick, passage, line })
      setOpen(true)
    } finally {
      busy.current = false
    }
  }, [])

  // On opening the app…
  useEffect(() => {
    void show()
  }, [show])

  // …and on coming back to it after an hour away.
  useEffect(() => {
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) {
        hiddenAt = 0
        void show()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [show])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => continueRef.current?.focus({ preventScroll: true }), 50)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open, close])

  const another = async () => {
    if (!shown || busy.current) return
    busy.current = true
    try {
      const pick = await pickHighlight(shown.highlight.id)
      if (!pick) return
      const passage = await passageFor(pick.highlight, pick.book)
      const line = progress ? chooseLine(progress.lines, shown.line?.kind) : null
      if (line) lineShown(line)
      markShown(pick.highlight.id)
      setShown({ ...pick, passage, line })
    } finally {
      busy.current = false
    }
  }

  const current = progress?.current ?? null
  const before = shown ? (mobile ? tailSentences(shown.passage.before, 170) : shown.passage.before) : ''
  const after = shown ? (mobile ? headSentences(shown.passage.after, 140) : shown.passage.after) : ''
  const goOn = () => {
    close()
    if (current) navigate(`/read/${current.id}`)
    else if (path.current !== '/') navigate('/')
  }
  const openPassage = () => {
    if (!shown) return
    close()
    const h = shown.highlight
    const at: OpenAt = { page: h.page, top: Math.max(0, h.rects[0]?.[1] ?? 0), highlightId: h.id }
    navigate(`/read/${h.bookId}`, { state: { openAt: at } })
  }

  return createPortal(
    <AnimatePresence>
      {open && shown && progress && (
        <motion.div
          key="welcome-back"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-line"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          className="fixed inset-0 z-[80] flex flex-col overflow-y-auto overscroll-contain bg-canvas text-ink"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+16px)] md:px-8 md:pt-6">
            <div className="flex items-center gap-2.5">
              <Logo className="h-6" motion="flow" weight={9} />
              <span className="text-[15px] font-semibold tracking-[-0.3px]">I read</span>
            </div>
            <button onClick={close} className="-mr-2 rounded-full px-3.5 py-2.5 text-body-md text-mute transition-colors hover:text-ink">
              {location.pathname === '/' ? 'Skip to Library' : 'Skip'}
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center px-5 py-6 md:px-8 md:py-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={shown.highlight.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                className="flex w-full max-w-[720px] flex-col gap-6 sm:gap-7"
              >
                <div>
                  <div className="text-mono-eyebrow text-mute">{partOfDay()}</div>
                  <h1 id="welcome-line" className="mt-2.5 text-[22px] font-semibold leading-[29px] tracking-[-0.6px] sm:text-[24px] sm:leading-8 md:text-[28px] md:leading-9 md:tracking-[-0.9px]">
                    {shown.line?.head ?? 'Welcome back.'}
                  </h1>
                  <p className="mt-1.5 text-body-lg text-body">{shown.line?.sub ?? 'Here’s something you highlighted.'}</p>
                </div>

                <div className="flex flex-col gap-4 border-t border-hairline pt-5 sm:gap-[18px] sm:pt-6">
                  <div className="flex items-center gap-3">
                    <BookCover book={shown.book} width={28} rounded="rounded-[2px]" className="shrink-0 shadow-cover" />
                    <div className="min-w-0">
                      <div className="truncate text-label-sm text-ink">
                        {shown.book.title}
                        {shown.book.author && <span className="font-normal text-mute"> · {shown.book.author}</span>}
                      </div>
                      <div className="text-body-sm text-mute">Page {shown.highlight.page + 1}</div>
                    </div>
                  </div>
                  <p dir="auto" className="text-[16px] leading-[27px] tracking-[-0.1px] sm:text-[17px] sm:leading-[30px] md:text-[19px] md:leading-[33px] md:tracking-[-0.2px]">
                    {before && <span className="text-mute dark:text-faint">{before} </span>}
                    <mark className="passage-hl font-medium" style={{ background: `var(--wash-${shown.highlight.color})` }}>
                      {shown.passage.text}
                    </mark>
                    {after && <span className="text-mute dark:text-faint"> {after}</span>}
                  </p>
                  {shown.highlight.note?.trim() && (
                    <p className="flex gap-2.5 text-body-md text-body">
                      <PenLine className="mt-0.5 size-4 shrink-0 text-mute" aria-hidden="true" />
                      <span><span className="text-mute">Your note · </span>{shown.highlight.note.trim()}</span>
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button ref={continueRef} size="lg" onClick={goOn} className="max-w-full">
                    <span className="flex min-w-0 items-baseline gap-[0.3em]">
                      <span className="truncate">{current ? `Continue ${current.title}` : 'Go to Library'}</span>
                      {current && <span className="shrink-0">· p. {current.currentPage + 1}</span>}
                    </span>
                  </Button>
                  <Button size="lg" variant="outline" onClick={openPassage}>
                    Open this passage
                  </Button>
                  <Button size="lg" variant="ghost" onClick={() => void another()}>
                    <RotateCw className="size-4" /> Another
                  </Button>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <ProgressStrip progress={progress} onSettings={() => { close(); navigate('/settings') }} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Along the bottom: streak, today against your goal, books this year, when the current book ends. */
function ProgressStrip({ progress: p, onSettings }: { progress: Progress; onSettings: () => void }) {
  const todayMin = Math.floor(p.todaySeconds / 60)
  const goalMin = Math.round(p.goalSeconds / 60)
  return (
    <div className="px-5 pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+20px)] md:px-8 md:pb-6">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 border-t border-hairline pt-4 text-body-md text-body">
        {p.streak > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Flame className="size-3.5 text-warning" aria-hidden="true" />
            <span className="font-semibold text-ink">{p.streak} {p.streak === 1 ? 'day' : 'days'}</span> in a row
          </span>
        )}
        {goalMin > 0 && (
          <span className="inline-flex items-center gap-2">
            Today <span className="font-semibold text-ink">{todayMin} of {goalMin} min</span>
            <span className="h-1 w-[72px] overflow-hidden rounded-full bg-hairline" aria-hidden="true">
              <span className="block h-full rounded-full bg-link" style={{ width: `${Math.min(100, (p.todaySeconds / p.goalSeconds) * 100)}%` }} />
            </span>
          </span>
        )}
        {p.finishedThisYear > 0 && (
          <span>
            <span className="font-semibold text-ink">{p.finishedThisYear} {p.finishedThisYear === 1 ? 'book' : 'books'}</span> this year
          </span>
        )}
        {p.currentFinish?.date != null && (
          <span className="min-w-0 truncate">
            {p.currentFinish.book.title} ends{' '}
            <span className="font-semibold text-ink">{new Date(p.currentFinish.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </span>
        )}
        <button onClick={onSettings} className="text-body-sm text-mute transition-colors hover:text-ink sm:ml-auto">
          Turn this off in Settings → Reading
        </button>
      </div>
    </div>
  )
}
