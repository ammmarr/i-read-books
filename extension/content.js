// I read — Substack time: counts the time you actively read a Substack page
// and hands it to the extension (background.js), which adds it to I read.
//
// Runs on https pages but stops at once unless the page is Substack — on
// substack.com or a newsletter's own domain (they all load from substackcdn.com).
;(() => {
  const host = location.hostname
  const substack =
    host === 'substack.com' ||
    host.endsWith('.substack.com') ||
    !!document.querySelector('link[href*="substackcdn.com"], script[src*="substackcdn.com"], img[src*="substackcdn.com"]')
  if (!substack) return

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
