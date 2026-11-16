import { Fragment, type CSSProperties } from 'react'
import type { Part, RollWord } from '../lib/welcome'

/**
 * The welcome screen's motion (styles: `.wb-*` in index.css). Numbers roll up
 * to their value like an odometer; the highlight's words roll in through other
 * words you've highlighted and settle left to right, as if picked from your
 * highlights. `in` is opening I read; `swap` is pressing Another (quicker).
 */
export type Enter = 'in' | 'swap'

type Vars = CSSProperties & Record<`--${string}`, string | number>

const DIGITS = Array.from({ length: 20 }, (_, i) => i % 10)

/**
 * One number. Each digit is a reel of 0–9 twice over: the first digit rolls
 * straight to its value, the others spin once more on the way, as counting would.
 * `delay` is the first digit's; each next one starts `step` later.
 */
export function RollNumber({ value, delay, step = 70, dur = 900 }: { value: number; delay: number; step?: number; dur?: number }) {
  const s = String(value)
  return (
    <>
      <span className="sr-only">{s}</span>
      <span aria-hidden="true">
        {s.split('').map((c, j) => {
          const d = c.charCodeAt(0) - 48
          if (d < 0 || d > 9) return <span key={j}>{c}</span>
          const style: Vars = { '--to': j === 0 ? d : d + 10, '--delay': `${delay + j * step}ms`, '--dur': `${dur}ms` }
          return (
            <span key={j} className="wb-reel wb-digit">
              <span className="wb-col" style={style}>
                {DIGITS.map((n, i) => (
                  <span key={i}>{n}</span>
                ))}
              </span>
            </span>
          )
        })}
      </span>
    </>
  )
}

/** A line about your reading: its numbers roll into place one digit after another, the words around them stay. */
export function RollingLine({ parts, enter }: { parts: Part[]; enter: Enter }) {
  const base = enter === 'in' ? 80 : 40
  const step = enter === 'in' ? 70 : 50
  const dur = enter === 'in' ? 900 : 650
  const starts: number[] = []
  parts.reduce<number>((at, p) => {
    starts.push(at)
    return typeof p === 'number' ? at + String(p).length : at
  }, 0)
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'number' ? <RollNumber key={i} value={p} delay={base + starts[i] * step} step={step} dur={dur} /> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  )
}

/** The highlight's words, each rolling through four others before it settles, left to right. */
export function RollingWords({ words, enter }: { words: RollWord[]; enter: Enter }) {
  const base = enter === 'in' ? 150 : 40
  const spread = enter === 'in' ? 450 : 300
  const dur = enter === 'in' ? 650 : 500
  return (
    <>
      {words.map((w, i) => {
        const style: Vars = { '--delay': `${Math.round(base + (i * spread) / words.length)}ms`, '--dur': `${dur}ms` }
        return (
          <Fragment key={i}>
            <span className="wb-reel wb-word">
              <span className="wb-col" style={style}>
                {w.decoys.map((d, j) => (
                  <span key={j} className="wb-decoy" aria-hidden="true">
                    {d}
                  </span>
                ))}
                <span>{w.word}</span>
              </span>
            </span>
            {i < words.length - 1 && ' '}
          </Fragment>
        )
      })}
    </>
  )
}
