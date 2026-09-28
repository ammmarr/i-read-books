import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { X } from 'lucide-react'
import { useIsMobile } from '../../lib/hooks'

interface Props {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  /** Desktop placement. On phones every sheet becomes a draggable bottom sheet. */
  side?: 'right' | 'left' | 'center'
  width?: number
  children: ReactNode
  footer?: ReactNode
  /** Keep content mounted edge-to-edge (for lists that manage their own padding). */
  flush?: boolean
}

export function Sheet({ open, onClose, title, description, side = 'center', width = 440, children, footer, flush }: Props) {
  const mobile = useIsMobile()
  const drag = useDragControls()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus?.({ preventScroll: true })
    }
  }, [open, onClose])

  const place = mobile ? 'bottom' : side
  const variants = {
    bottom: { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } },
    right: { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } },
    left: { initial: { x: '-100%' }, animate: { x: 0 }, exit: { x: '-100%' } },
    center: { initial: { opacity: 0, scale: 0.96, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, y: 4 } },
  }[place]

  const frame = {
    bottom: 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-lg border-t pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))]',
    right: 'inset-y-0 right-0 h-full border-l',
    left: 'inset-y-0 left-0 h-full border-r',
    center: 'left-1/2 top-1/2 max-h-[min(720px,88dvh)] -translate-x-1/2 -translate-y-1/2 rounded-lg border',
  }[place]

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80]">
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px] dark:bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <div className={place === 'center' ? 'pointer-events-none absolute inset-0' : 'contents'}>
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              {...variants}
              transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }}
              drag={place === 'bottom' ? 'y' : false}
              dragListener={false}
              dragControls={drag}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 110 || info.velocity.y > 600) onClose()
              }}
              style={
                place === 'center'
                  ? { maxWidth: width, width: 'calc(100vw - 32px)' }
                  : place === 'bottom'
                    ? undefined
                    : { width: `min(${width}px, 100vw)` }
              }
              className={`pointer-events-auto absolute flex flex-col overflow-hidden border-hairline bg-canvas-elevated shadow-floating outline-none ${frame}`}
            >
              {place === 'bottom' && (
                <div
                  className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-3 active:cursor-grabbing"
                  onPointerDown={(e) => drag.start(e)}
                >
                  <span className="h-1 w-10 rounded-full bg-hairline" />
                </div>
              )}
              {(title || description) && (
                <div
                  className={`flex shrink-0 items-start gap-3 px-5 ${place === 'bottom' ? 'pb-3 pt-1' : 'py-4'} ${flush ? 'border-b border-hairline' : ''}`}
                  onPointerDown={place === 'bottom' ? (e) => drag.start(e) : undefined}
                >
                  <div className="min-w-0 flex-1">
                    {title && <h2 className="text-heading-md text-ink">{title}</h2>}
                    {description && <p className="mt-0.5 text-body-md text-mute">{description}</p>}
                  </div>
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="-mr-2 rounded-full p-2 text-mute transition-colors hover:bg-hairline-soft hover:text-ink"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
              <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${flush ? '' : 'px-5 pb-5'}`}>{children}</div>
              {footer && <div className="shrink-0 border-t border-hairline px-5 py-3">{footer}</div>}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
