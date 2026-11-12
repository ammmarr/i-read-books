// I read — reading time: counts the time you actively read a page on a site I read knows (sites.js: Substack,
// X articles…) and hands it to the extension (background.js), which adds it to I read. Nothing here is specific
// to one site: sites.js says which pages count, where their text is and what to call them.
// Also posts the Substack Notes you share from I read (see below).
//
// Runs on https pages but stops at once unless sites.js knows the site — or the page is I read itself.
// Whether THIS page counts is asked again on every tick (site.counting), not once when the page loads, because
// some sites (X) change the address without reloading.
;(() => {
  // Filled in by scripts/make-extension.mjs: the one site allowed to talk to the extension.
  const APP_ORIGIN = '__APP_ORIGIN__'

  // After an update, a page already open keeps this old copy, cut off from the extension (it can't
  // save anything); background.js puts the new one in beside it, and this one stands down.
  const me = {}
  globalThis.__irbContent = me
  const alive = () => {
    try {
      return !!chrome.runtime?.id && globalThis.__irbContent === me
    } catch {
      return false
    }
  }

  // ── On I read: pass "post this Note" to the extension, and say we're here ──
  if (location.origin === APP_ORIGIN) {
    const version = chrome.runtime.getManifest().version
    const say = (o) => window.postMessage({ source: 'i-read-ext', ...o }, location.origin)
    say({ type: 'hello', version })
    addEventListener('message', (e) => {
      if (!alive() || e.source !== window || e.origin !== location.origin || e.data?.source !== 'i-read') return
      if (e.data.type === 'ping') say({ type: 'hello', version })
      if (e.data.type === 'substackNote') {
        const id = e.data.id
        chrome.runtime
          .sendMessage({ type: 'substackNote', text: String(e.data.text ?? '').slice(0, 8000) })
          .then((res) => say({ type: 'substackNoteResult', ...(res ?? { ok: false, error: 'No answer from the extension.' }), requestId: id }))
          .catch((err) => say({ type: 'substackNoteResult', ok: false, error: String(err?.message ?? err), requestId: id }))
      }
    })
    return
  }

  const host = location.hostname
  const site = globalThis.__irbSites?.current()
  if (!site) return
  // For annotate.js (the pill, "Still reading?", notes and highlights), which runs next in this same page.
  globalThis.__irbSite = site
  globalThis.__irbReading = undefined // set below; a stale one from an older copy must not outlive this one
  const counting = () => site.counting()

  // ── On substack.com: post a Note the way Substack's own page does — from
  // this page, with your signed-in session — when the extension asks.
  if (site.id === 'substack' && host === 'substack.com') {
    try {
      chrome.runtime.sendMessage({ type: 'substackTab' }).catch(() => {})
    } catch {
      /* orphaned after an extension reload */
    }
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg?.type !== 'postNote') return false
      fetch('/api/v1/comment/feed', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyJson: msg.bodyJson, tabId: 'for-you', replyMinimumRole: 'everyone' }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => null)
          const err = j?.error || j?.errors?.[0]?.msg || j?.message
          reply({ ok: r.ok, status: r.status, id: j?.id, error: r.ok ? undefined : typeof err === 'string' ? err : `Substack answered ${r.status}` })
        })
        .catch((e) => reply({ ok: false, error: String(e?.message ?? e) }))
      return true
    })
  }

  // ── Counting, the way the app does ─────────────────────────────────────────
  // The clock runs while the page is in front of you. Sitting still is reading for as long as the text
  // on screen takes to read; still time past that is held back (not sent) until you show you're there.
  // Still for three times that (3 to 12 min) asks "Still reading?" (annotate.js shows it); no answer
  // within a minute and the reading pauses: the held time comes off, and "I was reading" puts it back.
  const ASK_MIN_S = 3 * 60
  const ASK_MAX_S = 12 * 60
  const ANSWER_S = 60
  /** How long "Welcome back" (with "I was reading") stays up. */
  const BACK_NOTE_MS = 12_000
  /** Reading speed for the text on screen, as in the app (characters a minute). */
  const CHARS_PER_MIN = 1500
  /** When there's no post text on screen (comments, the home feed). */
  const DEFAULT_SCREEN_S = 90
  /** Report the running visit every this many counted seconds. */
  const REPORT_EVERY = 15

  const bodyEl = () => site.body()
  let screen = { at: 0, secs: DEFAULT_SCREEN_S }
  /** About how long the post text on screen takes to read, in seconds. */
  function screenSecs() {
    const now = Date.now()
    if (now - screen.at < 5000) return screen.secs
    let secs = DEFAULT_SCREEN_S
    const b = bodyEl()
    const r = b?.getBoundingClientRect()
    const seen = r ? Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) : 0
    if (b && r.height > 0 && seen > 0) {
      const chars = (b.textContent ?? '').replace(/\s+/g, ' ').length * (seen / r.height)
      secs = Math.max(20, Math.round((chars / CHARS_PER_MIN) * 60))
    }
    screen = { at: now, secs }
    return secs
  }

  let lastActivity = Date.now()
  /** Seconds counted since the last sign of you. */
  let still = 0
  /** Seconds left to answer "Still reading?" (null when not asking). */
  let asking = null
  /** Paused: { off: seconds taken off, back: you're back, visit: where they came off }. */
  let away = null
  let backT

  const listeners = new Set()
  const emit = () => listeners.forEach((l) => l())
  /** Still time past what the screen takes to read: not counted until you show you're there. */
  const held = () => Math.max(0, still - Math.round(screenSecs()))

  function activity() {
    lastActivity = Date.now()
    still = 0
    if (asking != null) {
      asking = null
      emit()
    }
    if (away && !away.back) {
      away.back = true
      clearTimeout(backT)
      backT = setTimeout(() => {
        away = null
        emit()
      }, BACK_NOTE_MS)
      emit()
    }
  }
  for (const ev of ['scroll', 'wheel', 'keydown', 'pointerdown', 'touchstart', 'focus']) addEventListener(ev, activity, { passive: true, capture: true })
  // The browser also sends mouse moves while the page changes under a still mouse — those aren't you.
  addEventListener('pointermove', (e) => (e.movementX || e.movementY) && activity(), { passive: true, capture: true })

  // No answer: the still time beyond what the screen takes to read comes off.
  function goAway() {
    const off = Math.max(0, still - Math.min(still, Math.round(screenSecs())))
    if (visit && off > 0) {
      visit.seconds = Math.max(0, visit.seconds - off)
      visit.end -= off * 1000
    }
    still = 0
    asking = null
    away = { off, back: false, visit }
    report()
    emit()
  }

  /** "I was reading": count the time that came off after all. */
  function countAway() {
    const a = away
    if (!a) return
    if (!a.back) activity()
    clearTimeout(backT)
    away = null
    if (a.off > 0 && a.visit) {
      a.visit.seconds += a.off
      report(a.visit)
    }
    emit()
  }

  // For annotate.js, which shows "Still reading?" and "Reading time paused" on the page.
  globalThis.__irbReading = {
    state: () => ({ asking, away: away && { off: away.off, back: away.back } }),
    subscribe: (l) => listeners.add(l),
    stillHere: activity,
    countAway,
    dismiss: () => {
      clearTimeout(backT)
      away = null
      emit()
    },
  }

  const here = () => location.origin + location.pathname
  /** What to call this page (site, url, title, publication, author): sites.js knows how for each site. */
  const describe = () => site.describe()
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()

  /** This page's reading today: one record per page per day. */
  let visit = null
  let sinceReport = 0
  const sent = new Map() // visit id → seconds last sent

  /** Sends a visit's counted time — without the held still time, so a post left open never gets there. */
  function report(v = visit) {
    if (!v) return
    const off = v === visit ? held() : 0
    const seconds = v.seconds - off
    if (seconds < 1 || sent.get(v.id) === seconds) return
    // Some sites (Substack's own reader, X) change page without reloading: only describe the page we're still on.
    if (v.url === here()) Object.assign(v, describe())
    try {
      chrome.runtime.sendMessage({ type: 'read', visit: { ...v, seconds, end: v.end - off * 1000 } }).catch(() => {})
      sent.set(v.id, seconds)
    } catch {
      /* the extension was reloaded: this page's script is orphaned until the page reloads */
    }
  }

  const clock = setInterval(() => {
    if (!alive()) {
      clearInterval(clock)
      return report() // replaced by a newer copy: hand over what's counted (cut off, this just fails quietly)
    }
    // Moved to another page (no reload): that's a new visit.
    if (visit && visit.url !== here()) {
      report()
      visit = null
    }
    if (!counting()) {
      // On X: the feed, a profile, a normal post... is not reading time. Nothing runs, and nothing is left asking or paused.
      if (visit) {
        report()
        visit = null
      }
      still = 0
      sinceReport = 0
      if (asking != null || away) {
        asking = null
        away = null
        emit()
      }
      return
    }
    if (away && !away.back) return // paused until you're back
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    const now = Date.now()
    const stillFor = (now - lastActivity) / 1000
    const askAfter = Math.max(ASK_MIN_S, Math.min(ASK_MAX_S, 3 * screenSecs()))
    if (stillFor >= askAfter + ANSWER_S) return goAway()
    const left = stillFor >= askAfter ? Math.ceil(askAfter + ANSWER_S - stillFor) : null
    if (left !== asking) {
      asking = left
      emit()
    }
    if (!visit || !sameDay(visit.start, now)) {
      report()
      visit = { id: crypto.randomUUID(), start: now, end: now, seconds: 0, ...describe() }
    }
    visit.seconds += 1
    visit.end = now
    still += 1
    if (++sinceReport >= REPORT_EVERY) {
      sinceReport = 0
      report()
    }
  }, 1000)

  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? report() : activity()))
  addEventListener('pagehide', () => report())
  addEventListener('blur', () => report())
})()
