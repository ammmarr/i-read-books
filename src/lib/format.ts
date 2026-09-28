export function formatDuration(seconds: number, { short = false } = {}) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return short ? `${h}h ${m}m` : `${h}h ${m.toString().padStart(2, '0')}m`
  if (m > 0) return `${m}m`
  return s > 0 ? `${s}s` : '0m'
}

/** "12 min", "1 hr 20 min" — friendlier than the compact form in prose. */
export function formatDurationLong(seconds: number) {
  const m = Math.round(seconds / 60)
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} hr ${rest} min` : `${h} hr`
}

export function compact(n: number) {
  if (n >= 10_000) return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  return new Intl.NumberFormat().format(Math.round(n))
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function relativeTime(ts: number) {
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const min = 60_000, hr = 60 * min, day = 24 * hr
  if (abs < min) return 'just now'
  if (abs < hr) return rtf.format(Math.round(diff / min), 'minute')
  if (abs < day) return rtf.format(Math.round(diff / hr), 'hour')
  if (abs < 7 * day) return rtf.format(Math.round(diff / day), 'day')
  return formatDate(ts)
}

export function formatDate(ts: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? opts : { ...opts, year: 'numeric' })
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Reading late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${compact(n)} ${n === 1 ? one : many}`
}
