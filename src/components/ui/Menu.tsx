import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onSelect?: () => void
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  /** Render a divider before this item. */
  separator?: boolean
  hint?: ReactNode
}

interface Props {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; 'aria-expanded': boolean; ref: React.Ref<HTMLButtonElement> }) => ReactNode
  items: MenuItem[]
  align?: 'start' | 'end'
  label?: ReactNode
}

export function Menu({ trigger, items, align = 'end', label }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false })
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(-1)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const w = 224
    const h = panel.current?.offsetHeight ?? 240
    const up = r.bottom + h + 12 > window.innerHeight && r.top > h + 12
    let left = align === 'end' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left, up })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (panel.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btn.current?.focus()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const at = enabled.indexOf(active)
        const next = e.key === 'ArrowDown' ? enabled[(at + 1) % enabled.length] : enabled[(at - 1 + enabled.length) % enabled.length]
        setActive(next)
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault()
        items[active].onSelect?.()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey, true)
    const onResize = () => setOpen(false)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, items, active])

  return (
    <>
      {trigger({
        onClick: (e) => {
          e.stopPropagation()
          e.preventDefault()
          setActive(-1)
          setOpen((o) => !o)
        },
        'aria-expanded': open,
        ref: btn,
      })}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panel}
              role="menu"
              initial={{ opacity: 0, scale: 0.95, y: pos.up ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 600, damping: 36 }}
              style={{ top: pos.top, left: pos.left, transformOrigin: `${align === 'end' ? 'right' : 'left'} ${pos.up ? 'bottom' : 'top'}` }}
              className="fixed z-[90] w-56 rounded-md border border-hairline bg-canvas-elevated p-1 shadow-floating"
              onClick={(e) => e.stopPropagation()}
            >
              {label && <div className="px-2.5 pb-1 pt-1.5 text-mono-eyebrow text-mute">{label}</div>}
              {items.map((it, i) => (
                <div key={i}>
                  {it.separator && <div className="-mx-1 my-1 h-px bg-hairline" />}
                  <button
                    role="menuitem"
                    disabled={it.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      it.onSelect?.()
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-body-md transition-colors disabled:opacity-40 ${
                      it.danger ? 'text-error' : 'text-ink'
                    } ${active === i ? (it.danger ? 'bg-error/10' : 'bg-hairline-soft') : ''}`}
                  >
                    {it.icon && <span className={`shrink-0 [&_svg]:size-4 ${it.danger ? '' : 'text-body'}`}>{it.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.hint && <span className="text-body-sm text-faint">{it.hint}</span>}
                    {it.checked && <Check className="size-4 text-ink" />}
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
