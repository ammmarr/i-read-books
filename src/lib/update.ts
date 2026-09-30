import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import { isNative } from './native'
import { SITE_URL } from './supabase'
import { syncNow } from './sync'

/**
 * "Update" inside the app.
 *   web     the website / installed PC app: a new service worker is waiting
 *   bundle  the Android app: a new web version, downloaded from the website
 *           and switched to in place (the app itself stays installed)
 *   app     the Android app: the new version needs a new APK (native parts
 *           changed) — the button downloads it
 */
export type UpdateKind = 'web' | 'bundle' | 'app'

interface UpdateState {
  available: UpdateKind | null
  status: 'idle' | 'checking' | 'downloading' | 'applying' | 'error'
  /** 0–1 while downloading. */
  progress: number
  error: string | null
}

let state: UpdateState = { available: null, status: 'idle', progress: 0, error: null }
const listeners = new Set<() => void>()
function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useUpdate() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export const APK_URL = 'https://github.com/ammmarr/i-read-books/releases/latest/download/I-Read-Books.apk'
const CHECK_EVERY = 30 * 60_000
const RECHECK_ON_RETURN = 5 * 60_000

/** Save and send everything before the app reloads into the new version. */
async function flush() {
  await Promise.race([syncNow().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])
}

// ── Website / installed PC app (service worker) ───────────────────────────

let updateSW: ((reload?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined

async function initWeb() {
  const { registerSW } = await import('virtual:pwa-register')
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => set({ available: 'web' }),
    onRegisteredSW: (_url, reg) => {
      registration = reg
      if (!reg) return
      let last = Date.now()
      const check = () => {
        if (!navigator.onLine || reg.installing) return
        last = Date.now()
        reg.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - last > RECHECK_ON_RETURN) check()
      })
    },
  })
}

// ── Android app (live update from the website) ───────────────────────────

interface Remote {
  build: string
  builtAt: number
  native: string
  bundle: string
  checksum: string
  size: number
}
let remote: Remote | null = null
let lastCheck = 0

async function initNativeUpdates() {
  const { LiveUpdate } = await import('@capawesome/capacitor-live-update')
  // Tell the plugin this version started fine (otherwise it rolls back).
  await LiveUpdate.ready().catch(() => {})
  void checkForUpdate()
  setInterval(() => document.visibilityState === 'visible' && void checkForUpdate(), CHECK_EVERY)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > RECHECK_ON_RETURN) void checkForUpdate()
  })
}

async function checkNative(): Promise<UpdateKind | null> {
  lastCheck = Date.now()
  const res = await fetch(`${new URL('version.json', SITE_URL).href}?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`version check failed (${res.status})`)
  const r = (await res.json()) as Remote
  // Only newer builds: the website may briefly lag behind a fresh APK.
  if (!r.build || r.build === __APP_BUILD__ || !(r.builtAt > __BUILT_AT__)) return null
  remote = r
  return r.native === __NATIVE_FP__ ? 'bundle' : 'app'
}

/** Looks for a newer version now. Returns what's available (null = up to date). */
export async function checkForUpdate(): Promise<UpdateKind | null> {
  if (state.status === 'downloading' || state.status === 'applying') return state.available
  if (!isNative) {
    await registration?.update().catch(() => {})
    // A found update reports itself via onNeedRefresh; give it a moment.
    await new Promise((r) => setTimeout(r, 1200))
    return state.available
  }
  if (!navigator.onLine) return state.available
  set({ status: 'checking', error: null })
  try {
    const kind = await checkNative()
    set({ available: kind, status: 'idle' })
    return kind
  } catch (e) {
    console.warn('update check failed', e)
    set({ status: 'idle' })
    return state.available
  }
}

/** Installs the waiting update. The app reloads into the new version. */
export async function applyUpdate() {
  const kind = state.available
  if (!kind || state.status === 'downloading' || state.status === 'applying') return
  if (kind === 'web') {
    set({ status: 'applying' })
    await flush()
    await updateSW?.(true)
    return
  }
  if (kind === 'app') {
    // New native parts: download the new APK in the browser, then open it to install.
    const a = document.createElement('a')
    a.href = APK_URL
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
    return
  }
  const r = remote
  if (!r) return
  const { LiveUpdate } = await import('@capawesome/capacitor-live-update')
  set({ status: 'downloading', progress: 0, error: null })
  const sub = await LiveUpdate.addListener('downloadBundleProgress', (e) => set({ progress: e.progress }))
  try {
    const { bundleIds } = await LiveUpdate.getBundles()
    if (!bundleIds.includes(r.build)) {
      await LiveUpdate.downloadBundle({ url: new URL(r.bundle, SITE_URL).href, bundleId: r.build, checksum: r.checksum })
    }
    await LiveUpdate.setNextBundle({ bundleId: r.build })
    set({ status: 'applying', progress: 1 })
    await flush()
    // Let the new version open the database cleanly.
    db.close()
    await LiveUpdate.reload()
  } catch (e) {
    console.warn('update failed', e)
    set({ status: 'error', error: (e as Error)?.message ?? String(e) })
  } finally {
    void sub.remove()
  }
}

export function initUpdates() {
  void (isNative ? initNativeUpdates() : initWeb()).catch((e) => console.warn('updates unavailable', e))
}

/** "1.0.17" — plus the web build when the Android app has updated itself in place. */
export async function versionLabel() {
  if (!isNative) return __APP_VERSION__
  const { App } = await import('@capacitor/app')
  const info = await App.getInfo().catch(() => null)
  const app = info?.version ?? __APP_VERSION__
  return app === __APP_VERSION__ ? app : `${app} · web ${__APP_BUILD__.slice(0, 7)}`
}
