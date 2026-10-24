import { useSyncExternalStore } from 'react'

/**
 * Sharing a quote: X opens its own post screen with the quote ready; a
 * Substack Note is posted through the I read Chrome extension (extension/),
 * which sends it from substack.com with your signed-in session — Substack
 * has no public way for apps to post.
 */

export interface QuoteSource {
  title: string
  author?: string
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const byline = (b: QuoteSource) => [b.author?.trim(), b.title?.trim()].filter(Boolean).join(', ')

/** “Quote” — Author, Book. Kept within X's 280 characters. */
export function xPostText(text: string, book: QuoteSource) {
  const by = byline(book)
  const tail = by ? `\n\n— ${by}` : ''
  let quote = clean(text)
  const room = 280 - tail.length - 2
  if (quote.length > room) quote = `${quote.slice(0, room - 1).trimEnd()}…`
  return `“${quote}”${tail}`
}

/** The same for a Substack Note (no length limit to speak of). */
export function noteText(text: string, book: QuoteSource) {
  const by = byline(book)
  return `“${clean(text)}”${by ? `\n\n— ${by}` : ''}`
}

/** X's own post screen, filled in — you press Post there. */
export function openXPost(text: string) {
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
}

// ── The Chrome extension, as seen from the app ───────────────────────────
// Its content script (only on this site) answers "ping" with "hello".
interface Ext {
  present: boolean
  version?: string
}
let ext: Ext = { present: false }
const listeners = new Set<() => void>()
const pending = new Map<string, (r: NoteResult) => void>()

export interface NoteResult {
  ok: boolean
  error?: string
  /** The posted Note's id on Substack. */
  noteId?: number
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return
    const d = e.data as { source?: string; type?: string; version?: string; requestId?: string; ok?: boolean; error?: string; id?: number }
    if (d?.source !== 'i-read-ext') return
    if (d.type === 'hello') {
      ext = { present: true, version: d.version }
      listeners.forEach((l) => l())
    }
    if (d.type === 'substackNoteResult' && d.requestId) {
      pending.get(d.requestId)?.({ ok: !!d.ok, error: d.error, noteId: d.id })
      pending.delete(d.requestId)
    }
  })
  window.postMessage({ source: 'i-read', type: 'ping' }, location.origin)
}

/** Whether the I read extension is in this browser (and can post Notes: 1.1+). */
export function useExtension(): Ext & { canPost: boolean } {
  const e = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => ext,
  )
  const [maj = 0, min = 0] = (e.version ?? '0.0').split('.').map(Number)
  return { ...e, canPost: e.present && (maj > 1 || (maj === 1 && min >= 1)) }
}

/** Post a Substack Note through the extension. */
export function postSubstackNote(text: string): Promise<NoteResult> {
  const id = Math.random().toString(36).slice(2)
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, error: 'No answer from the extension — is Chrome still open?' })
    }, 60_000)
    pending.set(id, (r) => {
      clearTimeout(t)
      resolve(r)
    })
    window.postMessage({ source: 'i-read', type: 'substackNote', id, text }, location.origin)
  })
}

/** Without the extension (a tablet): copy the Note and open Substack to paste it. */
export async function copyAndOpenSubstack(text: string) {
  await navigator.clipboard?.writeText(text).catch(() => {})
  window.open('https://substack.com/notes', '_blank', 'noopener,noreferrer')
}
