import { useCallback, useEffect, useRef, useState } from 'react'
import { db, uid, type Session } from '../db/db'
import { startOfDay } from '../lib/stats'

/** Paused for this long → the next activity starts a brand-new session. */
const SPLIT_MS = 5 * 60_000
/** Fallback when the caller doesn't know how much text a page has. */
const DEFAULT_DWELL_S = 8
const DEFAULT_PAGE_S = 90
const MIN_SESSION_S = 10
const FLUSH_EVERY_S = 10
/**
 * Nothing moving — same page, same spot, no touch, key or mouse — for three
 * times the page's reading time (within these bounds) asks "Still reading?",
 * so a book left open doesn't go on counting.
 */
const ASK_MIN_S = 3 * 60
const ASK_MAX_S = 12 * 60
/** No answer within this → away: the clock stops and the still time comes off. */
const ANSWER_S = 60
/** How long "Welcome back" (with "I was reading") stays up. */
const BACK_NOTE_MS = 12_000

interface Options {
  bookId: string | undefined
  currentPage: number
  enabled: boolean
  onGoalReached?: () => void
  goalSeconds: number
  /** Active seconds a page must stay current to count as read (skimming doesn't). */
  dwellFor?: (page: number) => number
  /** About how long the page takes to read, in seconds. */
  pageSeconds?: (page: number) => number
  /** Fired once per page per session when it has genuinely been read. */
  onPageRead?: (page: number) => void
}

export interface Away {
  /** Seconds taken off the session (still time beyond the page's reading time). */
  off: number
  /** You're back (any activity); the note stays a moment so the time can be put back. */
  back: boolean
}

/**
 * Tracks active reading time: ticks once a second while the tab is visible,
 * and writes the session to the DB every few seconds so nothing is lost if
 * the tab is killed. A book left open is caught by "Still reading?".
 */
export function useReadingSession({ bookId, currentPage, enabled, onGoalReached, goalSeconds, dwellFor, pageSeconds, onPageRead }: Options) {
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [idle, setIdle] = useState(false)
  /** Seconds left to answer "Still reading?" (null when not asking). */
  const [asking, setAsking] = useState<number | null>(null)
  const [away, setAway] = useState<Away | null>(null)
  const state = useRef({
    session: null as Session | null,
    lastActivity: Date.now(),
    /** Seconds counted since the last sign of you (input or moving through the book). */
    stillCounted: 0,
    /** Set while away: where the time came off, to put it back. */
    away: null as { sessionId?: string; off: number } | null,
    lastAway: null as { sessionId?: string; off: number } | null,
    /** Active (non-idle) seconds spent on the current page. */
    pageActive: 0,
    reported: new Set<number>(),
    page: currentPage,
    pages: new Set<number>(),
    todayBase: 0,
    goalFired: false,
    sinceFlush: 0,
  })
  const goalCb = useRef(onGoalReached)
  goalCb.current = onGoalReached
  const dwellRef = useRef(dwellFor)
  dwellRef.current = dwellFor
  const pageSecsRef = useRef(pageSeconds)
  pageSecsRef.current = pageSeconds
  const readCb = useRef(onPageRead)
  readCb.current = onPageRead
  const api = useRef({ here: () => {}, countAway: () => {} })

  // Seconds already read today (other sessions), to detect crossing the goal.
  useEffect(() => {
    const st = state.current
    db.sessions
      .where('start')
      .aboveOrEqual(startOfDay(Date.now()))
      .toArray()
      .then((xs) => {
        st.todayBase = xs.reduce((a, s) => a + s.seconds, 0)
        st.goalFired = st.todayBase >= goalSeconds
      })
  }, [goalSeconds])

  useEffect(() => {
    const st = state.current
    if (st.page !== currentPage) {
      st.page = currentPage
      st.pageActive = 0
    }
  }, [currentPage])

  useEffect(() => {
    if (!bookId || !enabled) return
    const st = state.current
    let backTimer: ReturnType<typeof setTimeout> | undefined
    const pageSecs = () => pageSecsRef.current?.(st.page) ?? DEFAULT_PAGE_S

    const flush = async () => {
      const s = st.session
      if (!s) return
      s.pages = [...st.pages]
      if (s.seconds >= MIN_SESSION_S) await db.sessions.put({ ...s })
    }

    const end = async () => {
      const s = st.session
      if (!s) return
      await flush()
      if (s.seconds < MIN_SESSION_S) await db.sessions.delete(s.id)
      else st.todayBase += s.seconds
      st.session = null
      st.pages = new Set()
      setSessionSeconds(0)
    }

    const activity = () => {
      const now = Date.now()
      if (st.session && now - st.lastActivity > SPLIT_MS) void end()
      st.lastActivity = now
      st.stillCounted = 0
      setIdle(false)
      setAsking(null)
      if (st.away) {
        const a = st.away
        st.away = null
        st.lastAway = a
        setAway({ off: a.off, back: true })
        clearTimeout(backTimer)
        backTimer = setTimeout(() => {
          st.lastAway = null
          setAway(null)
        }, BACK_NOTE_MS)
      }
    }

    // No answer: the still time beyond what the page takes to read comes off.
    const goAway = () => {
      const s = st.session
      const credit = Math.min(st.stillCounted, Math.round(pageSecs()))
      const off = st.stillCounted - credit
      if (s && off > 0) {
        s.seconds = Math.max(0, s.seconds - off)
        s.end = st.lastActivity + credit * 1000
        s.pages = [...st.pages]
        void (s.seconds >= MIN_SESSION_S ? db.sessions.put({ ...s }) : db.sessions.delete(s.id))
        setSessionSeconds(s.seconds)
      }
      st.away = { sessionId: s?.id, off: Math.max(0, off) }
      st.stillCounted = 0
      setAsking(null)
      setIdle(true)
      setAway({ off: Math.max(0, off), back: false })
    }

    const tick = () => {
      const now = Date.now()
      if (st.away || document.visibilityState !== 'visible') return setIdle(true)
      const still = (now - st.lastActivity) / 1000
      const askAfter = Math.max(ASK_MIN_S, Math.min(ASK_MAX_S, 3 * pageSecs()))
      if (still >= askAfter + ANSWER_S) return goAway()
      setAsking(still >= askAfter ? Math.ceil(askAfter + ANSWER_S - still) : null)
      setIdle(false)
      if (!st.session) {
        st.session = { id: uid(), bookId, start: now, end: now, seconds: 0, pages: [] }
      }
      const s = st.session
      s.seconds += 1
      s.end = now
      st.stillCounted += 1
      st.pageActive += 1
      if (st.pageActive >= (dwellRef.current?.(st.page) ?? DEFAULT_DWELL_S)) {
        st.pages.add(st.page)
        if (!st.reported.has(st.page)) {
          st.reported.add(st.page)
          readCb.current?.(st.page)
        }
      }
      setSessionSeconds(s.seconds)

      if (!st.goalFired && goalSeconds > 0 && st.todayBase + s.seconds >= goalSeconds) {
        st.goalFired = true
        goalCb.current?.()
      }
      if (++st.sinceFlush >= FLUSH_EVERY_S) {
        st.sinceFlush = 0
        void flush()
      }
    }

    api.current = {
      here: activity,
      // "I was reading": put the time back.
      countAway: () => {
        const a = st.lastAway ?? st.away
        if (st.away) activity()
        st.lastAway = null
        clearTimeout(backTimer)
        setAway(null)
        if (!a?.off) return
        const s = st.session
        if (s && s.id === a.sessionId) {
          s.seconds += a.off
          setSessionSeconds(s.seconds)
          void flush()
        } else if (a.sessionId) {
          const id = a.sessionId
          void db.sessions.get(id).then((x) => x && db.sessions.put({ ...x, seconds: x.seconds + a.off }))
        }
      },
    }

    const events = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'scroll'] as const
    let lastMove = 0
    const onEvent = (e: Event) => {
      if (e.type === 'pointermove') {
        // The browser sends mouse moves while the page changes under a still
        // mouse (scrolling, the timer ticking) — those aren't you.
        const m = e as PointerEvent
        if (!m.movementX && !m.movementY) return
        // pointermove fires constantly; sample it.
        const t = performance.now()
        if (t - lastMove < 1000) return
        lastMove = t
      }
      activity()
    }
    events.forEach((ev) => window.addEventListener(ev, onEvent, { passive: true, capture: true }))
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
      else activity()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)

    activity()
    const iv = setInterval(tick, 1000)
    return () => {
      clearInterval(iv)
      clearTimeout(backTimer)
      events.forEach((ev) => window.removeEventListener(ev, onEvent, { capture: true }))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      void end()
    }
  }, [bookId, enabled, goalSeconds])

  /** "I'm here" (to "Still reading?"). */
  const stillHere = useCallback(() => api.current.here(), [])
  /** "I was reading": count the time that came off after all. */
  const countAway = useCallback(() => api.current.countAway(), [])
  const dismissAway = useCallback(() => setAway(null), [])

  return { sessionSeconds, idle, asking, away, stillHere, countAway, dismissAway }
}
