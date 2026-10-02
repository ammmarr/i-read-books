import { useSyncExternalStore } from 'react'
import {
  db, markSyncTransaction, readTombstones, setLocalChangeListener, writeTombstones, SYNC_TABLES,
  type Book, type Bookmark, type Highlight, type Recap, type Session, type SyncTable,
} from '../db/db'
import { BUCKET, getAuthSession, onAuthChange, supabase } from './supabase'
import { formatPages, readPagesOf } from './pages'
import { kindFromId } from './recaps'
import { SYNCED_SETTINGS, getSettings, getSettingsMeta, setSettingsChangeListener, setSettingsMeta, updateSettings, type Settings } from './settings'

/**
 * Local-first sync. IndexedDB stays the source the UI reads from (instant and
 * offline); this engine reconciles it with Supabase:
 *   pull  rows changed on the server since our cursor (by server_ts)
 *   push  rows marked dirty locally, plus tombstones for deletions
 *   files upload new PDFs/covers; download covers (PDFs download on open)
 * Conflicts resolve last-write-wins on updated_at, enforced by a DB trigger.
 */

export type SyncStatus = 'off' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error'

interface State {
  status: SyncStatus
  lastSyncedAt: number | null
  error: string | null
  /** Sync works, but the database is older than the app (some fields aren't saved). */
  warning: string | null
}

let state: State = { status: supabase ? 'signed-out' : 'off', lastSyncedAt: null, error: null, warning: null }
const listeners = new Set<() => void>()
function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useSyncState() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

const REMOTE: Record<SyncTable, string> = {
  books: 'irb_books',
  highlights: 'irb_highlights',
  bookmarks: 'irb_bookmarks',
  sessions: 'irb_sessions',
  recaps: 'irb_recaps',
}

/** Supabase's free plan caps a single upload at 50 MB. */
const MAX_UPLOAD = 50 * 1024 * 1024
const n = <T,>(v: T | undefined) => (v === undefined ? null : v)

type Row = Record<string, unknown>

function toRemote(table: SyncTable, r: Row): Row {
  switch (table) {
    case 'books': {
      const b = r as unknown as Book
      return {
        id: b.id, title: b.title, author: b.author, file_name: b.fileName, file_size: b.fileSize, fingerprint: b.fingerprint,
        page_count: b.pageCount, page_sizes: b.pageSizes, tint: n(b.tint), added_at: b.addedAt, last_opened_at: n(b.lastOpenedAt),
        current_page: b.currentPage, page_offset: b.pageOffset, position_at: n(b.positionAt), furthest_page: b.furthestPage, read_pages: n(b.readPages), read_pages_set_at: n(b.readPagesSetAt), status: b.status,
        queue_order: b.queueOrder, started_at: n(b.startedAt), finished_at: n(b.finishedAt), file_path: n(b.filePath),
        cover_path: n(b.coverPath), cover_url: n(b.coverUrl), source_url: n(b.sourceUrl), est_pages: n(b.estPages),
        updated_at: b.updatedAt ?? Date.now(), deleted: false,
      }
    }
    case 'highlights': {
      const h = r as unknown as Highlight
      return {
        id: h.id, book_id: h.bookId, page: h.page, color: h.color, text: h.text, note: n(h.note), rects: h.rects,
        created_at: h.createdAt, updated_at: h.updatedAt ?? Date.now(), deleted: false,
      }
    }
    case 'bookmarks': {
      const b = r as unknown as Bookmark
      return { id: b.id, book_id: b.bookId, page: b.page, created_at: b.createdAt, updated_at: b.updatedAt ?? Date.now(), deleted: false }
    }
    case 'sessions': {
      const s = r as unknown as Session
      return {
        id: s.id, book_id: s.bookId, start_ms: s.start, end_ms: s.end, seconds: s.seconds, pages: s.pages,
        updated_at: s.updatedAt ?? Date.now(), deleted: false,
      }
    }
    case 'recaps': {
      const c = r as unknown as Recap
      return {
        id: c.id, book_id: c.bookId, start_page: c.start, end_page: c.end, chapter: c.chapter, sections: c.sections ?? [],
        kind: c.kind ?? 'chapter', parent: n(c.parent),
        answers: c.answers ?? {}, state: c.state, created_at: c.createdAt, reviewed_at: n(c.reviewedAt),
        updated_at: c.updatedAt ?? Date.now(), deleted: false,
      }
    }
  }
}

const u = <T,>(v: T | null) => (v === null ? undefined : v)

function fromRemote(table: SyncTable, r: Row, local?: Row): Row {
  const base = { updatedAt: r.updated_at as number, dirty: 0 as const }
  switch (table) {
    case 'books': {
      const l = local as Book | undefined
      const coverPath = u(r.cover_path as string | null)
      return {
        ...base,
        id: r.id, title: r.title ?? '', author: r.author ?? '', fileName: r.file_name ?? '', fileSize: r.file_size ?? 0,
        fingerprint: r.fingerprint ?? '', pageCount: r.page_count ?? 0, pageSizes: r.page_sizes ?? [], tint: u(r.tint as string | null),
        addedAt: r.added_at ?? Date.now(), lastOpenedAt: u(r.last_opened_at as number | null), currentPage: r.current_page ?? 0,
        pageOffset: r.page_offset ?? 0, positionAt: u(r.position_at as number | null), furthestPage: r.furthest_page ?? 0, readPages: u(r.read_pages as string | null), readPagesSetAt: u(r.read_pages_set_at as number | null), status: r.status ?? 'queued',
        queueOrder: r.queue_order ?? 0, startedAt: u(r.started_at as number | null), finishedAt: u(r.finished_at as number | null),
        filePath: u(r.file_path as string | null), coverPath, coverUrl: u(r.cover_url as string | null),
        sourceUrl: u(r.source_url as string | null), estPages: u(r.est_pages as number | null),
        // Keep our cover bitmap unless the remote cover changed.
        cover: l?.cover && (!coverPath || coverPath === l.coverPath) ? l.cover : undefined,
        enriched: l?.enriched,
      }
    }
    case 'highlights':
      return {
        ...base, id: r.id, bookId: r.book_id, page: r.page, color: r.color, text: r.text ?? '', note: u(r.note as string | null),
        rects: r.rects ?? [], createdAt: r.created_at ?? Date.now(),
      }
    case 'bookmarks':
      return { ...base, id: r.id, bookId: r.book_id, page: r.page, createdAt: r.created_at ?? Date.now() }
    case 'sessions':
      return {
        ...base, id: r.id, bookId: r.book_id, start: r.start_ms, end: r.end_ms, seconds: r.seconds ?? 0, pages: r.pages ?? [],
      }
    case 'recaps':
      return {
        ...base, id: r.id, bookId: r.book_id, start: r.start_page ?? 0, end: r.end_page ?? 0, chapter: r.chapter ?? '',
        sections: r.sections ?? [], answers: r.answers ?? {}, state: r.state ?? 'due', createdAt: r.created_at ?? Date.now(),
        reviewedAt: u(r.reviewed_at as number | null),
        // Older cloud schemas don't store these: a section's id gives it away.
        kind: (r.kind as string | undefined) ?? kindFromId(String(r.id)), parent: u((r.parent as string | null | undefined) ?? null),
      }
  }
}

/** A recap with something written in it. */
const written = (answers: unknown) => Object.values((answers ?? {}) as Record<string, string>).some((a) => typeof a === 'string' && a.trim() !== '')

// ── Tables the cloud doesn't have yet ────────────────────────────────────
// (the app is newer than the schema.sql that was run). Everything else keeps
// syncing; Settings asks for the schema to be updated.
const missingTables = new Set<string>()
const isMissingTable = (e: unknown) => {
  const x = e as { code?: string; message?: string } | null
  return x?.code === 'PGRST205' || x?.code === '42P01' || /could not find the table|relation "?[\w.]+"? does not exist/i.test(x?.message ?? '')
}
function noteTable(table: string, missing: boolean) {
  if (missing === missingTables.has(table)) return
  if (missing) missingTables.add(table)
  else missingTables.delete(table)
  refreshWarning()
}

const cursorKey = (userId: string, t: string) => `irb-sync-${userId}-${t}`
function getCursor(userId: string, t: string) {
  try {
    return Number(localStorage.getItem(cursorKey(userId, t)) || 0)
  } catch {
    return 0
  }
}
function setCursor(userId: string, t: string, v: number) {
  try {
    localStorage.setItem(cursorKey(userId, t), String(v))
  } catch {
    /* ignore */
  }
}

async function pull(userId: string) {
  const sb = supabase!
  let touchedCovers = false
  for (const t of SYNC_TABLES) {
    for (;;) {
      const since = getCursor(userId, t)
      const { data, error } = await sb.from(REMOTE[t]).select('*').gt('server_ts', since).order('server_ts').limit(500)
      if (error && t !== 'books' && isMissingTable(error)) {
        noteTable(REMOTE[t], true)
        break
      }
      if (error) throw error
      noteTable(REMOTE[t], false)
      if (!data?.length) break
      await db.transaction('rw', db.table(t), db.files, async () => {
        markSyncTransaction()
        for (const row of data as Row[]) {
          const id = row.id as string
          const local = (await db.table(t).get(id)) as (Row & { dirty?: number; updatedAt?: number }) | undefined
          if (row.deleted) {
            if (local && !(local.dirty && (local.updatedAt ?? 0) > (row.updated_at as number))) {
              await db.table(t).delete(id)
              if (t === 'books') await db.files.delete(id)
            }
            continue
          }
          // Reading position merges on its own clock: where you last *moved* wins,
          // whatever else changed on either side.
          const remotePosAt = t === 'books' ? (row.position_at === undefined ? (row.updated_at as number) : ((row.position_at as number | null) ?? 0)) : 0
          const localPosAt = t === 'books' ? (((local as unknown as Book | undefined)?.positionAt) ?? 0) : 0
          if (local?.dirty && (local.updatedAt ?? 0) > (row.updated_at as number)) {
            if (t === 'books' && remotePosAt > localPosAt) {
              await db.table(t).update(id, { currentPage: row.current_page ?? 0, pageOffset: row.page_offset ?? 0, positionAt: remotePosAt })
            }
            continue
          }
          if (t === 'recaps' && local && written((local as unknown as Recap).answers) && !written(row.answers)) {
            // The other device only noted this chapter as finished (or skipped
            // it) — what you wrote here stands, and goes up on the next push.
            await db.table(t).update(id, { dirty: 1, updatedAt: Math.max(Date.now(), (row.updated_at as number) + 1) })
            continue
          }
          const next = fromRemote(t, row, local)
          if (t === 'books' && local && localPosAt > remotePosAt) {
            const lb0 = local as unknown as Book
            next.currentPage = lb0.currentPage
            next.pageOffset = lb0.pageOffset
            next.positionAt = lb0.positionAt
            if (lb0.currentPage !== row.current_page || lb0.pageOffset !== row.page_offset) {
              next.dirty = 1
              next.updatedAt = Date.now()
            }
          }
          const lb = local as unknown as Book | undefined
          const rb = next as unknown as Book
          if (t === 'books' && lb && (lb.readPagesSetAt ?? 0) > (rb.readPagesSetAt ?? 0)) {
            // Progress was set by hand here, more recently than there: ours stands.
            next.readPages = lb.readPages
            next.readPagesSetAt = lb.readPagesSetAt
            next.furthestPage = lb.furthestPage
            next.dirty = 1
            next.updatedAt = Date.now()
          } else if (t === 'books' && lb && (lb.readPagesSetAt ?? 0) === (rb.readPagesSetAt ?? 0)) {
            // Pages read on two devices add up — a newer row mustn't erase
            // what the other device read. (A newer *manual* set on the other
            // side skips this and replaces ours.)
            const mine = readPagesOf(local as unknown as Book)
            const theirs = readPagesOf(next as unknown as Book)
            const union = new Set([...theirs, ...mine])
            if (union.size > theirs.size) {
              next.readPages = formatPages(union)
              next.furthestPage = Math.max(...union)
              next.dirty = 1
              next.updatedAt = Date.now()
            }
          }
          await db.table(t).put(next)
          if (t === 'books' && row.cover_path) touchedCovers = true
        }
      })
      setCursor(userId, t, Math.max(...(data as Row[]).map((r) => Number(r.server_ts))))
      if (data.length < 500) break
    }
  }
  if (touchedCovers) await downloadMissingCovers()
}

async function downloadMissingCovers() {
  const sb = supabase!
  const missing = (await db.books.toArray()).filter((b) => b.coverPath && !b.cover)
  for (const b of missing) {
    const { data } = await sb.storage.from(BUCKET).download(b.coverPath!)
    if (!data) continue
    await db.transaction('rw', db.books, async () => {
      markSyncTransaction()
      await db.books.update(b.id, { cover: data })
    })
  }
}

/**
 * Columns the server doesn't have yet — the app is newer than the schema.sql
 * that was run. Rows are sent without them (so everything else still syncs)
 * and Settings asks for the schema to be updated.
 */
const missingColumns = new Map<string, Set<string>>()

function noteMissingColumn(table: string, column: string) {
  const s = missingColumns.get(table) ?? new Set<string>()
  s.add(column)
  missingColumns.set(table, s)
  refreshWarning()
}

function refreshWarning() {
  const parts: string[] = []
  if (missingColumns.size) parts.push('Your cloud database is older than this app, so a few details (like hand-edited progress) aren’t saved.')
  if (missingTables.has('irb_recaps')) parts.push('Chapter recaps aren’t syncing between your devices yet.')
  set({ warning: parts.length ? `${parts.join(' ')} Run the latest supabase/schema.sql once to finish the update.` : null })
}

/**
 * A signed-in session whose access token is good for a while yet — refreshed
 * first if it's (nearly) expired, or when `force`d. Without one, requests go
 * out anonymous and the database refuses every write ("new row violates
 * row-level security policy"). Happens after waking a tablet or laptop: the
 * token has expired and its refresh failed while the network reconnected.
 */
async function freshSession(force = false) {
  const sb = supabase!
  const { data } = await sb.auth.getSession()
  const s = data.session
  if (!s) return null
  if (!force && (s.expires_at ?? 0) * 1000 > Date.now() + 120_000) return s
  const r = await sb.auth.refreshSession()
  return r.data.session ?? null
}

/** The database refused a write for lack of a (valid) sign-in. */
const isAuthRefusal = (e: unknown) => {
  const x = e as { code?: string; message?: string } | null
  return x?.code === '42501' || /row-level security|JWT|not authenticated/i.test(x?.message ?? '')
}

class SignInError extends Error {
  constructor() {
    super('Your sign-in needs renewing — sync will keep trying. If this message stays, sign out and back in (Settings → Account).')
  }
}

async function upsertRows(table: string, rows: Row[]) {
  const sb = supabase!
  let renewed = false
  for (let attempt = 0; attempt < 8; attempt++) {
    const skip = missingColumns.get(table)
    const payload = skip?.size ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !skip.has(k)))) : rows
    const { error } = await sb.from(table).upsert(payload, { onConflict: 'id' })
    if (!error) return
    const col = /Could not find the '([^']+)' column/i.exec(error.message)?.[1] ?? /column [\w.]*?\.?(\w+) does not exist/i.exec(error.message)?.[1]
    if (col && !skip?.has(col)) {
      noteMissingColumn(table, col)
      continue
    }
    if (isAuthRefusal(error)) {
      // Renew the sign-in once and try again; still refused → say so plainly.
      if (!renewed && (await freshSession(true).catch(() => null))) {
        renewed = true
        continue
      }
      throw new SignInError()
    }
    throw error
  }
}

async function push(userId: string) {
  const sb = supabase!
  // Each table on its own: a problem with one mustn't stop the others syncing.
  let firstError: unknown = null
  for (const t of SYNC_TABLES) {
    try {
      const rows = (await db.table(t).where('dirty').equals(1).toArray()) as Row[]
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        await upsertRows(REMOTE[t], chunk.map((r) => toRemote(t, r)))
        await db.transaction('rw', db.table(t), async () => {
          markSyncTransaction()
          for (const r of chunk) {
            const cur = (await db.table(t).get(r.id as string)) as Row | undefined
            // Only clear if nothing changed while the request was in flight.
            if (cur && cur.updatedAt === r.updatedAt) await db.table(t).update(r.id as string, { dirty: 0 })
          }
        })
      }
    } catch (e) {
      if (isMissingTable(e)) {
        noteTable(REMOTE[t], true)
        continue
      }
      // Without a valid sign-in nothing else will save either: stop here.
      if (e instanceof SignInError) throw e
      console.warn(`sync: pushing ${t} failed`, e)
      firstError ??= e
    }
  }
  if (firstError) throw firstError

  const tombs = readTombstones()
  if (tombs.length) {
    for (const t of SYNC_TABLES) {
      const ids = tombs.filter((x) => x.table === t).map((x) => x.id)
      // No table yet → nothing up there to delete; keep the tombstones for later.
      if (!ids.length || missingTables.has(REMOTE[t])) continue
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200)
        const { error } = await sb.from(REMOTE[t]).update({ deleted: true, updated_at: Date.now() }).in('id', chunk)
        if (error) throw isAuthRefusal(error) ? new SignInError() : error
        if (t === 'books') {
          await sb.storage.from(BUCKET).remove(chunk.flatMap((id) => [`${userId}/${id}.pdf`, `${userId}/${id}.jpg`]))
        }
      }
    }
    const done = new Set(tombs.filter((x) => !missingTables.has(REMOTE[x.table])).map((x) => `${x.table}:${x.id}:${x.at}`))
    writeTombstones(readTombstones().filter((x) => !done.has(`${x.table}:${x.id}:${x.at}`)))
  }
}

/** Upload PDFs and covers that only exist on this device. Returns true if anything changed. */
async function uploadFiles(userId: string) {
  const sb = supabase!
  let changed = false
  const books = await db.books.toArray()
  for (const b of books) {
    // An upload refused for lack of a sign-in (not size etc.) gets another go.
    const retry = !b.uploadError || isAuthRefusal({ message: b.uploadError })
    if (b.pageCount > 0 && !b.filePath && retry) {
      const file = await db.files.get(b.id)
      if (file) {
        if (file.blob.size > MAX_UPLOAD) {
          await localOnlyUpdate(b.id, { uploadError: 'too-large' })
        } else {
          const path = `${userId}/${b.id}.pdf`
          const { error } = await sb.storage.from(BUCKET).upload(path, file.blob, { upsert: true, contentType: 'application/pdf' })
          if (error) await localOnlyUpdate(b.id, { uploadError: error.message })
          else {
            await db.books.update(b.id, { filePath: path })
            changed = true
          }
        }
      }
    }
    if (b.cover && !b.coverPath) {
      const path = `${userId}/${b.id}.jpg`
      const { error } = await sb.storage.from(BUCKET).upload(path, b.cover, { upsert: true, contentType: 'image/jpeg' })
      if (!error) {
        await db.books.update(b.id, { coverPath: path })
        changed = true
      }
    }
  }
  return changed
}

async function localOnlyUpdate(id: string, patch: Partial<Book>) {
  await db.transaction('rw', db.books, async () => {
    markSyncTransaction()
    await db.books.update(id, patch)
  })
}

async function syncSettings() {
  const sb = supabase!
  const meta = getSettingsMeta()
  const { data, error } = await sb.from('irb_profiles').select('settings, updated_at').maybeSingle()
  if (error) throw error
  if (data && data.updated_at > meta.updatedAt && !meta.dirty) {
    const remote = (data.settings ?? {}) as Partial<Settings>
    const patch: Partial<Settings> = {}
    for (const k of SYNCED_SETTINGS) if (k in remote) (patch as Record<string, unknown>)[k] = remote[k]
    updateSettings(patch, { fromSync: true })
    setSettingsMeta({ updatedAt: data.updated_at, dirty: false })
  } else if (meta.dirty || !data) {
    const s = getSettings()
    const settings = Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, s[k]]))
    const updatedAt = meta.updatedAt || Date.now()
    const { error: e2 } = await sb.from('irb_profiles').upsert({ settings, updated_at: updatedAt }, { onConflict: 'user_id' })
    if (e2) throw e2
    setSettingsMeta({ updatedAt, dirty: false })
  }
}

let running: Promise<void> | null = null
let again = false

export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await runOnce()
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

async function runOnce() {
  if (!supabase) return set({ status: 'off' })
  if (!getAuthSession()) return set({ status: 'signed-out' })
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return set({ status: 'offline' })
  set({ status: 'syncing', error: null })
  // Make sure requests carry a valid sign-in before reading or writing anything.
  const session = await freshSession().catch(() => null)
  if (!session) {
    // Signed out for good → the auth listener shows "signed out"; otherwise
    // (network still waking up) just try again shortly.
    if (getAuthSession()) {
      set({ status: navigator.onLine === false ? 'offline' : 'idle' })
      scheduleSync(15_000)
    }
    return
  }
  const userId = session.user.id
  try {
    await pull(userId)
    await push(userId)
    if (await uploadFiles(userId)) await push(userId)
    await syncSettings()
    set({ status: 'idle', lastSyncedAt: Date.now() })
  } catch (e) {
    console.warn('sync failed', e)
    const msg = (e as { message?: string })?.message ?? String(e)
    set({ status: navigator.onLine === false ? 'offline' : 'error', error: msg })
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
export function scheduleSync(delay = 3000) {
  if (!supabase || !getAuthSession()) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
}

/** Download a book's PDF from the cloud (with progress) and keep it on this device. */
export async function downloadBookFile(book: Book, onProgress?: (fraction: number) => void): Promise<Blob> {
  if (!supabase || !book.filePath) throw new Error('not-in-cloud')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(book.filePath, 600)
  if (error || !data) throw error ?? new Error('no-url')
  const res = await fetch(data.signedUrl)
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || book.fileSize || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    if (total) onProgress?.(Math.min(1, got / total))
  }
  const blob = new Blob(parts as BlobPart[], { type: 'application/pdf' })
  await db.files.put({ id: book.id, blob })
  return blob
}

/** Pull every cloud-only PDF onto this device (for reading offline). */
export async function downloadAllBooks(onProgress?: (done: number, total: number) => void) {
  const books = (await db.books.toArray()).filter((b) => b.filePath && b.pageCount > 0)
  const local = new Set((await db.files.toCollection().primaryKeys()) as string[])
  const todo = books.filter((b) => !local.has(b.id))
  let done = 0
  onProgress?.(0, todo.length)
  for (const b of todo) {
    await downloadBookFile(b).catch((e) => console.warn('download failed', b.title, e))
    onProgress?.(++done, todo.length)
  }
  return todo.length
}

/** Forget pull positions for a user (after deleting the account, a new one starts from zero). */
export function resetSyncCursors(userId: string) {
  try {
    for (const t of [...SYNC_TABLES]) localStorage.removeItem(cursorKey(userId, t))
  } catch {
    /* ignore */
  }
  set({ status: 'signed-out', lastSyncedAt: null, error: null })
}

export async function signOutAndStop() {
  await supabase?.auth.signOut()
  set({ status: 'signed-out', lastSyncedAt: null })
}

/** Wire up triggers once at startup. */
export function startSync() {
  if (!supabase) return
  setLocalChangeListener(() => scheduleSync(4000))
  setSettingsChangeListener(() => scheduleSync(2000))
  let lastUser: string | null = null
  onAuthChange(() => {
    const id = getAuthSession()?.user.id ?? null
    if (id && id !== lastUser) void syncNow()
    if (!id) set({ status: 'signed-out' })
    lastUser = id
  })
  window.addEventListener('online', () => scheduleSync(500))
  window.addEventListener('offline', () => set({ status: 'offline' }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(800)
    // Leaving the app (switching window, locking the tablet, closing): send
    // everything now rather than in a few seconds that may never come.
    else void syncNow()
  })
  window.addEventListener('pagehide', () => void syncNow())
  setInterval(() => {
    if (document.visibilityState === 'visible') scheduleSync(0)
  }, 60_000)
  if (getAuthSession()) void syncNow()
}
