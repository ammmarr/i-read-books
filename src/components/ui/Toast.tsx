import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck, CircleAlert, Info, X } from 'lucide-react'

type Tone = 'success' | 'error' | 'info'

interface ToastInput {
  message: ReactNode
  description?: ReactNode
  tone?: Tone
  action?: { label: string; onClick: () => void }
  duration?: number
  /** Replaces an existing toast with the same id instead of stacking. */
  id?: string
}

interface ToastItem extends ToastInput {
  id: string
}

interface Ctx {
  toast: (t: ToastInput) => string
  dismiss: (id: string) => void
}

const ToastCtx = createContext<Ctx | null>(null)

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}

const icons = {
  success: <CircleCheck className="size-4 text-success" />,
  error: <CircleAlert className="size-4 text-error" />,
  info: <Info className="size-4 text-link" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback(
    (t: ToastInput) => {
      const id = t.id ?? Math.random().toString(36).slice(2)
      setItems((xs) => {
        const without = xs.filter((x) => x.id !== id)
        return [...without, { ...t, id }].slice(-4)
      })
      clearTimeout(timers.current.get(id))
      const duration = t.duration ?? (t.action ? 6000 : 3500)
      if (duration !== Infinity) timers.current.set(id, setTimeout(() => dismiss(id), duration))
      return id
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+88px)] md:pb-6"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              layout
              key={t.id}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragEnd={(_, info) => Math.abs(info.offset.x) > 80 && dismiss(t.id)}
              className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-md border border-hairline bg-canvas-elevated px-4 py-3 shadow-floating"
            >
              <span className="mt-0.5 shrink-0">{icons[t.tone ?? 'success']}</span>
              <div className="min-w-0 flex-1">
                <div className="text-label-sm text-ink">{t.message}</div>
                {t.description && <div className="mt-0.5 text-body-sm text-mute">{t.description}</div>}
              </div>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick()
                    dismiss(t.id)
                  }}
                  className="shrink-0 rounded-sm px-2 py-0.5 text-label-sm text-link hover:bg-link-soft"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-mr-1 shrink-0 rounded-full p-1 text-faint hover:bg-hairline-soft hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
