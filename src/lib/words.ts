import { db, uid, type Lookup } from '../db/db'
import type { Meaning } from './dictionary'

/** Opening the same word's card again within this is still one lookup. */
const SAME_LOOKUP_MS = 10 * 60_000

/** "noun · A force compounded by means of a lever …" */
export function gistOf(m: Meaning) {
  const g = m.groups[0]
  if (!g) return undefined
  const d = g.senses[0]?.definition ?? ''
  const lead = m.formOf ? `${m.formOf.label} ${m.formOf.lemma}: ` : ''
  const text = `${g.partOfSpeech.toLowerCase()} · ${lead}${d}`
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text
}

/** Remember a lookup (from the reader) for the Words page. */
export async function noteLookup(l: { word: string; bookId: string; page: number; top?: number; context?: string; gist?: string }) {
  const now = Date.now()
  const recent = await db.lookups
    .where('word')
    .equals(l.word)
    .filter((x) => x.bookId === l.bookId && now - x.lookedAt < SAME_LOOKUP_MS)
    .first()
  if (recent) {
    if (l.gist && recent.gist !== l.gist) await db.lookups.update(recent.id, { gist: l.gist })
    return
  }
  await db.lookups.add({ id: uid(), ...l, lookedAt: now })
}

export interface WordEntry {
  key: string
  /** The latest form looked up. */
  word: string
  count: number
  firstAt: number
  lastAt: number
  gist?: string
  /** The latest lookup (where, and the sentence). */
  latest: Lookup
  bookIds: string[]
  lookups: Lookup[]
}

/** Lookups → one entry per word (case aside), most recent first. */
export function groupLookups(lookups: Lookup[]): WordEntry[] {
  const by = new Map<string, Lookup[]>()
  for (const l of lookups) {
    const k = l.word.toLowerCase()
    by.set(k, [...(by.get(k) ?? []), l])
  }
  return [...by.entries()]
    .map(([key, ls]) => {
      const sorted = [...ls].sort((a, b) => b.lookedAt - a.lookedAt)
      const latest = sorted[0]
      return {
        key,
        word: latest.word,
        count: ls.length,
        firstAt: sorted[sorted.length - 1].lookedAt,
        lastAt: latest.lookedAt,
        gist: sorted.find((l) => l.gist)?.gist,
        latest,
        bookIds: [...new Set(sorted.map((l) => l.bookId))],
        lookups: sorted,
      }
    })
    .sort((a, b) => b.lastAt - a.lastAt)
}
