import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export interface BarDatum {
  key: string
  label: string
  title: string
  value: number
  detail?: string
  isCurrent?: boolean
}

interface Props {
  data: BarDatum[]
  format: (v: number) => string
  /** Axis tick formatter (shorter). */
  tick?: (v: number) => string
  height?: number
  goal?: { value: number; label: string }
  ariaLabel: string
  /** Show every Nth x label (auto if omitted). */
  labelEvery?: number
}

function niceMax(v: number) {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

const M = { top: 12, right: 8, bottom: 26, left: 40 }

/**
 * Single-series column chart. Thin columns (≤24px) with a 4px rounded data
 * end and a square baseline; hairline solid gridlines; hover tooltip per column.
 */
export function BarChart({ data, format, tick = format, height = 220, goal, ariaLabel, labelEvery }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    // Measure now so the first paint already has the chart (RO fires a frame later).
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const innerW = Math.max(0, w - M.left - M.right)
  const innerH = height - M.top - M.bottom
  const n = data.length
  const band = n ? innerW / n : 0
  const barW = Math.max(2, Math.min(24, band >= 8 ? band * 0.62 : band - 2))
  const max = niceMax(Math.max(...data.map((d) => d.value), goal?.value ?? 0, 1) * 1.05)
  const ticks = [0, max / 2, max]
  const y = (v: number) => innerH - (v / max) * innerH
  const every = labelEvery ?? Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 44))))

  const barPath = (x: number, h: number) => {
    const r = Math.min(4, barW / 2, h)
    const b = innerH
    const t = innerH - h
    return `M${x},${b} L${x},${t + r} Q${x},${t} ${x + r},${t} L${x + barW - r},${t} Q${x + barW},${t} ${x + barW},${t + r} L${x + barW},${b} Z`
  }

  const hd = hover != null ? data[hover] : null
  const hx = hover != null ? M.left + hover * band + band / 2 : 0

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} className="overflow-visible">
          <g transform={`translate(${M.left},${M.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x1={0} x2={innerW} stroke="var(--color-hairline)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={-10} dy="0.32em" textAnchor="end" className="fill-mute text-[11px] tabular">
                  {tick(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const h = (d.value / max) * innerH
              const x = i * band + (band - barW) / 2
              const dim = hover != null && hover !== i
              return (
                <g key={d.key}>
                  {d.value > 0 ? (
                    <motion.path
                      d={barPath(x, Math.max(h, 2))}
                      fill="var(--color-link)"
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1, opacity: dim ? 0.35 : 1 }}
                      transition={{ scaleY: { delay: Math.min(i, 40) * 0.012, type: 'spring', stiffness: 260, damping: 26 }, opacity: { duration: 0.15 } }}
                      style={{ transformOrigin: `0px ${innerH}px`, transformBox: 'view-box' }}
                    />
                  ) : (
                    <rect x={x} y={innerH - 2} width={barW} height={2} rx={1} fill="var(--color-hairline)" />
                  )}
                  {/* anchored from the right so the latest period is always labelled */}
                  {(n - 1 - i) % every === 0 && (
                    <text
                      x={i * band + band / 2}
                      y={innerH + 18}
                      textAnchor="middle"
                      className={`text-[11px] ${d.isCurrent ? 'fill-ink font-medium' : 'fill-mute'}`}
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              )
            })}
            {goal && goal.value > 0 && goal.value <= max && (
              <g transform={`translate(0,${y(goal.value)})`}>
                <line x1={0} x2={innerW} stroke="var(--color-mute)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={innerW} y={-5} textAnchor="end" className="fill-mute text-[11px]">
                  {goal.label}
                </text>
              </g>
            )}
            {/* hit targets: the full column, bigger than the mark */}
            {data.map((d, i) => (
              <rect
                key={`hit-${d.key}`}
                x={i * band}
                y={0}
                width={band}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
                onClick={() => setHover(i)}
              />
            ))}
          </g>
        </svg>
      )}
      <AnimatePresence>
        {hd && (
          <motion.div
            key="tip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, left: Math.max(70, Math.min(hx, w - 70)) }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 700, damping: 40 }}
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-hairline bg-canvas-elevated px-3 py-2 shadow-floating"
          >
            <div className="text-body-sm text-mute">{hd.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-label-sm text-ink">
              <span className="size-2 rounded-full bg-link" />
              {format(hd.value)}
            </div>
            {hd.detail && <div className="mt-0.5 text-body-sm text-body">{hd.detail}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
