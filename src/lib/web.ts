import { useLiveQuery } from 'dexie-react-hooks'
import { db, type WebRead } from '../db/db'
import { addDays, startOfDay } from './stats'

/** Substack reading (from the Chrome extension), newest first. */
export function useWebReads() {
  return useLiveQuery(() => db.webReads.orderBy('start').reverse().toArray(), [])
}

/** Seconds read between `from` and `to`. */
export function webSeconds(reads: WebRead[], from: number, to = Infinity) {
  return reads.reduce((a, r) => (r.start >= from && r.start < to ? a + r.seconds : a), 0)
}

export const webToday = (reads: WebRead[]) => webSeconds(reads, startOfDay(Date.now()))

/** The last `n` days, oldest first, for a bar chart. */
export function webDays(reads: WebRead[], n: number) {
  const today = startOfDay(Date.now())
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - n + 1)
    const d = new Date(day)
    return {
      key: String(day),
      label: d.toLocaleDateString(undefined, { day: 'numeric' }),
      title: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      value: webSeconds(reads, day, addDays(day, 1)) / 60,
      isCurrent: day === today,
    }
  })
}
