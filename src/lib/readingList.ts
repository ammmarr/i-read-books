import { db, markSyncTransaction, uid, type Book, type BookStatus } from '../db/db'
import { titleKey } from '../db/books'

/** RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim()))
}

interface ListItem {
  title: string
  author: string
  status: BookStatus
  finishedAt?: number
  sourceUrl?: string
  estPages?: number
}

const clean = (s = '') => s.replace(/\s+/g, ' ').trim()

/** "the power of now" → "The Power of Now"; leaves already-cased titles alone. */
function titleCase(s: string) {
  if (s !== s.toLowerCase()) return s
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with'])
  return s.replace(/\S+/g, (w, i: number) => (i > 0 && small.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
}

/**
 * Understands Notion exports (Name, Author, Status, Done, URL) and Goodreads
 * exports (Title, Author, Exclusive Shelf, Date Read, Number of Pages).
 */
export function readListCsv(text: string): ListItem[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => clean(h).toLowerCase() === n))
  const iTitle = col('name', 'title', 'book', 'book title')
  const iAuthor = col('author', 'authors', 'author l-f')
  const iStatus = col('status', 'exclusive shelf', 'shelf', 'read status')
  const iDone = col('done', 'read', 'finished', 'completed')
  const iUrl = col('url', 'link')
  const iDate = col('date read', 'finished date', 'date finished')
  const iPages = col('number of pages', 'pages')
  if (iTitle < 0) throw new Error('Couldn’t find a title column (expected “Name” or “Title”).')

  const out: ListItem[] = []
  for (const r of rows) {
    let title = clean(r[iTitle])
    let author = iAuthor >= 0 ? clean(r[iAuthor]) : ''
    if (!title) continue
    // "Meditations - Marcus Aurelius" with no author column value.
    if (!author && / [-–] /.test(title)) {
      const [t, ...a] = title.split(/ [-–] /)
      title = t
      author = a.join(' - ')
    }
    const status = clean(iStatus >= 0 ? r[iStatus] : '').toLowerCase()
    const done = /^(yes|true|x|✓|1|checked)$/i.test(clean(iDone >= 0 ? r[iDone] : ''))
    const finished = done || /^(read|done|finished|completed)$/.test(status)
    const reading = /^(reading|currently[- ]reading|in progress|started)$/.test(status)
    const date = iDate >= 0 ? Date.parse(clean(r[iDate]).replace(/\//g, '-')) : NaN
    const pages = iPages >= 0 ? parseInt(r[iPages], 10) : NaN
    out.push({
      title: titleCase(title),
      author: author && author === author.toLowerCase() ? titleCase(author) : author,
      status: finished ? 'finished' : reading ? 'reading' : 'queued',
      finishedAt: finished && !Number.isNaN(date) ? date : undefined,
      sourceUrl: iUrl >= 0 && /^https?:\/\//.test(clean(r[iUrl])) ? clean(r[iUrl]) : undefined,
      estPages: Number.isFinite(pages) && pages > 0 ? pages : undefined,
    })
  }
  return out
}

/** Adds list entries as books without a PDF, skipping titles already in the library. */
export async function importReadingList(items: ListItem[]) {
  const existing = new Set((await db.books.toArray()).map((b) => titleKey(b.title)))
  let order = (await db.books.orderBy('queueOrder').last())?.queueOrder ?? 0
  const now = Date.now()
  const fresh: Book[] = []
  for (const [i, it] of items.entries()) {
    const key = titleKey(it.title)
    if (!key || existing.has(key)) continue
    existing.add(key)
    fresh.push({
      id: uid(),
      title: it.title,
      author: it.author,
      fileName: '',
      fileSize: 0,
      fingerprint: `list:${key}`,
      pageCount: 0,
      pageSizes: [],
      addedAt: now - i, // keep the list's order under "Recently added"
      currentPage: 0,
      pageOffset: 0,
      furthestPage: 0,
      status: it.status,
      queueOrder: ++order,
      finishedAt: it.finishedAt,
      sourceUrl: it.sourceUrl,
      estPages: it.estPages,
    })
  }
  await db.books.bulkAdd(fresh)
  void enrichFromOpenLibrary()
  return { added: fresh.length, skipped: items.length - fresh.length }
}

let enriching = false

export interface CatalogBook {
  title: string
  author?: string
  cover?: string
  pages?: number
  year?: number
  editions: number
}

type OLDoc = {
  title?: string
  subtitle?: string
  alternative_title?: string[]
  author_name?: string[]
  cover_i?: number
  number_of_pages_median?: number
  first_publish_year?: number
  edition_count?: number
}

const OL_FIELDS = 'title,subtitle,alternative_title,author_name,cover_i,number_of_pages_median,first_publish_year,edition_count'

const toCatalog = (d: OLDoc): CatalogBook => ({
  title: d.title ?? '',
  author: d.author_name?.[0],
  cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
  pages: d.number_of_pages_median,
  year: d.first_publish_year,
  editions: d.edition_count ?? 0,
})

async function olSearch(q: string, limit = 10, signal?: AbortSignal): Promise<OLDoc[]> {
  const res = await fetch(`https://openlibrary.org/search.json?${new URLSearchParams({ q, limit: String(limit), fields: OL_FIELDS })}`, { signal })
  return res.ok ? (((await res.json()) as { docs?: OLDoc[] }).docs ?? []) : []
}

/**
 * The catalogue entry that really is this book. Open Library returns plenty of
 * look-alikes ("Summary of …", workbooks, one-off reprints), so a result must
 * either carry this exact title (incl. subtitles/alternate titles) or be a
 * well-established work that shares most of the title's words.
 */
export async function findInCatalog(title: string, author?: string): Promise<CatalogBook | null> {
  let docs = await olSearch(author ? `${title} ${author}` : title)
  if (!docs.length && author) docs = await olSearch(title)
  const key = titleKey(title)
  const words = key.split(' ').filter((w) => w.length > 2)
  const names = (d: OLDoc) => [d.title, d.subtitle, d.title && d.subtitle ? `${d.title} ${d.subtitle}` : null, ...(d.alternative_title ?? [])].filter(Boolean) as string[]
  const exact = (d: OLDoc) => names(d).some((n) => {
    const k = titleKey(n)
    return k === key || k.startsWith(key + ' ')
  })
  const overlap = (d: OLDoc) => {
    const hay = titleKey([...names(d), ...(d.author_name ?? [])].join(' '))
    return words.filter((w) => hay.includes(w)).length / Math.max(1, words.length)
  }
  const best = docs
    .filter((d) => exact(d) || ((d.edition_count ?? 0) >= 5 && overlap(d) >= 0.6))
    .sort((a, b) => (b.edition_count ?? 0) - (a.edition_count ?? 0))[0]
  return best ? toCatalog(best) : null
}

/** Type-ahead suggestions for "Add a book without a PDF". */
export async function suggestBooks(query: string, signal?: AbortSignal): Promise<CatalogBook[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const docs = await olSearch(q, 12, signal)
  const key = titleKey(q)
  const words = key.split(' ').filter(Boolean)
  // How well a title matches what you typed: the start of a title beats
  // containing all your words, which beats a loose hit.
  const score = (t: string) => {
    const k = titleKey(t)
    if (k === key) return 0
    if (k.startsWith(key)) return 1
    if (words.every((w) => k.includes(w))) return 2
    return 3
  }
  const best = new Map<string, { b: CatalogBook; rank: number; i: number }>()
  docs.forEach((d, i) => {
    if (!d.title) return
    // Famous books are often filed under their original title (嫌われる勇気);
    // match — and show — the alternate title you actually typed.
    const names = [d.title, ...(d.alternative_title ?? [])]
    let shown = names.reduce((a, n) => (score(n) < score(a) ? n : a), d.title)
    // Open Library's top hit is a well-known work catalogued only under a
    // non-Latin original title: show it under the title you typed.
    if (i === 0 && !/[a-z]/i.test(d.title) && (d.edition_count ?? 0) >= 5 && /[a-z]/i.test(q)) shown = titleCase(q)
    const b = { ...toCatalog(d), title: shown }
    const rank = score(shown)
    const k = `${titleKey(b.title)}|${b.author ?? ''}`
    const prev = best.get(k)
    if (!prev || b.editions > prev.b.editions) best.set(k, { b: prev && !b.cover ? { ...b, cover: prev.b.cover } : b, rank, i: prev?.i ?? i })
  })
  return [...best.values()]
    // Match quality first; among equals the well-known edition wins, then OL's order.
    .sort((x, y) => x.rank - y.rank || Math.sign(y.b.editions - x.b.editions) * (Math.abs(y.b.editions - x.b.editions) >= 3 ? 1 : 0) || x.i - y.i)
    .map((x) => x.b)
    .slice(0, 6)
}

/**
 * Looks up covers, authors and page counts on Open Library for books that
 * don't have a PDF yet. Only the title and author are sent.
 */
export async function enrichFromOpenLibrary() {
  if (enriching || !navigator.onLine) return
  enriching = true
  try {
    const todo = await db.books.filter((b) => b.pageCount === 0 && !b.enriched && !b.coverUrl && !b.cover).toArray()
    for (const b of todo) {
      try {
        const hit = await findInCatalog(b.title, b.author || undefined)
        const patch: Partial<Book> = {}
        if (hit?.cover) patch.coverUrl = hit.cover
        // Only borrow an author from a well-established edition.
        if (hit?.author && !b.author && hit.editions >= 3) patch.author = hit.author
        if (hit?.pages && !b.estPages) patch.estPages = hit.pages
        if (Object.keys(patch).length) await db.books.update(b.id, patch)
      } catch {
        /* offline or rate-limited — try again another time */
        continue
      }
      await db.transaction('rw', db.books, async () => {
        markSyncTransaction()
        await db.books.update(b.id, { enriched: 1 })
      })
      await new Promise((r) => setTimeout(r, 250))
    }
  } finally {
    enriching = false
  }
}
