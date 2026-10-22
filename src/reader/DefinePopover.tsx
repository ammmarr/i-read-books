import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, Volume2, X as XIcon } from 'lucide-react'
import { canSpeak, MeaningBody, sayWord, useMeaning, webSearchUrl } from '../components/Meaning'
import { gistOf, noteLookup } from '../lib/words'
import type { Anchor } from './HighlightTools'

export interface DefineTarget extends Anchor {
  word: string
  /** Looked up while reading: remembered for the Words page. */
  source?: { bookId: string; page: number; top?: number; context?: string }
}

/** A word's meaning, next to the word (hold Shift and click it, or "Define" on a selection). */
export function DefinePopover({ target, onClose }: { target: DefineTarget | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const state = useMeaning(target?.word)

  // Above or below the word, pinned to the edge next to it, so the card grows
  // away from the word as the meaning comes in.
  const place = useMemo(() => {
    if (!target) return null
    const { rect } = target
    const gap = 10
    const maxH = Math.min(440, window.innerHeight * 0.65)
    const above = rect.top - gap - 56
    const below = window.innerHeight - rect.bottom - gap - 12
    const downwards = target.below ? below >= 220 || below >= above : above < Math.min(maxH, 280) && below > above
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - 170, window.innerWidth - 348))
    return downwards
      ? { below: true, style: { left, top: rect.bottom + gap, maxHeight: Math.min(maxH, below) } }
      : { below: false, style: { left, bottom: window.innerHeight - rect.top + gap, maxHeight: Math.min(maxH, above) } }
  }, [target])

  // The lookup goes on the Words page — offline too: its meaning is filled
  // in there once the device is back online (fillMissingMeanings).
  useEffect(() => {
    const src = target?.source
    if (!target || !src || !state || state.word !== target.word || state.status === 'loading') return
    const gist = state.status === 'done' ? gistOf(state.meaning) : state.status === 'missing' ? '' : undefined
    void noteLookup({ word: target.word, ...src, gist })
  }, [state?.status, target]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!target) return
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [target, onClose])

  const word = state?.status === 'done' ? state.meaning.word : target?.word ?? ''

  return createPortal(
    <AnimatePresence>
      {target && place && state && (
        <motion.div
          ref={panel}
          key={target.word}
          role="dialog"
          aria-label={`Meaning of ${target.word}`}
          initial={{ opacity: 0, scale: 0.94, y: place.below ? -6 : 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          style={{ ...place.style, transformOrigin: place.below ? 'top center' : 'bottom center' }}
          className="fixed z-[75] flex w-[340px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-hairline bg-canvas-elevated shadow-floating"
        >
          <div className="flex items-start gap-1 px-4 pb-2 pt-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-heading-md text-ink">{word}</h3>
              {state.status === 'done' && state.meaning.formOf && (
                <p className="text-body-sm text-mute">
                  {state.meaning.formOf.label} <span className="font-medium text-body">{state.meaning.formOf.lemma}</span>
                </p>
              )}
            </div>
            {canSpeak && (
              <button onClick={() => sayWord(word)} aria-label={`Say “${word}”`} title="Say it" className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
                <Volume2 className="size-4" />
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
            <MeaningBody state={state} saved={!!target.source} />
          </div>

          <div className="flex items-center gap-3 border-t border-hairline px-4 py-2 text-body-sm">
            {state.status === 'done' ? (
              <a href={state.meaning.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-ink">
                Wiktionary <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-faint">Wiktionary</span>
            )}
            <a href={webSearchUrl(target.word)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-mute hover:text-ink">
              Search the web <ExternalLink className="size-3" />
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
