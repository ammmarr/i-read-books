import art from '../assets/logo.json'

/**
 *   draw       the line sketches itself in, once
 *   flow       every few seconds a soft light runs along the line
 *   draw-flow  both: draw in, then keep flowing
 */
export type LogoMotion = 'draw' | 'flow' | 'draw-flow' | 'none'

/**
 * The mark: two hands holding an open book, drawn in one continuous line —
 * vector, so it's sharp at any size, and stroked in the current text colour.
 * `weight` is the line width in drawing units (the drawing is 482 tall), so
 * small logos need a larger number to stay visible. Animations live in
 * index.css (.logo-*) and switch off with "reduce motion".
 */
export function Logo({
  className = '',
  title,
  motion = 'draw-flow',
  weight = 5,
}: {
  className?: string
  title?: string
  motion?: LogoMotion
  weight?: number
}) {
  const flow = motion === 'flow' || motion === 'draw-flow'
  return (
    <svg
      viewBox={`0 0 ${art.w} ${art.h}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`logo-art ${motion === 'none' ? '' : `logo-${motion}`} overflow-visible ${className}`}
    >
      <g className="logo-lines" strokeWidth={weight}>
        {art.paths.map((d, i) => (
          <path key={i} d={d} pathLength={1} />
        ))}
      </g>
      {flow && (
        <g className="logo-glint" strokeWidth={weight * (weight > 8 ? 1.4 : 1.8)}>
          {art.paths.map((d, i) => (
            <path key={i} d={d} pathLength={1} />
          ))}
        </g>
      )}
    </svg>
  )
}
