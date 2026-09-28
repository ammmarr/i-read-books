import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { animate, useMotionValue, useReducedMotion } from 'motion/react'

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}

export const useIsMobile = () => useMediaQuery('(max-width: 639px)')
export const useIsTouch = () => useMediaQuery('(pointer: coarse)')

/** Object URL for a blob that's revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** Animates a number from its previous value (or 0) to `value`. */
export function useCountUp(value: number, duration = 0.9) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(reduce ? value : 0)
  const [display, setDisplay] = useState(reduce ? value : 0)
  useEffect(() => {
    if (reduce) {
      setDisplay(value)
      return
    }
    const c = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setDisplay })
    return () => c.stop()
  }, [value, duration, mv, reduce])
  return display
}

export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

export function useEventListener<K extends keyof WindowEventMap>(
  type: K,
  handler: (e: WindowEventMap[K]) => void,
  target: Window | Document | HTMLElement | null = typeof window !== 'undefined' ? window : null,
  options?: AddEventListenerOptions,
) {
  const saved = useLatest(handler)
  useEffect(() => {
    if (!target) return
    const fn = (e: Event) => saved.current(e as WindowEventMap[K])
    target.addEventListener(type, fn, options)
    return () => target.removeEventListener(type, fn, options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, target, options?.passive, options?.capture])
}

export function vibrate(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* unsupported */
  }
}
