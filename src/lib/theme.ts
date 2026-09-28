import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { getSettings, updateSettings, useSettings, type ThemePref } from './settings'
import { setSystemBarsDark } from './native'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function resolveDark(pref: ThemePref) {
  return pref === 'dark' || (pref === 'system' && media().matches)
}

function apply(dark: boolean) {
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0a' : '#fafafa')
  setSystemBarsDark(dark)
}

/** Keeps <html class="dark"> in sync with the preference and the OS. */
export function useThemeSync() {
  const { theme } = useSettings()
  useEffect(() => {
    apply(resolveDark(theme))
    if (theme !== 'system') return
    const mq = media()
    const onChange = () => apply(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}

export function useIsDark() {
  const { theme } = useSettings()
  const [sys, setSys] = useState(() => media().matches)
  useEffect(() => {
    const mq = media()
    const on = () => setSys(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return theme === 'dark' || (theme === 'system' && sys)
}

/**
 * Switch theme with a circular reveal expanding from the point the user
 * tapped — falls back to an instant swap without View Transitions or when
 * reduced motion is requested.
 */
export function setTheme(next: ThemePref, origin?: { x: number; y: number }) {
  const willBeDark = resolveDark(next)
  const changes = resolveDark(getSettings().theme) !== willBeDark
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }

  if (!changes || reduced || !doc.startViewTransition) {
    updateSettings({ theme: next })
    apply(willBeDark)
    return
  }

  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? 0
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const t = doc.startViewTransition(() => {
    flushSync(() => updateSettings({ theme: next }))
    apply(willBeDark)
  })
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
}
