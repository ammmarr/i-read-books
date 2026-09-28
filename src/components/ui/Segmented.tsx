import { useId, type ReactNode } from 'react'
import { motion } from 'motion/react'

interface Option<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

interface Props<T extends string> {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
  stretch?: boolean
}

/** A hairline track with a sliding elevated pill — the active option glides between choices. */
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className = '', ariaLabel, stretch }: Props<T>) {
  const id = useId()
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative inline-flex rounded-sm border border-hairline bg-hairline-soft p-0.5 ${stretch ? 'flex w-full' : ''} ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`relative z-0 inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-link/60 ${
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]'
            } ${stretch ? 'flex-1' : ''} ${active ? 'text-ink' : 'text-mute hover:text-body'}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[5px] border border-hairline bg-canvas-elevated shadow-whisper"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
