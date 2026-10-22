import { useEffect, useState } from 'react'
import { define, OfflineError, type Meaning } from '../lib/dictionary'

export type MeaningState = { word: string } & (
  | { status: 'loading' }
  | { status: 'done'; meaning: Meaning }
  | { status: 'missing' }
  | { status: 'offline' }
  | { status: 'error' }
)

/** Looks a word up (on the device first, then Wiktionary). */
export function useMeaning(word: string | null | undefined): MeaningState | null {
  const [state, setState] = useState<MeaningState | null>(null)
  useEffect(() => {
    if (!word) return setState(null)
    const ctrl = new AbortController()
    setState({ word, status: 'loading' })
    define(word, ctrl.signal)
      .then((meaning) => setState(meaning ? { word, status: 'done', meaning } : { word, status: 'missing' }))
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setState({ word, status: e instanceof OfflineError || !navigator.onLine ? 'offline' : 'error' })
      })
    return () => ctrl.abort()
  }, [word])
  return state && state.word === word ? state : word ? { word, status: 'loading' } : null
}

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

export function sayWord(word: string) {
  const u = new SpeechSynthesisUtterance(word)
  u.lang = 'en-US'
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

export const webSearchUrl = (word: string) => `https://www.google.com/search?q=${encodeURIComponent(`define ${word}`)}`

/** The meanings: grouped by part of speech, each with an example. */
export function MeaningBody({ state, saved }: { state: MeaningState; /** Kept on the Words page. */ saved?: boolean }) {
  if (state.status === 'loading')
    return (
      <div className="space-y-2 py-1" aria-label="Looking it up">
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-4/5 rounded" />
      </div>
    )
  if (state.status === 'missing') return <p className="text-body-md text-body">No dictionary entry for “{state.word}”.</p>
  if (state.status === 'offline' || state.status === 'error')
    return (
      <p className="text-body-md text-body">
        {state.status === 'offline' ? 'You’re offline, and this word hasn’t been looked up on this device before.' : 'Couldn’t reach the dictionary just now.'}
        {saved ? ' It’s saved in Words — its meaning will be there once you’re back online.' : ' Try again when you’re online.'}
      </p>
    )
  return (
    <>
      {state.meaning.groups.map((g, i) => (
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
    </>
  )
}
