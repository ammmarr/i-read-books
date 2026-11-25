import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { Menu, type MenuItem } from '../components/ui/Menu'

/**
 * The reading screen's controls, kept to the edges so the page has the middle:
 * the title and the clock along the top, every tool in a short column on the
 * right edge (one click each, nothing to open first), and where you are along
 * the bottom, the book in chapter sections.
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
  /** A thin line before this tool, to group the column. */
  gap?: boolean
}

const spring = { type: 'spring', stiffness: 460, damping: 38 } as const

export function ReaderIsland({ show, title, sub, onBack, bottom, clock, tools }: {
  show: boolean
  title: string
  sub?: ReactNode
  onBack: () => void
  /** Where you are: the page and the sectioned progress. */
  bottom: ReactNode
  clock?: ReactNode
  tools: ReaderTool[]
}) {
  const visible = tools.filter((t) => !t.hidden)
  const button = (t: ReaderTool, props: Record<string, unknown> = {}) => (
    <button
      {...props}
      key={t.key}
      aria-label={t.label}
      aria-pressed={t.active || undefined}
      onClick={(e) => {
        ;(props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e)
        if (!t.menu) t.onClick?.()
      }}
      className={`group/t relative grid size-9 place-items-center rounded-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-link/40 ${t.active ? 'bg-hairline-soft text-ink' : 'text-body hover:bg-hairline-soft hover:text-ink'}`}
    >
      {t.icon}
      {/* the name, beside the column on hover */}
      <span className="pointer-events-none absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-[12px] font-medium text-canvas opacity-0 transition-opacity group-hover/t:opacity-100 [@media(pointer:coarse)]:hidden">
        {t.label}
      </span>
    </button>
  )

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            key="top"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="safe-top pointer-events-none absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-canvas/90 to-transparent pb-6"
          >
            <div className="flex h-14 items-center gap-2 px-2 sm:px-3">
              <button onClick={onBack} aria-label="Back to library" title="Back to library" className="pointer-events-auto grid size-9 shrink-0 place-items-center rounded-full text-body hover:bg-hairline-soft hover:text-ink">
                <ArrowLeft className="size-[18px]" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-label-sm text-ink">{title}</div>
                {sub && <div className="truncate text-body-sm text-mute">{sub}</div>}
              </div>
              {clock && <div className="pointer-events-auto">{clock}</div>}
            </div>
          </motion.div>

          <motion.div
            key="rail"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={spring}
            className="absolute right-2 top-1/2 z-40 -translate-y-1/2 sm:right-3"
          >
            <div role="toolbar" aria-label="Reading tools" aria-orientation="vertical" className="flex max-h-[70dvh] flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-hairline bg-canvas-elevated/95 p-1 shadow-floating backdrop-blur-md [scrollbar-width:none]">
              {visible.map((t) => (
                <div key={t.key} className={t.gap ? 'mt-1 border-t border-hairline pt-1' : ''}>
                  {t.menu ? <Menu label={t.label} items={t.menu} trigger={(p) => button(t, p as unknown as Record<string, unknown>)} /> : button(t)}
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            key="bottom"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
            className="safe-bottom absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-canvas/95 via-canvas/80 to-transparent pt-6"
          >
            <div className="mx-auto flex h-12 max-w-[1100px] items-center gap-3 px-3 sm:px-5">{bottom}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
