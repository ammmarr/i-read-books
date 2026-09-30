import Dexie, { type EntityTable, type Transaction } from 'dexie'

export type BookStatus = 'reading' | 'queued' | 'finished' | 'none'

export interface PageSize {
  w: number
  h: number
}

/** Bookkeeping every synced record carries. Set automatically by the hooks below. */
export interface Synced {
  /** Client clock (ms) of the last local change — last write wins. */
  updatedAt?: number
  /** 1 = changed locally and not yet pushed. */
  dirty?: 0 | 1
}

export interface Book extends Synced {
  id: string
  title: string
  author: string
  fileName: string
  fileSize: number
  fingerprint: string
  /** 0 = a reading-list entry without a PDF yet. */
  pageCount: number
  /** Unscaled (scale = 1) page sizes in PDF points. */
  pageSizes: PageSize[]
  cover?: Blob
  /** Average colour sampled from the cover, used for tinted placeholders. */
  tint?: string
  addedAt: number
  lastOpenedAt?: number
  /** 0-based index of the page the reader was last on. */
  currentPage: number
  /** Fraction scrolled into the current page, to restore exactly. */
  pageOffset: number
  /**
   * When you last moved in this book (ms) — scrolling, turning pages, jumping.
   * Opening, restoring or zooming don't count. Across devices the newest wins,
   * independently of other edits to the book.
   */
  positionAt?: number
  /** Furthest page (0-based) actually read (max of readPages). */
  furthestPage: number
  /** Pages actually read (dwelled on), as compact ranges "0-12,15". Progress comes from this. */
  readPages?: string
  /**
   * When progress was set by hand (ms). A newer manual set replaces pages read
   * on every device; otherwise devices merge (union) what each has read.
   */
  readPagesSetAt?: number
  status: BookStatus
  /** Sort key for the "Up next" queue. Lower = sooner. */
  queueOrder: number
  startedAt?: number
  finishedAt?: number
  /** Cloud storage paths once uploaded. */
  filePath?: string
  coverPath?: string
  /** Remote cover (e.g. Open Library) for books without a PDF. */
  coverUrl?: string
  /** Link from an imported reading list (store page, etc.). */
  sourceUrl?: string
  /** Page count from Open Library, for time estimates before the PDF exists. */
  estPages?: number
  /** Local only: last upload failure, so we don't retry forever. */
  uploadError?: string
  /** Local only: Open Library lookup already attempted. */
  enriched?: 0 | 1
}

export interface BookFile {
  id: string
  blob: Blob
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

/** A rectangle expressed as fractions (0–1) of the page box, so it's zoom-independent. */
export type NormRect = [x: number, y: number, w: number, h: number]

export interface Highlight extends Synced {
  id: string
  bookId: string
  page: number
  color: HighlightColor
  text: string
  note?: string
  rects: NormRect[]
  createdAt: number
}

export interface Bookmark extends Synced {
  id: string
  bookId: string
  page: number
  createdAt: number
}

export interface Session extends Synced {
  id: string
  bookId: string
  start: number
  end: number
  /** Active (non-idle) reading seconds. */
  seconds: number
  /** Distinct pages dwelt on during this session. */
  pages: number[]
}

export interface Setting {
  key: string
  value: unknown
}

export type RecapQuestion = 'learned' | 'example' | 'apply'

/**
 * Your recap of a chapter: three active-recall answers written after
 * finishing it. One per chapter — the id is derived from the book and the
 * chapter's first page, so every device writes to the same record.
 */
export interface Recap extends Synced {
  id: string
  bookId: string
  /** First page of the chapter (0-based) — identifies the chapter within the book. */
  start: number
  /** Last page of the chapter (0-based, inclusive). */
  end: number
  chapter: string
  /** Section titles inside the chapter, to check your recall against afterwards. */
  sections?: string[]
  answers: Partial<Record<RecapQuestion, string>>
  /** due: chapter finished, recap not written yet · done: saved · skipped: you passed on it. */
  state: 'due' | 'done' | 'skipped'
  createdAt: number
  updatedAt: number
  /** When you last wrote or revisited it. */
  reviewedAt?: number
}

class ReaderDB extends Dexie {
  books!: EntityTable<Book, 'id'>
  files!: EntityTable<BookFile, 'id'>
  highlights!: EntityTable<Highlight, 'id'>
  bookmarks!: EntityTable<Bookmark, 'id'>
  sessions!: EntityTable<Session, 'id'>
  settings!: EntityTable<Setting, 'key'>
  recaps!: EntityTable<Recap, 'id'>

  constructor() {
    super('i-read-books')
    this.version(1).stores({
      books: 'id, fingerprint, status, addedAt, lastOpenedAt, queueOrder',
      files: 'id',
      highlights: 'id, bookId, [bookId+page], createdAt',
      bookmarks: 'id, bookId, [bookId+page]',
      sessions: 'id, bookId, start',
      settings: 'key',
    })
    this.version(2)
      .stores({
        books: 'id, fingerprint, status, addedAt, lastOpenedAt, queueOrder, dirty',
        highlights: 'id, bookId, [bookId+page], createdAt, dirty',
        bookmarks: 'id, bookId, [bookId+page], dirty',
        sessions: 'id, bookId, start, dirty',
      })
      .upgrade(async (tx) => {
        // Everything that existed before sync needs its first push.
        const now = Date.now()
        for (const t of ['books', 'highlights', 'bookmarks', 'sessions']) {
          await tx.table(t).toCollection().modify((r: Synced) => {
            r.updatedAt ??= now
            r.dirty = 1
          })
        }
      })
    this.version(3).stores({
      recaps: 'id, bookId, [bookId+start], updatedAt',
    })
    // Recaps sync too.
    this.version(4)
      .stores({ recaps: 'id, bookId, [bookId+start], updatedAt, dirty' })
      .upgrade(async (tx) => {
        await tx.table('recaps').toCollection().modify((r: Synced) => {
          r.dirty = 1
        })
      })
  }
}

export const db = new ReaderDB()

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

// ── Change tracking ────────────────────────────────────────────────────
// Every local write marks the record dirty and stamps updatedAt; deletions
// leave a tombstone. Writes made *by the sync engine* opt out by running in a
// transaction registered with `markSyncTransaction`.

export type SyncTable = 'books' | 'highlights' | 'bookmarks' | 'sessions' | 'recaps'
export const SYNC_TABLES: SyncTable[] = ['books', 'highlights', 'bookmarks', 'sessions', 'recaps']

/** Fields that never leave this device, so changing them alone isn't a sync-worthy edit. */
const LOCAL_ONLY = new Set(['cover', 'dirty', 'uploadError', 'enriched'])

const syncTransactions = new WeakSet<object>()
export function markSyncTransaction() {
  const tx = Dexie.currentTransaction
  if (tx) syncTransactions.add(tx)
}
const fromSync = (tx: Transaction | undefined) => !!tx && syncTransactions.has(tx)

const TOMBSTONE_KEY = 'irb-tombstones'
export interface Tombstone {
  table: SyncTable
  id: string
  at: number
}
export function readTombstones(): Tombstone[] {
  try {
    return JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '[]')
  } catch {
    return []
  }
}
export function writeTombstones(t: Tombstone[]) {
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(t))
  } catch {
    /* ignore */
  }
}

let onLocalChange: () => void = () => {}
/** The sync engine registers here to hear about local edits (debounced push). */
export function setLocalChangeListener(fn: () => void) {
  onLocalChange = fn
}

for (const name of SYNC_TABLES) {
  const table = db.table(name)
  table.hook('creating', function (_pk, obj: Synced & { id: string }, tx) {
    if (fromSync(tx)) return
    obj.updatedAt = Date.now()
    obj.dirty = 1
    // Re-creating something (e.g. Undo) cancels its pending deletion.
    const ts = readTombstones()
    if (ts.some((t) => t.table === name && t.id === obj.id)) writeTombstones(ts.filter((t) => !(t.table === name && t.id === obj.id)))
    queueMicrotask(onLocalChange)
  })
  table.hook('updating', function (mods: object, _pk, _obj, tx) {
    if (fromSync(tx)) return
    if (Object.keys(mods).every((k) => LOCAL_ONLY.has(k))) return
    queueMicrotask(onLocalChange)
    return { updatedAt: Date.now(), dirty: 1 }
  })
  table.hook('deleting', function (primKey, _obj, tx) {
    if (fromSync(tx)) return
    const pk = String(primKey)
    writeTombstones([...readTombstones().filter((t) => !(t.table === name && t.id === pk)), { table: name, id: pk, at: Date.now() }])
    queueMicrotask(onLocalChange)
  })
}
