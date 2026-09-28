import { forwardRef, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'

type Variant = 'default' | 'outline' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium select-none ' +
  'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-[var(--ease-out-quart)] ' +
  'disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-link/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

const variants: Record<Variant, string> = {
  default: 'bg-ink text-canvas hover:bg-ink/85',
  outline: 'border border-hairline bg-canvas-elevated text-ink hover:bg-hairline-soft hover:border-faint/40',
  ghost: 'text-body hover:bg-hairline-soft hover:text-ink',
  danger: 'bg-error text-white hover:bg-error-deep',
  link: 'text-link hover:text-link-deep underline-offset-4 hover:underline px-0',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
  icon: 'size-10 rounded-full',
  'icon-sm': 'size-8 rounded-full',
}

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant
  size?: Size
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    />
  )
})

interface IconButtonProps extends ButtonProps {
  label: string
  /** Show the tooltip below instead of above. */
  tipBelow?: boolean
  active?: boolean
}

/** Round ghost icon button with an accessible label and a hover tooltip (pointer devices only). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tipBelow, active, variant = 'ghost', size = 'icon', className = '', children, ...rest },
  ref,
) {
  return (
    <span className="group/tip relative inline-flex">
      <Button
        ref={ref}
        aria-label={label}
        variant={variant}
        size={size}
        className={`${active ? 'bg-hairline-soft text-ink' : ''} ${className}`}
        {...rest}
      >
        {children}
      </Button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap [@media(hover:none)]:hidden rounded-sm bg-ink px-2 py-1 text-[12px] font-medium text-canvas opacity-0 transition-all delay-0 duration-150 [@media(hover:hover)]:group-hover/tip:opacity-100 [@media(hover:hover)]:group-hover/tip:delay-500 ${
          tipBelow
            ? 'top-full mt-2 -translate-y-1 [@media(hover:hover)]:group-hover/tip:translate-y-0'
            : 'bottom-full mb-2 translate-y-1 [@media(hover:hover)]:group-hover/tip:translate-y-0'
        }`}
      >
        {label}
      </span>
    </span>
  )
})
