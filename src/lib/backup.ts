import { db, type Book, type Bookmark, type Highlight, type Session } from '../db/db'
import { isNative, shareTextFile } from './native'

interface BackupFile {
  app: 'i-read-books'
  version: 1
  exportedAt: number
  books: (Omit<Book, 'cover'> & { cover?: undefined })[]
  highlights: Highlight[]
  bookmarks: Bookmark[]
  sessions: Session[]
  settings: string | null
}

/** Everything except the PDFs themselves (those are big and you already have them). */
export async function exportBackup() {
  const books = (await db.books.toArray()).map(({ cover: _cover, ...b }) => b)
  const data: BackupFile = {
    app: 'i-read-books',
    version: 1,
    exportedAt: Date.now(),
    books,
    highlights: await db.highlights.toArray(),
    bookmarks: await db.bookmarks.toArray(),
    sessions: await db.sessions.toArray(),
    settings: (() => {
      try { return localStorage.getItem('irb-settings') } catch { return null }
    })(),
  }
  const name = `i-read-books-backup-${new Date().toISOString().slice(0, 10)}.json`
  if (isNative) return shareTextFile(name, JSON.stringify(data), 'I READ BOOKS backup')
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/**
 * Restores highlights, bookmarks, sessions and progress onto books already in
 * the library (matched by the PDF's fingerprint, so ids don't need to match).
 */
export async function importBackup(file: File) {
  const data = JSON.parse(await file.text()) as BackupFile
  if (data.app !== 'i-read-books') throw new Error('Not an I READ BOOKS backup')
  const local = await db.books.toArray()
  const byPrint = new Map(local.map((b) => [b.fingerprint, b]))
  const idMap = new Map<string, string>()
  let missing = 0
  for (const b of data.books) {
    const l = byPrint.get(b.fingerprint)
    if (!l) {
      missing++
      continue
    }
    idMap.set(b.id, l.id)
    await db.books.update(l.id, {
      currentPage: Math.max(l.currentPage, b.currentPage),
      furthestPage: Math.max(l.furthestPage, b.furthestPage),
      status: b.status,
      finishedAt: b.finishedAt ?? l.finishedAt,
      startedAt: b.startedAt ?? l.startedAt,
      title: b.title,
      author: b.author,
    })
  }
  const remap = <T extends { bookId: string }>(xs: T[]) => xs.filter((x) => idMap.has(x.bookId)).map((x) => ({ ...x, bookId: idMap.get(x.bookId)! }))
  const hl = remap(data.highlights)
  const bm = remap(data.bookmarks)
  const ss = remap(data.sessions)
  await db.transaction('rw', db.highlights, db.bookmarks, db.sessions, async () => {
    await db.highlights.bulkPut(hl)
    await db.bookmarks.bulkPut(bm)
    await db.sessions.bulkPut(ss)
  })
  return { matched: idMap.size, missing, highlights: hl.length, sessions: ss.length }
}
