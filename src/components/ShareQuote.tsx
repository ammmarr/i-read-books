import { useEffect, useState } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { Sheet } from './ui/Sheet'
import { Button } from './ui/Button'
import { copyAndOpenSubstack, postSubstackNote, useExtension } from '../lib/share'

/** X's mark (for the share buttons). */
export function XMark({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

/** Substack's mark. */
export function SubstackMark({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" />
    </svg>
  )
}

/**
 * Check (and edit) a quote, then post it as a Substack Note — through the I
 * read extension in Chrome. Without it (a tablet), copy it and open Substack.
 */
export function SubstackNoteSheet({ text, onClose }: { text: string | null; onClose: () => void }) {
  const ext = useExtension()
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<{ step: 'edit' | 'posting' | 'done' } | { step: 'error'; error: string }>({ step: 'edit' })

  useEffect(() => {
    if (text == null) return
    setDraft(text)
    setState({ step: 'edit' })
  }, [text])

  const post = async () => {
    setState({ step: 'posting' })
    const res = await postSubstackNote(draft)
    setState(res.ok ? { step: 'done' } : { step: 'error', error: res.error ?? 'Couldn’t post the Note.' })
  }

  const done = state.step === 'done'
  return (
    <Sheet
      open={text != null}
      onClose={onClose}
      title={done ? 'Posted to Substack' : 'Post a Substack Note'}
      description={
        done
          ? undefined
          : ext.canPost
            ? 'Posted as whoever is signed in to substack.com in this Chrome.'
            : ext.present
              ? 'Update the I read extension to post Notes from here (Settings → Substack → Download, then reload it).'
              : 'Posting straight from I read needs Chrome on your PC with the I read extension. Here, copy it and paste it into a new Note.'
      }
      width={480}
      footer={
        done ? (
          <div className="flex w-full justify-end gap-2">
            <a
              href="https://substack.com/notes"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-hairline px-4 text-sm font-medium text-ink hover:bg-hairline-soft"
            >
              Open Notes <ExternalLink className="size-3.5" />
            </a>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {ext.canPost ? (
              <Button onClick={post} disabled={!draft.trim() || state.step === 'posting'}>
                <SubstackMark className="size-3.5" />
                {state.step === 'posting' ? 'Posting…' : 'Post note'}
              </Button>
            ) : (
              <Button
                onClick={async () => {
                  await copyAndOpenSubstack(draft)
                  onClose()
                }}
              >
                Copy and open Substack
              </Button>
            )}
          </div>
        )
      }
    >
      {done ? (
        <p className="flex items-center gap-2 text-body-md text-body">
          <Check className="size-4 text-success" /> Your Note is live on Substack.
        </p>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={state.step === 'posting'}
            rows={7}
            aria-label="Your Note"
            className="block w-full resize-y rounded-md border border-hairline bg-canvas-elevated p-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] focus:border-link focus:ring-3 focus:ring-link/15"
          />
          {state.step === 'error' && (
            <p role="alert" className="mt-2 text-body-sm text-error">
              {state.error}
            </p>
          )}
        </>
      )}
    </Sheet>
  )
}
