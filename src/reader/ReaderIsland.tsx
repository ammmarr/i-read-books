import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Ellipsis } from 'lucide-react'
import { Menu, type MenuItem } from '../components/ui/Menu'

/**
 * The reading screen's one control: a floating island at the bottom (back,
 * where you are, the clock, and ••• for the tools), plus a quiet title in the
 * top corner. The page keeps the rest of the screen.
 */

export interface ReaderTool {
  key: string
  label: string
  icon: ReactNode
  onClick?: () => void
  active?: boolean
  /** A tool that offers a choice (e.g. recap this section or this chapter). */
  menu?: MenuItem[]
  hidden?: boolean
  /** Leave the tray open after (zoom steps). */
  keepOpen?: boolean
}

const spring = { type: 'spring', stiffness: 460, damping: 38 } as const

export function ReaderIsland({ show, title, sub, onBack, center, clock, tools, tray, setTray }: {
  show: boolean
  title: string
  sub?: ReactNode
  onBack: () => void
  /** Previous / scrubber / page / next. */
  center: ReactNode
  clock?: ReactNode
  tools: ReaderTool[]
  tray: boolean
  setTray: (v: boolean) => void
}) {
  // Esc puts the tools away first.
  useEffect(() => {
    if (!tray) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setTray(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tray, setTray])

  const visible = tools.filter((t) => !t.hidden)
  const toolButton = (t: ReaderTool, props: Record<string, unknown> = {}) => (
    <button
      {...props}
      key={t.key}
      onClick={(e) => {
        ;(props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e)
        if (t.menu) return
        t.onClick?.()
        if (!t.keepOpen) setTray(false)
      }}
      className={`flex w-[86px] flex-col items-center gap-1.5 rounded-md px-1 py-2.5 text-[11.5px] transition-colors ${t.active ? 'bg-hairline-soft text-ink' : 'text-body hover:bg-hairline-soft hover:text-ink'}`}
    >
      <span className="grid size-5 place-items-center">{t.icon}</span>
      <span className="max-w-full truncate">{t.label}</span>
    </button>
  )

  return (
    <>
      <AnimatePresence>
        {show && (
          <motion.div
            key="corner"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="safe-top pointer-events-none absolute left-0 top-0 z-30 max-w-[70%] rounded-br-md bg-canvas/75 px-4 pb-2 pt-3 backdrop-blur-sm"
          >
            <div className="truncate text-label-sm text-ink/80">{title}</div>
            {sub && <div className="truncate text-body-sm text-mute">{sub}</div>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {show && tray && (
          <motion.div
            key="tray"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={spring}
            className="safe-bottom absolute inset-x-0 bottom-[84px] z-40 flex justify-center px-3"
          >
            <div className="flex max-w-[640px] flex-wrap justify-center gap-0.5 rounded-lg border border-hairline bg-canvas-elevated p-1.5 shadow-floating">
              {visible.map((t) =>
                t.menu ? (
                  <Menu key={t.key} label={t.label} items={t.menu.map((m) => ({ ...m, onSelect: () => (m.onSelect?.(), setTray(false)) }))} trigger={(p) => toolButton(t, p as unknown as Record<string, unknown>)} />
                ) : (
                  toolButton(t)
                ),
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {show && (
          <motion.div
            key="island"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={spring}
            className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-4"
          >
            <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full border border-hairline bg-canvas-elevated p-1.5 shadow-floating">
              <button onClick={onBack} aria-label="Back to library" title="Back to library" className="grid size-9 shrink-0 place-items-center rounded-full text-body hover:bg-hairline-soft hover:text-ink">
                <ArrowLeft className="size-[18px]" />
              </button>
              <div className="flex min-w-0 items-center gap-1 sm:gap-2">{center}</div>
              {clock}
              <button
                onClick={() => setTray(!tray)}
                aria-label="Tools"
                aria-expanded={tray}
                title="Tools"
                className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors ${tray ? 'bg-hairline-soft text-ink' : 'text-body hover:bg-hairline-soft hover:text-ink'}`}
              >
                <Ellipsis className="size-[18px]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
