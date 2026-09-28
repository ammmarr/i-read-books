import { motion } from 'motion/react'
import type { ReactNode } from 'react'

interface RingProps {
  value: number
  size?: number
  stroke?: number
  children?: ReactNode
  /** Colour of the filled arc; defaults to ink. */
  color?: string
  className?: string
  label?: string
}

/** Thin ring meter. The unfilled track is a lighter step of the same neutral, so state reads across the whole ring. */
export function ProgressRing({ value, size = 44, stroke = 3, children, color = 'var(--color-ink)', className = '', label }: RingProps) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      className={`relative inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-hairline)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  )
}

export function ProgressBar({ value, className = '', thin, color = 'var(--color-ink)' }: { value: number; className?: string; thin?: boolean; color?: string }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      className={`overflow-hidden rounded-full bg-hairline ${thin ? 'h-[3px]' : 'h-1.5'} ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: color, transformOrigin: 'left' }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: v }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
      />
    </div>
  )
}
