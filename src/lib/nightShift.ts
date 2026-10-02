import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSettings, updateSettings, useSettings, type Settings } from './settings'

/**
 * Night Shift: a warm, low-blue tint over the whole app (pages included) —
 * easier on the eyes in the evening, like the iPhone's. Per device.
 *   off        never
 *   on         always
 *   scheduled  between two times, e.g. 21:00 → 07:00 (wraps past midnight)
 * Switching it on or off by hand while scheduled lasts until the schedule next
 * changes over, then the schedule takes back over.
 */
export type NightShiftMode = 'off' | 'on' | 'scheduled'

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (((h || 0) * 60 + (m || 0)) % 1440 + 1440) % 1440
}

/** Inside the schedule at this moment? */
export function inSchedule(from: string, to: string, d = new Date()) {
  const now = d.getHours() * 60 + d.getMinutes()
  const a = minutes(from)
  const b = minutes(to)
  if (a === b) return false
  return a < b ? now >= a && now < b : now >= a || now < b
}

/** When the schedule next switches on or off (ms). */
export function nextChange(from: string, to: string, d = new Date()) {
  return Math.min(
    ...[minutes(from), minutes(to)].map((m) => {
      const t = new Date(d)
      t.setHours(Math.floor(m / 60), m % 60, 0, 0)
      if (t.getTime() <= d.getTime()) t.setDate(t.getDate() + 1)
      return t.getTime()
    }),
  )
}

export function nightShiftActive(s: Settings, now = new Date()) {
  const o = s.nightShiftOverride
  if (o && o.until > now.getTime()) return o.on
  if (s.nightShift === 'on') return true
  if (s.nightShift === 'scheduled') return inSchedule(s.nightShiftFrom, s.nightShiftTo, now)
  return false
}

/** Turn it on or off right now — while scheduled, until the schedule next changes over. */
export function setNightShiftNow(on: boolean) {
  const s = getSettings()
  if (s.nightShift === 'scheduled') updateSettings({ nightShiftOverride: { on, until: nextChange(s.nightShiftFrom, s.nightShiftTo) } })
  else updateSettings({ nightShift: on ? 'on' : 'off', nightShiftOverride: null })
}

export const setNightShiftMode = (mode: NightShiftMode) => updateSettings({ nightShift: mode, nightShiftOverride: null })

// While you drag the warmth slider, the tint shows even if Night Shift is off.
let previewing = false
const previewListeners = new Set<() => void>()
export function setNightShiftPreview(on: boolean) {
  if (previewing === on) return
  previewing = on
  previewListeners.forEach((l) => l())
}
export const useNightShiftPreview = () =>
  useSyncExternalStore(
    (cb) => {
      previewListeners.add(cb)
      return () => previewListeners.delete(cb)
    },
    () => previewing,
  )

/** Whether Night Shift is on right now — re-checked every half minute so schedules start and end on time. */
export function useNightShift() {
  const s = useSettings()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const t = setInterval(tick, 30_000)
    const onShow = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [])
  return {
    active: nightShiftActive(s, new Date(now)),
    mode: s.nightShift,
    warmth: s.nightShiftWarmth,
    from: s.nightShiftFrom,
    to: s.nightShiftTo,
    /** Switched by hand while scheduled: until when (ms), else null. */
    overrideUntil: s.nightShiftOverride && s.nightShiftOverride.until > now ? s.nightShiftOverride.until : null,
  }
}

/** Opacity of the warm layer for a warmth of 0–1 (blended with "multiply"). */
export const warmLayerOpacity = (warmth: number) => 0.12 + 0.5 * Math.max(0, Math.min(1, warmth))
/** Candle-light amber: keeps reds, cuts most blue. */
export const WARM_LAYER = 'rgb(255, 147, 41)'
