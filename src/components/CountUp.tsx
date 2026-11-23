import { useEffect, useRef } from 'react'
import { animate, useReducedMotion } from 'motion/react'

/**
 * A number that counts up to its value when it first shows (and glides to a new
 * value after that). With reduced motion it's simply the number.
 */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 0.9, delay = 0 }: {
  value: number
  format?: (n: number) => string
  duration?: number
  delay?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduce) {
      el.textContent = format(value)
      from.current = value
      return
    }
    const c = animate(from.current, value, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => {
        el.textContent = format(n)
      },
    })
    from.current = value
    // If frames are paused (a hidden tab), still land on the number.
    const settle = setTimeout(() => {
      el.textContent = format(value)
    }, (duration + delay) * 1000 + 250)
    return () => {
      c.stop()
      clearTimeout(settle)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={ref} className="tabular">
      {format(reduce ? value : 0)}
    </span>
  )
}
