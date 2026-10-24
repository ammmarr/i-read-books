// I read — Substack time: keeps the reading the pages report (content.js),
// shows today's minutes on the icon, and sends it to your I read account
// (table irb_web_reads) — straight away when online, later when not.
import { CONFIG } from './config.js'

const KEEP_DAYS = 14
const DEFAULT_GOAL = 30

// ── Storage (chrome.storage.local) ───────────────────────────────────────
//   visits  { [id]: { id, url, title, publication, author, start, end, seconds } }  the last two weeks
//   pending { [id]: version }   changed since the cloud last had them
//   auth    { access_token, refresh_token, expires_at, email }
//   goal    minutes a day, from your I read settings
//   status  { lastSyncAt, error }
const get = (keys) => chrome.storage.local.get(keys)
const set = (o) => chrome.storage.local.set(o)

// One change at a time: messages can arrive while a sync is writing.
let chain = Promise.resolve()
const serial = (fn) => (chain = chain.then(fn, fn))

const startOfDay = (t = Date.now()) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ── The icon: today's minutes, green once the goal is reached ──────────────
async function updateBadge() {
  const { visits = {}, goal = DEFAULT_GOAL, auth } = await get(['visits', 'goal', 'auth'])
  const today = startOfDay()
  const secs = Object.values(visits).reduce((a, v) => a + (v.start >= today ? v.seconds : 0), 0)
  const mins = Math.floor(secs / 60)
  await chrome.action.setBadgeText({ text: !auth ? '!' : mins ? String(mins) : '' })
  await chrome.action.setBadgeBackgroundColor({ color: !auth ? '#d97706' : mins >= goal ? '#16a34a' : '#0070f3' })
  await chrome.action.setTitle({ title: !auth ? 'I read · sign in to count your Substack reading' : `I read · ${mins} of ${goal} min on Substack today` })
}

// ── Pages report their reading ─────────────────────────────────────────────
function noteVisit(v) {
  return serial(async () => {
    const { visits = {}, pending = {} } = await get(['visits', 'pending'])
    const prev = visits[v.id]
    visits[v.id] = { ...prev, ...v, seconds: Math.max(prev?.seconds ?? 0, v.seconds) }
    pending[v.id] = (pending[v.id] ?? 0) + 1
    // Two weeks is plenty for the popup; the cloud keeps everything.
    const cutoff = startOfDay() - KEEP_DAYS * 864e5
    for (const [id, x] of Object.entries(visits)) if (x.start < cutoff && !pending[id]) delete visits[id]
    await set({ visits, pending })
  })
}

// ── Your I read account (Supabase auth, no library needed) ───────────────
async function auth(path, body) {
  const res = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=${path}`, {
    method: 'POST',
    headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || `Sign-in failed (${res.status})`)
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at, email: data.user?.email }
}

async function signIn(email, password) {
  const a = await auth('password', { email, password })
  await set({ auth: a, status: { lastSyncAt: null, error: null } })
  await sync()
}

/** A valid access token — renewed first if it's (nearly) expired. Null when signed out. */
async function token(force = false) {
  const { auth: a } = await get('auth')
  if (!a) return null
  if (!force && a.expires_at * 1000 - Date.now() > 60_000) return a.access_token
  try {
    const fresh = await auth('refresh_token', { refresh_token: a.refresh_token })
    await set({ auth: { ...a, ...fresh, email: fresh.email ?? a.email } })
    return fresh.access_token
  } catch (e) {
    // The account no longer accepts this sign-in (password changed, signed out everywhere…).
    if (navigator.onLine) await set({ auth: null, status: { lastSyncAt: null, error: 'Signed out — sign in again to keep counting.' } })
    throw e
  }
}

async function rest(path, init = {}, retry = true) {
  const t = await token()
  if (!t) return null
  const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: CONFIG.supabaseKey, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if ((res.status === 401 || res.status === 403) && retry) {
    await token(true)
    return rest(path, init, false)
  }
  return res
}

// ── Into the cloud ────────────────────────────────────────────────────────
let syncing = null
function sync() {
  if (!syncing) syncing = doSync().finally(() => (syncing = null))
  return syncing
}

async function doSync() {
  const { auth: a } = await get('auth')
  if (!a || !navigator.onLine) return updateBadge()
  try {
    const { visits = {}, pending = {} } = await get(['visits', 'pending'])
    const sent = { ...pending }
    const rows = Object.keys(sent)
      .map((id) => visits[id])
      .filter(Boolean)
      .map((v) => ({
        id: v.id, site: 'substack', url: v.url, title: v.title ?? null, publication: v.publication ?? null, author: v.author ?? null,
        start_ms: v.start, end_ms: v.end, seconds: v.seconds, updated_at: Date.now(),
      }))
    if (rows.length) {
      const res = await rest('irb_web_reads?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) })
      if (res && !res.ok) {
        const body = await res.json().catch(() => ({}))
        const missing = body.code === 'PGRST205' || res.status === 404
        throw new Error(missing ? 'Your I read cloud needs one update before Substack time can sync (run the latest supabase/schema.sql). Nothing is lost — it’s kept here until then.' : body.message || `Couldn’t sync (${res.status})`)
      }
      // Done — unless a page reported more while this was on its way.
      await serial(async () => {
        const { pending: now = {} } = await get('pending')
        for (const [id, ver] of Object.entries(sent)) if (now[id] === ver) delete now[id]
        await set({ pending: now })
      })
    }
    // Your daily Substack goal, from I read's settings.
    const res = await rest('irb_profiles?select=settings')
    if (res?.ok) {
      const [p] = await res.json()
      const goal = Number(p?.settings?.substackGoalMinutes)
      if (goal > 0) await set({ goal })
    }
    await set({ status: { lastSyncAt: Date.now(), error: null } })
  } catch (e) {
    const { status = {} } = await get('status')
    await set({ status: { ...status, error: String(e?.message ?? e) } })
  }
  await updateBadge()
}

// ── Posting a Substack Note you shared from I read ───────────────────────
// Sent from a substack.com page with your signed-in session — an open
// substack.com tab if there is one, else a quiet background tab, closed after.
const APP_ORIGIN = new URL(CONFIG.appUrl).origin
const tabWaiters = new Map()

async function knownTabs() {
  const { substackTabs = [] } = await chrome.storage.session.get('substackTabs')
  return substackTabs
}
async function rememberTab(id) {
  const tabs = await knownTabs()
  if (!tabs.includes(id)) await chrome.storage.session.set({ substackTabs: [...tabs, id].slice(-10) })
  tabWaiters.get(id)?.()
  tabWaiters.delete(id)
}
chrome.tabs.onRemoved.addListener(async (id) => {
  const tabs = await knownTabs()
  if (tabs.includes(id)) await chrome.storage.session.set({ substackTabs: tabs.filter((t) => t !== id) })
})

/** A Note as Substack stores it: one paragraph per line (blank lines kept). */
const noteDoc = (text) => ({
  type: 'doc',
  attrs: { schemaVersion: 'v1' },
  content: text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => (line.trim() ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
})

async function postNote(text) {
  const bodyJson = noteDoc(text.trim())
  const ask = (tabId) => chrome.tabs.sendMessage(tabId, { type: 'postNote', bodyJson })
  for (const id of [...(await knownTabs())].reverse()) {
    try {
      const res = await ask(id)
      if (res) return res
    } catch {
      /* closed, or left over from before an extension reload */
    }
  }
  const tab = await chrome.tabs.create({ url: 'https://substack.com/home', active: false })
  try {
    await new Promise((resolve, reject) => {
      tabWaiters.set(tab.id, resolve)
      setTimeout(() => reject(new Error('Substack didn’t open in time — try again.')), 25_000)
    })
    return await ask(tab.id)
  } finally {
    tabWaiters.delete(tab.id)
    chrome.tabs.remove(tab.id).catch(() => {})
  }
}

const explain = (res) => {
  if (res?.ok) return res
  const s = res?.status
  return { ...res, ok: false, error: s === 401 || s === 403 ? 'Sign in to substack.com in Chrome, then try again.' : res?.error || 'Couldn’t post the Note.' }
}

// ── Wiring ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'read' && msg.visit?.id) {
    noteVisit(msg.visit).then(() => {
      updateBadge()
      clearTimeout(globalThis.__syncSoon)
      globalThis.__syncSoon = setTimeout(sync, 5000)
    })
    return false
  }
  if (msg?.type === 'signIn') {
    signIn(msg.email, msg.password).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e?.message ?? e) }))
    return true
  }
  if (msg?.type === 'signOut') {
    set({ auth: null, status: { lastSyncAt: null, error: null } }).then(updateBadge).then(() => reply({ ok: true }))
    return true
  }
  if (msg?.type === 'substackTab' && _sender.tab?.id != null) {
    rememberTab(_sender.tab.id)
    return false
  }
  if (msg?.type === 'substackNote') {
    // Only I read itself may post for you.
    if (_sender.origin !== APP_ORIGIN) {
      reply({ ok: false, error: 'Not allowed from this site.' })
      return false
    }
    postNote(String(msg.text ?? '')).then(
      (res) => reply(explain(res)),
      (e) => reply({ ok: false, error: String(e?.message ?? e) }),
    )
    return true
  }
  if (msg?.type === 'syncNow') {
    sync().then(() => reply({ ok: true }))
    return true
  }
  return false
})

chrome.alarms.create('sync', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((a) => a.name === 'sync' && sync())
chrome.runtime.onStartup.addListener(() => sync())
chrome.runtime.onInstalled.addListener(() => {
  updateBadge()
  // First install: open the popup's sign-in in a tab, so it's obvious what to do.
  chrome.storage.local.get('auth').then(({ auth: a }) => !a && chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?welcome=1') }))
})
self.addEventListener('online', () => sync())
updateBadge()
