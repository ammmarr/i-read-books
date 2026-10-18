/**
 * Word meanings, free: Wiktionary's public definitions API — no key, no
 * account, the same as looking a word up in a browser. Meanings are kept on
 * the device, so a word looked up once also works offline.
 */

export interface Sense {
  definition: string
  example?: string
}
export interface WordGroup {
  partOfSpeech: string
  language: string
  senses: Sense[]
}
export interface Meaning {
  /** The word as found (e.g. lower-cased from the start of a sentence). */
  word: string
  /** "leveraged" → { label: "simple past tense and past participle of", lemma: "leverage" }: groups are the lemma's. */
  formOf?: { label: string; lemma: string }
  groups: WordGroup[]
  url: string
}

export class OfflineError extends Error {}

const API = 'https://en.wiktionary.org/api/rest_v1/page/definition/'
const PAGE = 'https://en.wiktionary.org/wiki/'
const CACHE_KEY = 'irb-dictionary'
const MAX_CACHED = 300

/** What to look up from a selection: no surrounding punctuation or possessive ’s; null if it isn't a word or short phrase. */
export function wordFrom(text: string): string | null {
  const t = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[’']s$/u, '')
  if (!t || t.length > 40 || t.split(' ').length > 3 || !/\p{L}/u.test(t)) return null
  return t
}

type RawDef = { definition: string; examples?: string[] }
type Raw = Record<string, { partOfSpeech: string; language: string; definitions: RawDef[] }[]>

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html').body
const plain = (html: string) => (parseHtml(html).textContent ?? '').replace(/\s+/g, ' ').trim()

async function fetchRaw(word: string, signal?: AbortSignal): Promise<Raw | null> {
  const res = await fetch(API + encodeURIComponent(word.replace(/ /g, '_')), { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Dictionary answered ${res.status}`)
  return (await res.json()) as Raw
}

/** English if the word is English, otherwise the first language that has it. */
function entriesOf(raw: Raw) {
  const lang = raw.en?.length ? 'en' : Object.keys(raw).find((l) => raw[l]?.length)
  return lang ? raw[lang] : []
}

function groupsOf(raw: Raw): WordGroup[] {
  return entriesOf(raw)
    .map((g) => ({
      partOfSpeech: g.partOfSpeech,
      language: g.language,
      senses: g.definitions
        .map((d) => ({ definition: plain(d.definition), example: d.examples?.[0] ? plain(d.examples[0]) : undefined }))
        .filter((s) => s.definition)
        .slice(0, 4),
    }))
    .filter((g) => g.senses.length)
}

const FORM = /\b(plural|singular|past|present|participle|third-person|comparative|superlative|gerund|inflection|form|spelling)\b/i

/** Every sense is "… of <lemma>" (a plural, a past tense…): which word it's a form of. */
function formOf(raw: Raw): Meaning['formOf'] {
  const defs = entriesOf(raw).flatMap((g) => g.definitions)
  if (!defs.length) return undefined
  let found: Meaning['formOf']
  for (const d of defs) {
    const text = plain(d.definition)
    const m = /^(.*\bof)\s+(.+?)\.?$/i.exec(text)
    if (!m || !FORM.test(m[1])) return undefined
    const links = parseHtml(d.definition).querySelectorAll('a')
    const lemma = links[links.length - 1]?.getAttribute('title') || m[2]
    found ??= { label: m[1], lemma: lemma.replace(/#.*$/, '') }
  }
  return found
}

// ── Kept on the device ────────────────────────────────────────────────────
let memory: Record<string, Meaning> | null = null
function cache() {
  if (!memory) {
    try {
      memory = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, Meaning>
    } catch {
      memory = {}
    }
  }
  return memory
}
function remember(key: string, m: Meaning) {
  const c = cache()
  delete c[key]
  c[key] = m
  const keys = Object.keys(c)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_CACHED))) delete c[k]
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    /* full or blocked: it just won't be offline next time */
  }
}

/** The meaning of `word`, or null when the dictionary doesn't have it. Throws OfflineError when offline and not looked up before. */
export async function define(word: string, signal?: AbortSignal): Promise<Meaning | null> {
  const key = word
  const known = cache()[key]
  if (known) return known
  if (!navigator.onLine) throw new OfflineError('offline')
  // As written first ("Buffett" is a name, not a buffet), then lower-cased
  // ("However" at the start of a sentence is "however").
  const tries = [...new Set([word, word.toLowerCase()])]
  for (const w of tries) {
    const raw = await fetchRaw(w, signal)
    if (!raw) continue
    const groups = groupsOf(raw)
    if (!groups.length) continue
    const meaning: Meaning = { word: w, groups, url: PAGE + encodeURIComponent(w.replace(/ /g, '_')) }
    const form = formOf(raw)
    if (form && form.lemma.toLowerCase() !== w.toLowerCase()) {
      const lemmaRaw = await fetchRaw(form.lemma, signal).catch(() => null)
      const lemmaGroups = lemmaRaw ? groupsOf(lemmaRaw) : []
      if (lemmaGroups.length) {
        meaning.formOf = form
        meaning.groups = lemmaGroups
        meaning.url = PAGE + encodeURIComponent(form.lemma.replace(/ /g, '_'))
      }
    }
    remember(key, meaning)
    return meaning
  }
  return null
}
