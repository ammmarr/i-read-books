import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
export type PageTheme = 'auto' | 'paper' | 'sepia' | 'night'
export type ZoomMode = 'auto' | 'width' | 'page' | 'custom'

export interface Settings {
  theme: ThemePref
  dailyGoalMinutes: number
  pageTheme: PageTheme
  keepAwake: boolean
  autoHideChrome: boolean
  showSessionTimer: boolean
  /** Ask for a recap when you finish a chapter. */
  chapterRecaps: boolean
  /** …and after each section inside a chapter. */
  recapSections: boolean
  /** Books where you said "don't ask" for recaps. */
  recapsOffBooks: string[]
  /** Night Shift (warm screen) — this device only. See lib/nightShift.ts. */
  nightShift: 'off' | 'on' | 'scheduled'
  /** 0 (a hint) – 1 (deep amber). */
  nightShiftWarmth: number
  /** Schedule, "HH:MM". */
  nightShiftFrom: string
  nightShiftTo: string
  /** Switched by hand while scheduled: holds until the schedule next changes over. */
  nightShiftOverride: { on: boolean; until: number } | null
}

const DEFAULTS: Settings = {
  theme: 'system',
  dailyGoalMinutes: 20,
  pageTheme: 'auto',
  keepAwake: true,
  autoHideChrome: true,
  showSessionTimer: true,
  chapterRecaps: true,
  recapSections: true,
  recapsOffBooks: [],
  nightShift: 'off',
  nightShiftWarmth: 0.45,
  nightShiftFrom: '21:00',
  nightShiftTo: '07:00',
  nightShiftOverride: null,
}

const KEY = 'irb-settings'
const listeners = new Set<() => void>()

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    const theme = (localStorage.getItem('irb-theme') as ThemePref | null) ?? undefined
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}), ...(theme ? { theme } : {}) }
  } catch {
    return DEFAULTS
  }
}

let current = load()

export function getSettings() {
  return current
}

/** Settings that follow you across devices (theme stays per-device). */
export const SYNCED_SETTINGS: (keyof Settings)[] = ['dailyGoalMinutes', 'pageTheme', 'keepAwake', 'autoHideChrome', 'showSessionTimer', 'chapterRecaps', 'recapSections', 'recapsOffBooks']
const META_KEY = 'irb-settings-meta'

export function getSettingsMeta(): { updatedAt: number; dirty: boolean } {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '') as { updatedAt: number; dirty: boolean }
  } catch {
    return { updatedAt: 0, dirty: false }
  }
}
export function setSettingsMeta(m: { updatedAt: number; dirty: boolean }) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m))
  } catch {
    /* ignore */
  }
}

let onSyncedChange: () => void = () => {}
export function setSettingsChangeListener(fn: () => void) {
  onSyncedChange = fn
}

export function updateSettings(patch: Partial<Settings>, { fromSync = false } = {}) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
    if (patch.theme) localStorage.setItem('irb-theme', patch.theme)
  } catch {
    /* private mode — settings live for this session only */
  }
  if (!fromSync && SYNCED_SETTINGS.some((k) => k in patch)) {
    setSettingsMeta({ updatedAt: Date.now(), dirty: true })
    onSyncedChange()
  }
  listeners.forEach((l) => l())
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** Per-book viewer state that should survive reloads but not live in the DB. */
export function loadBookView(bookId: string): { mode: ZoomMode; zoom: number } | null {
  try {
    const raw = localStorage.getItem(`irb-view-${bookId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveBookView(bookId: string, v: { mode: ZoomMode; zoom: number }) {
  try {
    localStorage.setItem(`irb-view-${bookId}`, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}
