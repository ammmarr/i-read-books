import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import { startOfDay } from './stats'

/**
 * Link to AIGP, the habit tracker. AIGP switches its "Read" habit on by itself once the day's
 * reading reaches its goal (it owns the goal: 1.5 hours). All this does is tell it how many
 * minutes were read: today as you read, and every past day once on connecting and about once a day
 * after that, so the whole history is there, from any device.
 *
 * The connection (address + key) is kept on this device only. It never goes through sync.
 */

const KEY = 'irb-aigp'
/** Reading flushes a session every ~10 s; tell AIGP at most this often. */
const THROTTLE_MS = 30_000

export interface AigpLink {
  url: string
  key: string
}

export interface AigpStatus {
  at: number
  ok: boolean
  message: string
}

interface Stored extends AigpLink {
  /** The last total AIGP accepted, so unchanged minutes are not sent again. */
  sent?: { day: string; minutes: number }
  /** When every past day was last sent (ms). The whole history is re-sent about once a day. */
  historyAt?: number
  status?: AigpStatus
}

const listeners = new Set<() => void>()
let cache: Stored | null | undefined

function read(): Stored | null {
  if (cache !== undefined) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    cache = null
  }
  return cache
}

function write(next: Stored | null) {
  cache = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // storage full or blocked: the link just will not survive a restart
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The current link and the result of the last report, for the Settings screen. */
export function useAigp() {
  const stored = useSyncExternalStore(subscribe, read, () => null)
  return { link: stored ? { url: stored.url, key: stored.key } : null, status: stored?.status ?? null }
}

/** "aigp1.<base64url JSON {u, k}>", as shown once in AIGP's Settings, Connect apps. */
export function parseCode(code: string): AigpLink {
  const trimmed = code.trim()
  if (!trimmed.startsWith('aigp1.')) throw new Error('That is not an AIGP connection code.')
  let parsed: { u?: unknown; k?: unknown }
  try {
    const b64 = trimmed.slice(6).replace(/-/g, '+').replace(/_/g, '/')
    parsed = JSON.parse(atob(b64))
  } catch {
    throw new Error('That connection code is damaged. Copy it again from AIGP.')
  }
  const url = typeof parsed.u === 'string' ? parsed.u.replace(/\/+$/, '') : ''
  const key = typeof parsed.k === 'string' ? parsed.k : ''
  if (!/^https?:\/\//.test(url) || !/^aigp_[0-9a-f]{8}_[A-Za-z0-9_-]{20,}$/.test(key)) {
    throw new Error('That connection code is not valid.')
  }
  return { url, key }
}

const pad = (n: number) => String(n).padStart(2, '0')
function localDay(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Seconds read today, across every session on this device (synced ones included). */
async function todaySeconds() {
  const sessions = await db.sessions.where('start').aboveOrEqual(startOfDay(Date.now())).toArray()
  return sessions.reduce((sum, s) => sum + s.seconds, 0)
}

/** Minutes read on each local day (days with at least a minute), from every session on this device, synced ones included. */
async function minutesByDay() {
  const seconds = new Map<string, number>()
  await db.sessions.each((s) => {
    const day = localDay(s.start)
    seconds.set(day, (seconds.get(day) ?? 0) + s.seconds)
  })
  return [...seconds]
    .map(([day, sec]) => ({ day, progress: Math.floor(sec / 60) }))
    .filter((d) => d.progress >= 1)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
}

const HISTORY_CHUNK = 2000
const HISTORY_EVERY_MS = 20 * 60 * 60 * 1000

let inflight = false

/**
 * Sends every past day's minutes, not just today's. AIGP marks the days that reached its goal and moves
 * the Read habit's start back to your first such day. Safe to repeat: it only ever marks days done.
 */
export async function syncHistoryToAigp(): Promise<AigpStatus | null> {
  const start = read()
  if (!start || inflight) return null
  inflight = true
  const now = Date.now()
  try {
    const days = await minutesByDay()
    let marked = 0
    for (let i = 0; i < days.length; i += HISTORY_CHUNK) {
      const res = await fetch(`${start.url}/api/connect/event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${start.key}` },
        body: JSON.stringify({ days: days.slice(i, i + HISTORY_CHUNK), unit: 'minutes' }),
      })
      const body = (await res.json().catch(() => ({}))) as { marked?: number; error?: string }
      if (!res.ok) {
        const status: AigpStatus = {
          at: now,
          ok: false,
          message: res.status === 401 ? 'AIGP refused the key. Connect again with a new code.' : (body.error ?? `AIGP answered ${res.status}.`),
        }
        const cur = read()
        if (cur) write({ ...cur, status })
        return status
      }
      marked += body.marked ?? 0
    }
    const cur = read()
    if (!cur) return null
    const today = localDay(now)
    const todayMinutes = days.find((d) => d.day === today)?.progress ?? 0
    const status: AigpStatus = {
      at: now,
      ok: true,
      message: days.length === 0 ? 'No reading to send yet.' : `Synced ${days.length} days of history; ${marked} newly marked done in AIGP.`,
    }
    write({ ...cur, historyAt: now, sent: { day: today, minutes: todayMinutes }, status })
    return status
  } catch {
    const cur = read()
    const status: AigpStatus = { at: now, ok: false, message: 'Could not reach AIGP. It will try again.' }
    if (cur) write({ ...cur, status })
    return status
  } finally {
    inflight = false
  }
}

/** Sends today's minutes if they changed (or always with `force`). Resolves to what happened. */
export async function reportToAigp(force = false): Promise<AigpStatus | null> {
  const start = read()
  if (!start || inflight) return null
  inflight = true
  const now = Date.now()
  const day = localDay(now)
  try {
    const minutes = Math.floor((await todaySeconds()) / 60)
    if (minutes < 1 && !force) return null
    if (!force && start.sent?.day === day && minutes <= start.sent.minutes) return null

    const res = await fetch(`${start.url}/api/connect/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${start.key}` },
      body: JSON.stringify({ progress: minutes, unit: 'minutes', day }),
    })
    const body = (await res.json().catch(() => ({}))) as { done?: boolean; changed?: boolean; error?: string }
    const cur = read()
    if (!cur) return null // disconnected while the request was out
    const status: AigpStatus = res.ok
      ? {
          at: now,
          ok: true,
          message: body.done ? (body.changed ? 'Read is now marked done in AIGP.' : 'Read is already done in AIGP.') : `Sent ${minutes} min read today.`,
        }
      : {
          at: now,
          ok: false,
          message: res.status === 401 ? 'AIGP refused the key. Connect again with a new code.' : (body.error ?? `AIGP answered ${res.status}.`),
        }
    write({ ...cur, ...(res.ok ? { sent: { day, minutes } } : {}), status })
    return status
  } catch {
    const cur = read()
    const status: AigpStatus = { at: now, ok: false, message: 'Could not reach AIGP. It will try again.' }
    if (cur) write({ ...cur, status })
    return status
  } finally {
    inflight = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined

/** Throttled: the first call arms a timer, calls while it is armed are absorbed. */
function schedule(delay = THROTTLE_MS) {
  if (timer || !read()) return
  timer = setTimeout(() => {
    timer = undefined
    const cur = read()
    if (cur && Date.now() - (cur.historyAt ?? 0) > HISTORY_EVERY_MS) void syncHistoryToAigp()
    else void reportToAigp()
  }, delay)
}

export function connectAigp(code: string) {
  const link = parseCode(code)
  write({ ...link })
  // First thing after connecting: send everything read so far, not just today.
  schedule(1000)
}

export function disconnectAigp() {
  write(null)
}

/** Checks the key works and says whether today's habit is already done there. */
export async function testAigp(): Promise<string> {
  const cur = read()
  if (!cur) throw new Error('Not connected.')
  let res: Response
  try {
    res = await fetch(`${cur.url}/api/connect/status`, { headers: { authorization: `Bearer ${cur.key}` } })
  } catch {
    throw new Error('Could not reach AIGP.')
  }
  if (!res.ok) throw new Error(res.status === 401 ? 'AIGP refused the key.' : `AIGP answered ${res.status}.`)
  const body = (await res.json()) as { habitLabel?: string; doneToday?: boolean }
  return `Connected. ${body.habitLabel ?? 'The habit'} is ${body.doneToday ? 'done' : 'not done yet'} today in AIGP.`
}

/** Call once at startup: reports after any reading (also sessions that sync in) and when you come back online. */
export function startAigpSync() {
  db.sessions.hook('creating', () => {
    schedule()
  })
  db.sessions.hook('updating', () => {
    schedule()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(2000)
  })
  window.addEventListener('online', () => schedule(2000))
  schedule(5000)
}
