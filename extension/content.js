// I read — Substack time: counts the time you actively read a Substack page
// and hands it to the extension (background.js), which adds it to I read.
// Also posts the Substack Notes you share from I read (see below).
//
// Runs on https pages but stops at once unless the page is Substack — on
// substack.com or a newsletter's own domain (they all load from substackcdn.com)
// — or I read itself.
;(() => {
  // Filled in by scripts/make-extension.mjs: the one site allowed to talk to the extension.
  const APP_ORIGIN = '__APP_ORIGIN__'

  // ── On I read: pass "post this Note" to the extension, and say we're here ──
  if (location.origin === APP_ORIGIN) {
    const version = chrome.runtime.getManifest().version
    const say = (o) => window.postMessage({ source: 'i-read-ext', ...o }, location.origin)
    say({ type: 'hello', version })
    addEventListener('message', (e) => {
      if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'i-read') return
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
  const substack =
    host === 'substack.com' ||
    host.endsWith('.substack.com') ||
    !!document.querySelector('link[href*="substackcdn.com"], script[src*="substackcdn.com"], img[src*="substackcdn.com"]')
  if (!substack) return
  // For annotate.js (notes and highlights), which runs next in this same page.
  globalThis.__irbSubstack = true

  // ── On substack.com: post a Note the way Substack's own page does — from
  // this page, with your signed-in session — when the extension asks.
  if (host === 'substack.com') {
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

  /** No scrolling, keys or mouse for this long → you've stopped reading (the clock pauses). */
  const IDLE_MS = 2 * 60_000
  /** Report the running visit every this many counted seconds. */
  const REPORT_EVERY = 15

  let lastActivity = Date.now()
  const mark = () => (lastActivity = Date.now())
  for (const ev of ['scroll', 'wheel', 'keydown', 'pointerdown', 'touchstart']) addEventListener(ev, mark, { passive: true, capture: true })
  // The browser also sends mouse moves while the page changes under a still mouse — those aren't you.
  addEventListener('pointermove', (e) => (e.movementX || e.movementY) && mark(), { passive: true, capture: true })

  const reading = () => document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastActivity < IDLE_MS

  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || undefined
  const here = () => location.origin + location.pathname
  const describe = () => ({
    url: here(),
    title: (meta('meta[property="og:title"]') || document.title || here()).slice(0, 300),
    publication: (meta('meta[property="og:site_name"]') || (host.endsWith('.substack.com') ? host.split('.')[0] : host === 'substack.com' ? 'Substack' : host))?.slice(0, 120),
    author: meta('meta[name="author"]')?.slice(0, 120),
  })
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()

  /** This page's reading today: one record per page per day. */
  let visit = null
  let sinceReport = 0

  const report = () => {
    if (!visit || visit.seconds < 1) return
    // Substack's own reader changes page without reloading: only describe the page we're still on.
    if (visit.url === here()) Object.assign(visit, describe())
    try {
      chrome.runtime.sendMessage({ type: 'read', visit: { ...visit } }).catch(() => {})
    } catch {
      /* the extension was reloaded: this page's script is orphaned until the page reloads */
    }
  }

  setInterval(() => {
    // Moved to another page (no reload): that's a new visit.
    if (visit && visit.url !== here()) {
      report()
      visit = null
    }
    if (!reading()) return
    const now = Date.now()
    if (!visit || !sameDay(visit.start, now)) {
      report()
      visit = { id: crypto.randomUUID(), start: now, end: now, seconds: 0, ...describe() }
    }
    visit.seconds += 1
    visit.end = now
    if (++sinceReport >= REPORT_EVERY) {
      sinceReport = 0
      report()
    }
  }, 1000)

  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && report())
  addEventListener('pagehide', report)
  addEventListener('blur', report)
})()
