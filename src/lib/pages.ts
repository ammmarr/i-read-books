import type { Book } from '../db/db'

/**
 * Pages you've actually read, stored compactly as ranges ("0-12,15,40-58").
 * Progress is based on this set — not on the furthest page you've *visited* —
 * so skimming ahead, scrubbing or following a link doesn't count as reading.
 */
export function parsePages(s: string | undefined | null): Set<number> {
  const out = new Set<number>()
  if (!s) return out
  for (const part of s.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10))
    if (Number.isNaN(a)) continue
    const end = Number.isNaN(b) ? a : b
    for (let i = a; i <= end && i - a < 100_000; i++) out.add(i)
  }
  return out
}

export function formatPages(set: Iterable<number>): string {
  const xs = [...set].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < xs.length; ) {
    let j = i
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++
    parts.push(i === j ? `${xs[i]}` : `${xs[i]}-${xs[j]}`)
    i = j + 1
  }
  return parts.join(',')
}

/**
 * Pages read for a book. Books from before page tracking fall back to
 * "everything up to the furthest page".
 */
export function readPagesOf(b: Pick<Book, 'readPages' | 'furthestPage' | 'pageCount'>): Set<number> {
  if (b.readPages != null) return parsePages(b.readPages)
  const s = new Set<number>()
  if (b.furthestPage > 0) for (let i = 0; i <= Math.min(b.furthestPage, b.pageCount - 1); i++) s.add(i)
  return s
}

export function readCount(b: Pick<Book, 'readPages' | 'furthestPage' | 'pageCount'>) {
  return readPagesOf(b).size
}

/**
 * Seconds a page must stay in view (while you're active) to count as read:
 * a quarter of its expected reading time at ~1,500 characters a minute,
 * between 3 s (images, near-empty pages) and 15 s (dense text).
 */
export function dwellFor(chars: number | undefined) {
  if (chars == null) return 8
  return Math.max(3, Math.min(15, Math.round((chars / 1500) * 60 * 0.25)))
}
