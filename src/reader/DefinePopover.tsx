import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, Volume2, X as XIcon } from 'lucide-react'
import { define, OfflineError, type Meaning } from '../lib/dictionary'
import type { Anchor } from './HighlightTools'

export interface DefineTarget extends Anchor {
  word: string
}

type State = { status: 'loading' } | { status: 'done'; meaning: Meaning } | { status: 'missing' } | { status: 'offline' } | { status: 'error' }

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/** A word's meaning, next to the word (A + double-click, or "Define" on a selection). */
export function DefinePopover({ target, onClose }: { target: DefineTarget | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>({ status: 'loading' })

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

  useEffect(() => {
    if (!target) return
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    define(target.word, ctrl.signal)
      .then((meaning) => setState(meaning ? { status: 'done', meaning } : { status: 'missing' }))
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setState({ status: e instanceof OfflineError || !navigator.onLine ? 'offline' : 'error' })
      })
    return () => ctrl.abort()
  }, [target?.word]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const word = state.status === 'done' ? state.meaning.word : target?.word ?? ''
  const say = () => {
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-US'
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }
  const web = `https://www.google.com/search?q=${encodeURIComponent(`define ${target?.word ?? ''}`)}`

  return createPortal(
    <AnimatePresence>
      {target && place && (
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
              <button onClick={say} aria-label={`Say “${word}”`} title="Say it" className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
                <Volume2 className="size-4" />
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hairline-soft hover:text-ink">
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
            {state.status === 'loading' && (
              <div className="space-y-2 py-1" aria-label="Looking it up">
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-4 w-full rounded" />
                <div className="skeleton h-4 w-4/5 rounded" />
              </div>
            )}
            {state.status === 'done' &&
              state.meaning.groups.map((g, i) => (
                <section key={i} className={i ? 'mt-3' : ''}>
                  <div className="text-mono-eyebrow text-faint">
                    {g.partOfSpeech}
                    {g.language !== 'English' && ` · ${g.language}`}
                  </div>
                  <ol className="mt-1 space-y-1.5">
                    {g.senses.map((s, j) => (
                      <li key={j} className="flex gap-2 text-body-md text-body">
                        {g.senses.length > 1 && <span className="tabular text-faint">{j + 1}.</span>}
                        <div className="min-w-0">
                          <p>{s.definition}</p>
                          {s.example && <p className="mt-0.5 text-body-sm italic text-mute">“{s.example}”</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            {state.status === 'missing' && <p className="text-body-md text-body">No dictionary entry for “{target.word}”.</p>}
            {state.status === 'offline' && <p className="text-body-md text-body">You’re offline. Meanings need the internet the first time; words you’ve looked up before work offline.</p>}
            {state.status === 'error' && <p className="text-body-md text-body">Couldn’t reach the dictionary just now. Try again in a moment.</p>}
          </div>

          <div className="flex items-center gap-3 border-t border-hairline px-4 py-2 text-body-sm">
            {state.status === 'done' ? (
              <a href={state.meaning.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-ink">
                Wiktionary <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-faint">Wiktionary</span>
            )}
            <a href={web} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-mute hover:text-ink">
              Search the web <ExternalLink className="size-3" />
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
