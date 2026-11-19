import { motion } from 'motion/react'
import { Pause, Play } from 'lucide-react'
import { formatDuration } from '../lib/format'

/**
 * The reading time in the reader's top bar, and its pause button. Paused (by
 * you, or by "Still reading?" going unanswered) it says so; scrolling, turning
 * a page, a key or a tap on the book starts it again by itself (see
 * useReadingSession), and so does pressing it.
 */
export function ReadingClock({ seconds, paused, onPause, onResume, className = '' }: {
  seconds: number
  paused: boolean
  onPause: () => void
  onResume: () => void
  /** Where it shows: the top bar on wider screens, the bottom bar on a phone (`max-sm:hidden` / `sm:hidden`). */
  className?: string
}) {
  const time = formatDuration(seconds)
  return (
    <motion.button
      type="button"
      // useReadingSession ignores presses here: they pause or start it, they aren't "moving".
      data-reading-clock=""
      onClick={paused ? onResume : onPause}
      whileTap={{ scale: 0.96 }}
      aria-pressed={paused}
      aria-label={paused ? `Reading time paused at ${time}. Start it again` : `Reading time ${time}. Pause it`}
      title={paused ? 'Paused. Scroll, turn a page or press a key and it starts again.' : 'Reading time this session. Press to pause.'}
      className={`mr-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-body-sm tabular transition-colors duration-150 ${
        paused ? 'border-warning/45 bg-warning/10 text-ink' : 'border-hairline text-body hover:bg-hairline-soft'
      } ${className}`}
    >
      {paused ? <Play className="size-3 fill-current text-warning" aria-hidden="true" /> : <Pause className="size-3.5 text-link" aria-hidden="true" />}
      {paused ? (
        <>
          Paused
          <span className="hidden text-mute sm:inline">· {time}</span>
        </>
      ) : (
        time
      )}
    </motion.button>
  )
}
