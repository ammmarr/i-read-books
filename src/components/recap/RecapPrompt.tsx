import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { MoreHorizontal, NotebookPen, X } from 'lucide-react'
import type { Chapter } from '../../lib/recaps'
import { Button } from '../ui/Button'
import { Menu } from '../ui/Menu'

/** After this long without an answer, the card folds into a small pill so it never sits on your page. */
const FOLD_MS = 14_000

/**
 * "Chapter finished — recall it?" Floats over the page without stopping you:
 * start now, later, skip this chapter, or turn recaps off for the book.
 */
export function RecapPromptCard({
  chapter, waiting, className = '', onStart, onLater, onSkip, onOffForBook,
}: {
  chapter: Chapter
  /** Finished earlier, recap still waiting (vs. just finished). */
  waiting: boolean
  className?: string
  onStart: () => void
  onLater: () => void
  onSkip: () => void
  onOffForBook: () => void
}) {
  const [folded, setFolded] = useState(false)
  useEffect(() => {
    setFolded(false)
    const t = setTimeout(() => setFolded(true), FOLD_MS)
    return () => clearTimeout(t)
  }, [chapter.start])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 14, scale: 0.97, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
      className={`z-40 overflow-hidden border border-hairline bg-canvas-elevated shadow-floating ${folded ? 'rounded-full' : 'rounded-lg'} ${className}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {folded ? (
          <motion.div key="pill" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex max-w-[min(340px,calc(100vw-24px))] items-center pl-1">
            <button onClick={onStart} className="flex h-10 min-w-0 items-center gap-2 rounded-full px-3 text-label-sm text-ink hover:bg-hairline-soft">
              <NotebookPen className="size-4 shrink-0 text-link" />
              <span className="truncate">Recap “{chapter.title}”</span>
            </button>
            <button onClick={onLater} aria-label="Later" className="mr-1 grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ) : (
          <motion.div key="card" layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-[min(380px,calc(100vw-24px))] p-4">
            <div className="flex items-start gap-3">
              <motion.span
                initial={{ rotate: -14, scale: 0.7 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.08 }}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-link-soft text-link"
              >
                <NotebookPen className="size-[18px]" />
              </motion.span>
              <div className="min-w-0 flex-1">
                <p className="text-label-sm text-ink">{waiting ? 'Your recap is waiting' : 'Chapter finished'}</p>
                <p className="truncate text-body-sm text-mute">{chapter.title}</p>
              </div>
              <button onClick={onLater} aria-label="Later" className="-mr-1.5 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-3 text-body-md text-body">Recall it in your own words while it’s fresh — three short questions.</p>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={onStart}>
                Recall now
              </Button>
              <Button size="sm" variant="ghost" onClick={onLater}>
                Later
              </Button>
              <Menu
                align="end"
                trigger={(p) => (
                  <button {...p} aria-label="More options" className="ml-auto grid size-8 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
                    <MoreHorizontal className="size-4" />
                  </button>
                )}
                items={[
                  { label: 'Skip this chapter', onSelect: onSkip },
                  { label: 'Don’t ask in this book', onSelect: onOffForBook },
                ]}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
