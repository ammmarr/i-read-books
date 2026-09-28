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
        const q = new URLSearchParams({ title: b.title, limit: '1', fields: 'title,author_name,cover_i,number_of_pages_median' })
        if (b.author) q.set('author', b.author)
        let res = await fetch(`https://openlibrary.org/search.json?${q}`)
        let json = res.ok ? await res.json() : null
        if (!json?.docs?.length && b.author) {
          q.delete('author')
          res = await fetch(`https://openlibrary.org/search.json?${q}`)
          json = res.ok ? await res.json() : null
        }
        const doc = json?.docs?.[0] as { title?: string; author_name?: string[]; cover_i?: number; number_of_pages_median?: number } | undefined
        const patch: Partial<Book> = {}
        if (doc?.cover_i) patch.coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        if (doc?.author_name?.[0] && !b.author) patch.author = doc.author_name[0]
        if (doc?.number_of_pages_median && !b.estPages) patch.estPages = doc.number_of_pages_median
        // Adopt the catalogue's casing when it's clearly the same title.
        if (doc?.title && titleKey(doc.title) === titleKey(b.title) && doc.title !== b.title) patch.title = doc.title
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
