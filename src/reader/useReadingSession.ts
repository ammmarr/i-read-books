import { useEffect, useRef, useState } from 'react'
import { db, uid, type Session } from '../db/db'
import { startOfDay } from '../lib/stats'

/** No input for this long → the reader has stopped reading (the clock pauses). */
const IDLE_MS = 90_000
/** Paused for this long → the next activity starts a brand-new session. */
const SPLIT_MS = 5 * 60_000
/** A page must stay on screen this long to count as "read". */
const DWELL_S = 3
const MIN_SESSION_S = 10
const FLUSH_EVERY_S = 10

interface Options {
  bookId: string | undefined
  currentPage: number
  enabled: boolean
  onGoalReached?: () => void
  goalSeconds: number
}

/**
 * Tracks active reading time: ticks once a second while the tab is visible
 * and the reader has interacted recently, and writes the session to the DB
 * every few seconds so nothing is lost if the tab is killed.
 */
export function useReadingSession({ bookId, currentPage, enabled, onGoalReached, goalSeconds }: Options) {
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [idle, setIdle] = useState(false)
  const state = useRef({
    session: null as Session | null,
    lastActivity: Date.now(),
    pageSince: Date.now(),
    page: currentPage,
    pages: new Set<number>(),
    todayBase: 0,
    goalFired: false,
    sinceFlush: 0,
  })
  const goalCb = useRef(onGoalReached)
  goalCb.current = onGoalReached

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
      st.pageSince = Date.now()
    }
  }, [currentPage])

  useEffect(() => {
    if (!bookId || !enabled) return
    const st = state.current

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
      setIdle(false)
    }

    const tick = () => {
      const now = Date.now()
      const visible = document.visibilityState === 'visible'
      const active = visible && now - st.lastActivity < IDLE_MS
      setIdle(!active)
      if (!active) return
      if (!st.session) {
        st.session = { id: uid(), bookId, start: now, end: now, seconds: 0, pages: [] }
      }
      const s = st.session
      s.seconds += 1
      s.end = now
      if ((now - st.pageSince) / 1000 >= DWELL_S) st.pages.add(st.page)
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

    const events = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'scroll'] as const
    let lastMove = 0
    const onEvent = (e: Event) => {
      // pointermove fires constantly; sample it.
      if (e.type === 'pointermove') {
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
      events.forEach((ev) => window.removeEventListener(ev, onEvent, { capture: true }))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      void end()
    }
  }, [bookId, enabled, goalSeconds])

  return { sessionSeconds, idle }
}
