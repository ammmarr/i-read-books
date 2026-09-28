import { db, uid, type Book, type BookStatus, type Bookmark, type Highlight, type Session, type BookFile, type PageSize } from './db'
import { closePdf, getPageSizes, openPdf, readMetadata, renderCover } from '../lib/pdf'
import { readCount } from '../lib/pages'

export class DuplicateBookError extends Error {
  book: Book
  constructor(book: Book) {
    super(`"${book.title}" is already in your library`)
    this.book = book
  }
}

function titleFromFileName(name: string) {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s*[-–]\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Metadata titles are often junk ("Microsoft Word - draft3.docx"). */
function usableTitle(t: string) {
  if (!t || t.length < 2) return false
  if (/^(untitled|microsoft word|document\d*|\d+)$/i.test(t)) return false
  if (/\.(docx?|indd|tex|pdf|pages)$/i.test(t)) return false
  return true
}

/** Loose title key: "The Psychology of Money (2020).pdf" → "psychology of money". */
export function titleKey(t: string) {
  return t
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A reading-list entry (no PDF yet) this file most likely belongs to. */
async function findListEntry(title: string, fileName: string) {
  const keys = [titleKey(title), titleKey(titleFromFileName(fileName))].filter((k) => k.length >= 4)
  const entries = await db.books.filter((b) => b.pageCount === 0).toArray()
  return entries.find((b) => {
    const k = titleKey(b.title)
    return k.length >= 4 && keys.some((x) => x === k || x.startsWith(k + ' ') || k.startsWith(x + ' '))
  })
}

export interface ImportResult {
  book: Book
  /** The PDF was attached to an existing reading-list entry. */
  attached: boolean
}

/** Everything read from a PDF before it's added — shown for review in "Add book". */
export interface PdfAnalysis {
  file: File
  bytes: Uint8Array
  fingerprint: string
  title: string
  author: string
  pageCount: number
  pageSizes: PageSize[]
  cover?: Blob
  tint: string
  /** Same file is already in the library. */
  duplicate?: Book
  /** A reading-list entry (no PDF yet) this file looks like. */
  match?: Book
}

export async function analyzePdf(file: File): Promise<PdfAnalysis> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const doc = await openPdf(bytes.slice())
  try {
    const fingerprint = doc.fingerprints[0] ?? `${file.name}-${file.size}`
    const [duplicate, meta, pageSizes, cover] = await Promise.all([
      db.books.where('fingerprint').equals(fingerprint).first(),
      readMetadata(doc),
      getPageSizes(doc),
      renderCover(doc).catch(() => ({ blob: undefined, tint: '#e5e5e5' })),
    ])
    const title = usableTitle(meta.title) ? meta.title : titleFromFileName(file.name)
    return {
      file,
      bytes,
      fingerprint,
      title,
      author: meta.author,
      pageCount: doc.numPages,
      pageSizes,
      cover: cover.blob,
      tint: cover.tint ?? '#e5e5e5',
      duplicate,
      match: duplicate ? undefined : await findListEntry(title, file.name),
    }
  } finally {
    closePdf(doc)
  }
}

export async function addAnalyzedPdf(
  a: PdfAnalysis,
  opts: { title?: string; author?: string; status?: BookStatus; attachTo?: string | null } = {},
): Promise<ImportResult> {
  if (a.duplicate) throw new DuplicateBookError(a.duplicate)
  const pdfFields = {
    fileName: a.file.name,
    fileSize: a.file.size,
    fingerprint: a.fingerprint,
    pageCount: a.pageCount,
    pageSizes: a.pageSizes,
    cover: a.cover,
    tint: a.tint,
    // New file and cover → upload them again.
    filePath: undefined,
    coverPath: undefined,
    uploadError: undefined,
  }
  const blob = new Blob([a.bytes as BlobPart], { type: 'application/pdf' })

  // A PDF for a book already on your reading list fills in that entry.
  const entryId = opts.attachTo === null ? undefined : (opts.attachTo ?? a.match?.id)
  const entry = entryId ? await db.books.get(entryId) : undefined
  if (entry) {
    const book: Book = { ...entry, ...pdfFields, author: entry.author || opts.author?.trim() || a.author }
    await db.transaction('rw', db.books, db.files, async () => {
      await db.books.put(book)
      await db.files.put({ id: book.id, blob })
    })
    return { book, attached: true }
  }

  const status = opts.status ?? 'queued'
  const maxOrder = (await db.books.orderBy('queueOrder').last())?.queueOrder ?? 0
  const now = Date.now()
  const book: Book = {
    id: uid(),
    title: opts.title?.trim() || a.title,
    author: opts.author?.trim() ?? a.author,
    ...pdfFields,
    addedAt: now,
    currentPage: 0,
    pageOffset: 0,
    furthestPage: status === 'finished' ? Math.max(0, a.pageCount - 1) : 0,
    status,
    queueOrder: maxOrder + 1,
    startedAt: status === 'reading' ? now : undefined,
    finishedAt: status === 'finished' ? now : undefined,
  }
  await db.transaction('rw', db.books, db.files, async () => {
    await db.books.add(book)
    await db.files.add({ id: book.id, blob })
  })
  // Ask the browser not to evict the library under storage pressure.
  navigator.storage?.persist?.().catch(() => {})
  return { book, attached: false }
}

export async function importPdf(file: File, { attachTo }: { attachTo?: string } = {}): Promise<ImportResult> {
  return addAnalyzedPdf(await analyzePdf(file), { attachTo })
}

export class DuplicateTitleError extends Error {
  book: Book
  constructor(book: Book) {
    super(`"${book.title}" is already in your library`)
    this.book = book
  }
}

/** A book you don't have the PDF for yet — it lives on your reading list. */
export async function addListBook(input: {
  title: string
  author?: string
  status?: BookStatus
  coverUrl?: string
  estPages?: number
  sourceUrl?: string
}): Promise<Book> {
  const title = input.title.trim()
  const key = titleKey(title)
  const existing = (await db.books.toArray()).find((b) => titleKey(b.title) === key)
  if (existing) throw new DuplicateTitleError(existing)
  const status = input.status ?? 'queued'
  const now = Date.now()
  const maxOrder = (await db.books.orderBy('queueOrder').last())?.queueOrder ?? 0
  const book: Book = {
    id: uid(),
    title,
    author: input.author?.trim() ?? '',
    fileName: '',
    fileSize: 0,
    fingerprint: `list:${key}`,
    pageCount: 0,
    pageSizes: [],
    addedAt: now,
    currentPage: 0,
    pageOffset: 0,
    furthestPage: 0,
    status,
    queueOrder: maxOrder + 1,
    finishedAt: status === 'finished' ? now : undefined,
    startedAt: status === 'reading' ? now : undefined,
    coverUrl: input.coverUrl,
    estPages: input.estPages,
    sourceUrl: input.sourceUrl,
    // With a catalogue pick we already have the details.
    enriched: input.coverUrl ? 1 : undefined,
  }
  await db.books.add(book)
  return book
}

export interface BookSnapshot {
  book: Book
  file?: BookFile
  highlights: Highlight[]
  bookmarks: Bookmark[]
  sessions: Session[]
}

/** Deletes a book and everything attached to it, returning a snapshot for undo. */
export async function deleteBook(id: string): Promise<BookSnapshot | null> {
  return db.transaction('rw', [db.books, db.files, db.highlights, db.bookmarks, db.sessions], async () => {
    const book = await db.books.get(id)
    if (!book) return null
    const snap: BookSnapshot = {
      book,
      file: await db.files.get(id),
      highlights: await db.highlights.where('bookId').equals(id).toArray(),
      bookmarks: await db.bookmarks.where('bookId').equals(id).toArray(),
      sessions: await db.sessions.where('bookId').equals(id).toArray(),
    }
    await db.books.delete(id)
    await db.files.delete(id)
    await db.highlights.where('bookId').equals(id).delete()
    await db.bookmarks.where('bookId').equals(id).delete()
    await db.sessions.where('bookId').equals(id).delete()
    return snap
  })
}

export async function restoreBook(snap: BookSnapshot) {
  await db.transaction('rw', [db.books, db.files, db.highlights, db.bookmarks, db.sessions], async () => {
    // The cloud copies may already be gone — upload them again.
    await db.books.put({ ...snap.book, filePath: snap.file ? undefined : snap.book.filePath, coverPath: undefined })
    if (snap.file) await db.files.put(snap.file)
    await db.highlights.bulkPut(snap.highlights)
    await db.bookmarks.bulkPut(snap.bookmarks)
    await db.sessions.bulkPut(snap.sessions)
  })
}

export async function setStatus(id: string, status: BookStatus) {
  const book = await db.books.get(id)
  if (!book) return
  const patch: Partial<Book> = { status }
  if (status === 'finished') {
    patch.finishedAt = Date.now()
    patch.furthestPage = Math.max(0, book.pageCount - 1)
  }
  if (status === 'reading' && !book.startedAt) patch.startedAt = Date.now()
  if (status === 'queued') {
    const maxOrder = (await db.books.orderBy('queueOrder').last())?.queueOrder ?? 0
    patch.queueOrder = maxOrder + 1
  }
  await db.books.update(id, patch)
}

export async function reorderQueue(ids: string[]) {
  await db.transaction('rw', db.books, async () => {
    await Promise.all(ids.map((id, i) => db.books.update(id, { queueOrder: i + 1 })))
  })
}

export async function renameBook(id: string, title: string, author: string) {
  await db.books.update(id, { title: title.trim() || 'Untitled', author: author.trim() })
}

/** Progress 0–1 based on the furthest page reached. */
export function bookProgress(b: Pick<Book, 'furthestPage' | 'pageCount' | 'status' | 'readPages'>) {
  if (b.status === 'finished') return 1
  if (b.pageCount <= 1) return 0
  // Share of pages actually read — jumping ahead doesn't move this.
  return Math.min(1, readCount(b) / b.pageCount)
}
