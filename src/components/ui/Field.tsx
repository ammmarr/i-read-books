import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Eye, EyeOff } from 'lucide-react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Right-aligned element on the label row (e.g. "Forgot password?"). */
  aside?: ReactNode
  error?: string | null
  hint?: ReactNode
  icon?: ReactNode
}

/** Labelled input with inline error, optional leading icon and a show/hide toggle for passwords. */
export const Field = forwardRef<HTMLInputElement, Props>(function Field({ label, aside, error, hint, icon, type = 'text', className = '', ...rest }, ref) {
  const id = useId()
  const [reveal, setReveal] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-label-sm text-ink">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint [&_svg]:size-4">{icon}</span>}
        <input
          ref={ref}
          id={id}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`h-11 w-full rounded-sm border bg-canvas-elevated text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:ring-3 ${
            error ? 'border-error focus:border-error focus:ring-error/15' : 'border-hairline focus:border-link focus:ring-link/15'
          } ${icon ? 'pl-9' : 'pl-3'} ${isPassword ? 'pr-11' : 'pr-3'}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-hairline-soft hover:text-ink"
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="err"
            id={`${id}-err`}
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="pt-1.5 text-body-sm text-error"
          >
            {error}
          </motion.p>
        ) : hint ? (
          <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-1.5 text-body-sm text-mute">
            {hint}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
})
