import { useLayoutEffect, useRef, useState } from 'react'
import type { HeatCell } from '../../lib/stats'
import { formatDurationLong } from '../../lib/format'

const GAP = 3
const LEFT = 30
const TOP = 18

/** Year-at-a-glance calendar. Colour is a one-hue sequential ramp anchored to the daily goal. */
export function Heatmap({ cols }: { cols: HeatCell[][] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [tip, setTip] = useState<{ cell: HeatCell; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    // Measure now so the first paint already has the chart (RO fires a frame later).
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Show as many recent weeks as fit at a comfortable cell size.
  const cell = Math.max(10, Math.min(15, (w - LEFT) / cols.length - GAP))
  const fit = Math.max(1, Math.min(cols.length, Math.floor((w - LEFT + GAP) / (cell + GAP))))
  const shown = cols.slice(cols.length - fit)
  const height = TOP + 7 * (cell + GAP)

  const months: { x: number; label: string }[] = []
  shown.forEach((col, i) => {
    const d = new Date(col[0].ts)
    const prev = i > 0 ? new Date(shown[i - 1][0].ts) : null
    if (!prev || prev.getMonth() !== d.getMonth()) {
      if (i < shown.length - 1 || !prev) months.push({ x: LEFT + i * (cell + GAP), label: d.toLocaleDateString(undefined, { month: 'short' }) })
    }
  })
  // Avoid a clipped month label crowding the next one at the far left.
  if (months.length > 1 && months[1].x - months[0].x < 28) months.shift()

  return (
    <div ref={wrap} className="relative w-full" onMouseLeave={() => setTip(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="Daily reading calendar">
          {months.map((m) => (
            <text key={`${m.x}`} x={m.x} y={11} className="fill-mute text-[11px]">
              {m.label}
            </text>
          ))}
          {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) =>
            d ? (
              <text key={d} x={0} y={TOP + i * (cell + GAP) + cell / 2} dy="0.32em" className="fill-mute text-[11px]">
                {d}
              </text>
            ) : null,
          )}
          {shown.map((col, ci) =>
            col.map((c, ri) =>
              c.future ? null : (
                <rect
                  key={c.key}
                  x={LEFT + ci * (cell + GAP)}
                  y={TOP + ri * (cell + GAP)}
                  width={cell}
                  height={cell}
                  rx={3}
                  fill={`var(--color-seq-${c.level})`}
                  className="heat-cell"
                  style={{ animationDelay: `${ci * 12}ms` }}
                  onMouseEnter={(e) => {
                    const r = wrap.current!.getBoundingClientRect()
                    const b = (e.target as SVGRectElement).getBoundingClientRect()
                    setTip({ cell: c, x: b.left - r.left + b.width / 2, y: b.top - r.top })
                  }}
                  onClick={(e) => {
                    const r = wrap.current!.getBoundingClientRect()
                    const b = (e.target as SVGRectElement).getBoundingClientRect()
                    setTip({ cell: c, x: b.left - r.left + b.width / 2, y: b.top - r.top })
                  }}
                />
              ),
            ),
          )}
        </svg>
      )}
      {tip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-hairline bg-canvas-elevated px-2.5 py-1.5 shadow-floating"
          style={{ left: Math.max(60, Math.min(tip.x, w - 60)), top: tip.y - 6 }}
        >
          <div className="text-label-sm text-ink">{tip.cell.seconds >= 60 ? formatDurationLong(tip.cell.seconds) : 'No reading'}</div>
          <div className="text-body-sm text-mute">{new Date(tip.cell.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-1.5 text-body-sm text-mute">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="size-[11px] rounded-[3px]" style={{ background: `var(--color-seq-${l})` }} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
