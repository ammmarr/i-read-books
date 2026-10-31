import { AnimatePresence, motion } from 'motion/react'
import { Timer, X as XIcon } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { formatDurationLong } from '../lib/format'
import type { Away } from './useReadingSession'

/** Left open? "Still reading?" — unanswered, the still time stops counting (see useReadingSession). */
export function StillReading({ asking, away, stillHere, countAway, dismissAway }: {
  asking: number | null
  away: Away | null
  stillHere: () => void
  countAway: () => void
  dismissAway: () => void
}) {
  return (
    <AnimatePresence>
      {(asking != null || away) && (
        <motion.div
          key="still"
          initial={{ opacity: 0, y: -12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          role="alertdialog"
          aria-live="assertive"
          aria-label={away ? 'Reading time paused' : 'Still reading?'}
          className="absolute left-1/2 top-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+76px)] z-50 flex w-[min(400px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-lg border border-hairline bg-canvas-elevated py-3 pl-4 pr-3 shadow-floating"
        >
          <Timer className={`size-4 shrink-0 ${away ? 'text-faint' : 'text-link'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-label-sm text-ink">{!away ? 'Still reading?' : away.back ? 'Welcome back' : 'Reading time paused'}</p>
            <p className="text-body-sm text-mute">
              {!away
                ? `Your reading time pauses in ${asking} s.`
                : away.off > 0
                  ? `${formatDurationLong(away.off)} while you were away ${away.off < 90 ? 'wasn’t' : 'weren’t'} counted.`
                  : away.back
                    ? 'Your reading time is running again.'
                    : 'It runs again when you’re back.'}
            </p>
          </div>
          {!away ? (
            <Button size="sm" onClick={stillHere}>
              I’m here
            </Button>
          ) : away.off > 0 ? (
            <Button size="sm" variant="outline" onClick={countAway}>
              I was reading
            </Button>
          ) : null}
          {away?.back && (
            <button onClick={dismissAway} aria-label="Dismiss" className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
              <XIcon className="size-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
