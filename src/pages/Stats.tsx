import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { ArrowDownRight, ArrowUpRight, BookOpen, ChartColumn, Table2 } from 'lucide-react'
import { db, type Book, type Session, type WebRead } from '../db/db'
import { bookProgress } from '../db/books'
import { PageContainer, PageHeader } from '../components/AppShell'
import { BookCover } from '../components/BookCover'
import { BarChart, type BarDatum } from '../components/charts/BarChart'
import { Heatmap } from '../components/charts/Heatmap'
import { Button } from '../components/ui/Button'
import { ProgressBar } from '../components/ui/Progress'
import { Segmented } from '../components/ui/Segmented'
import { Monogram } from './LibrarySubstack'
import { dailyGoal, useSettings } from '../lib/settings'
import { articlesOf, newslettersOf, useAllReading } from '../lib/web'
import { useCountUp } from '../lib/hooks'
import { compact, formatDuration, formatDurationLong, pluralize } from '../lib/format'
import {
  RANGES, addDays, bookStats, buckets, dailyTotals, heatmap, hourOfDay, previousWindow, rangeStart, startOfDay, streaks, summarize, type RangeKey,
} from '../lib/stats'

/** All your reading — books and Substack — as one: one total, one goal, one colour. */
export default function Stats() {
  const data = useAllReading()
  const books = useLiveQuery(() => db.books.toArray(), [])
  const [range, setRange] = useState<RangeKey>(() => {
    try { return (localStorage.getItem('irb-range') as RangeKey) || '30d' } catch { return '30d' }
  })
  const pick = (r: RangeKey) => {
    setRange(r)
    try { localStorage.setItem('irb-range', r) } catch { /* ignore */ }
  }

  if (!data || !books) return <PageContainer><div className="skeleton h-40 rounded-md" /></PageContainer>
  const empty = data.all.length === 0

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Insights"
        title="Your reading"
        actions={
          <Segmented
            size="sm"
            value={range}
            onChange={pick}
            ariaLabel="Time range"
            options={RANGES.map((r) => ({ value: r.key, label: r.label, title: r.long }))}
          />
        }
      />
      {empty ? (
        <NoData hasBooks={books.length > 0} />
      ) : (
        <Dashboard key={range} range={range} sessions={data.all} bookSessions={data.books} reads={data.reads} books={books} />
      )}
    </PageContainer>
  )
}

function Dashboard({ range, sessions, bookSessions, reads, books }: {
  range: RangeKey; sessions: Session[]; bookSessions: Session[]; reads: WebRead[]; books: Book[]
}) {
  const goalMinutes = dailyGoal(useSettings())
  const now = Date.now()
  const start = rangeStart(range, sessions, now)
  const end = addDays(startOfDay(now), 1)
  const sum = useMemo(() => summarize(sessions, start, end), [sessions, start, end])
  const prevW = previousWindow(range, start, end)
  const prev = useMemo(() => (prevW ? summarize(sessions, prevW.start, prevW.end) : null), [sessions, prevW?.start, prevW?.end]) // eslint-disable-line react-hooks/exhaustive-deps
  const daily = useMemo(() => dailyTotals(sessions), [sessions])
  const st = useMemo(() => streaks(daily), [daily])
  const { grain, buckets: bs } = useMemo(() => buckets(range, sessions, now, start), [range, sessions, start]) // eslint-disable-line react-hooks/exhaustive-deps
  const inRange = useMemo(() => sessions.filter((s) => s.start >= start && s.start < end), [sessions, start, end])
  const hours = useMemo(() => hourOfDay(inRange), [inRange])
  const heat = useMemo(() => heatmap(sessions, 53, goalMinutes * 60), [sessions, goalMinutes])
  const [asTable, setAsTable] = useState(false)
  const rangeLabel = RANGES.find((r) => r.key === range)!.long.toLowerCase()

  const goalPerBucket = !goalMinutes ? 0 : grain === 'day' ? goalMinutes * 60 : grain === 'week' ? goalMinutes * 60 * 7 : 0
  const peakHour = hours.indexOf(Math.max(...hours))
  const totalHourSecs = hours.reduce((a, b) => a + b, 0)
  /** Days in the range you reached your goal. */
  const goalDays = useMemo(() => {
    let n = 0
    for (const [k, t] of daily) {
      const ts = new Date(`${k}T00:00:00`).getTime()
      if (ts >= start && ts < end && goalMinutes > 0 && t.seconds >= goalMinutes * 60) n++
    }
    return n
  }, [daily, start, end, goalMinutes])

  // What you read: books and newsletters in one list, by the time you gave them.
  const readsInRange = useMemo(() => reads.filter((r) => r.start >= start && r.start < end), [reads, start, end])
  const letters = useMemo(() => newslettersOf(articlesOf(readsInRange)), [readsInRange])
  const items = useMemo(() => {
    const own = bookSessions.filter((s) => s.start >= start && s.start < end)
    const ids = new Set(own.map((s) => s.bookId))
    const pph = summarize(bookSessions, start, end).pagesPerHour
    const bookItems = books
      .filter((b) => ids.has(b.id))
      .map((b) => ({
        kind: 'book' as const,
        key: b.id,
        book: b,
        seconds: own.filter((s) => s.bookId === b.id).reduce((a, s) => a + s.seconds, 0),
        stats: bookStats(b, bookSessions, pph),
      }))
    const letterItems = letters.map((n) => ({ kind: 'letter' as const, key: `letter:${n.name}`, letter: n, seconds: n.seconds }))
    return [...bookItems, ...letterItems].sort((a, b) => b.seconds - a.seconds)
  }, [books, bookSessions, letters, start, end])

  const chartData: BarDatum[] = bs.map((b) => ({ key: b.key, label: b.label, title: b.title, value: b.seconds / 60, isCurrent: b.isCurrent }))

  return (
    <div className="space-y-4">
      {/* ── Headline ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <Card className="flex flex-col justify-between p-6">
          <div className="text-mono-eyebrow text-mute">Time reading</div>
          <div>
            <Hero seconds={sum.seconds} />
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-md text-mute">
              {prev && <Delta now={sum.seconds} before={prev.seconds} />}
              <span>{rangeLabel}</span>
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <Tile label="Daily average" value={formatDuration(sum.avgSecondsPerDay, { short: true })} sub={`${sum.activeDays} of ${sum.days} days read`} />
          <Tile label="Goal reached" value={`${goalDays} ${goalDays === 1 ? 'day' : 'days'}`} sub={`of ${sum.days} · ${goalMinutes} min a day`} />
          <Tile label="Current streak" value={`${st.current} ${st.current === 1 ? 'day' : 'days'}`} sub={`Best ${st.longest}`} />
          <Tile label="Sessions" value={compact(sum.sessions)} sub={sum.sessions ? `avg ${formatDuration(sum.seconds / sum.sessions, { short: true })}` : undefined} />
        </div>
      </div>

      {/* ── Time chart ── */}
      <Card className="p-5 sm:p-6">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-heading-md text-ink">Reading time</h2>
            <p className="text-body-md text-mute">
              Minutes per {grain}
              {goalPerBucket ? ` · line marks your ${grain === 'day' ? 'daily' : 'weekly'} goal` : ''}
            </p>
          </div>
          <Segmented
            size="sm"
            value={asTable ? 'table' : 'chart'}
            onChange={(v) => setAsTable(v === 'table')}
            ariaLabel="View as"
            options={[
              { value: 'chart', label: <ChartColumn className="size-3.5" />, title: 'Chart' },
              { value: 'table', label: <Table2 className="size-3.5" />, title: 'Table' },
            ]}
          />
        </div>
        {asTable ? (
          <div className="max-h-[260px] overflow-y-auto">
            <table className="w-full text-body-md">
              <thead className="sticky top-0 bg-canvas-elevated text-left text-body-sm text-mute">
                <tr>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...bs].reverse().map((b) => (
                  <tr key={b.key} className="border-t border-hairline">
                    <td className="py-2 text-ink">{b.title}</td>
                    <td className="py-2 text-right text-body">{formatDuration(b.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <BarChart
            ariaLabel={`Reading minutes per ${grain}, ${rangeLabel}`}
            data={chartData}
            format={(m) => formatDurationLong(m * 60)}
            tick={(m) => (m >= 120 ? `${Math.round(m / 60)}h` : `${Math.round(m)}m`)}
            goal={goalPerBucket ? { value: goalPerBucket / 60, label: `Goal ${formatDuration(goalPerBucket, { short: true })}` } : undefined}
          />
        )}
      </Card>

      {/* ── Consistency ── */}
      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-heading-md text-ink">Consistency</h2>
            <p className="text-body-md text-mute">
              Each square is a day. {goalMinutes ? `Darker means closer to — or past — your ${goalMinutes}-minute goal.` : 'Darker means more reading.'}
            </p>
          </div>
          <div className="flex gap-6 text-right">
            <MiniStat label="Current streak" value={`${st.current}d`} />
            <MiniStat label="Longest" value={`${st.longest}d`} />
          </div>
        </div>
        <Heatmap cols={heat} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Time of day ── */}
        <Card className="p-5 sm:p-6">
          <h2 className="text-heading-md text-ink">When you read</h2>
          <p className="mb-6 text-body-md text-mute">
            {totalHourSecs > 60 ? `Most often around ${hourLabel(peakHour, true)}.` : 'Read a little more to see your rhythm.'}
          </p>
          <BarChart
            ariaLabel="Reading minutes by hour of day"
            height={180}
            labelEvery={6}
            data={hours.map((s, h) => ({
              key: String(h),
              label: hourLabel(h),
              title: `${hourLabel(h, true)} – ${hourLabel((h + 1) % 24, true)}`,
              value: s / 60,
            }))}
            format={(m) => formatDurationLong(m * 60)}
            tick={(m) => (m >= 120 ? `${Math.round(m / 60)}h` : `${Math.round(m)}m`)}
          />
        </Card>

        {/* ── What you read ── */}
        <Card className="p-5 sm:p-6">
          <h2 className="text-heading-md text-ink">What you read</h2>
          <p className="mb-4 text-body-md text-mute">Where your time went, {rangeLabel}.</p>
          <ul className="-mx-2 space-y-1">
            {items.slice(0, 8).map((it, i) => (
              <motion.li key={it.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                {it.kind === 'book' ? (
                  <Link to={`/book/${it.book.id}`} className="flex items-center gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-hairline-soft">
                    <div className="w-8 shrink-0 rounded-[2px] shadow-cover">
                      <BookCover book={it.book} rounded="rounded-[2px]" />
                    </div>
                    <ItemBody
                      title={it.book.title}
                      seconds={it.seconds}
                      share={items[0] ? it.seconds / items[0].seconds : 0}
                      sub={`${Math.round(bookProgress(it.book) * 100)}% read${it.book.status === 'finished' ? ' · finished' : it.stats.remainingSeconds ? ` · ~${formatDurationLong(it.stats.remainingSeconds)} to go` : ''}`}
                    />
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-sm px-2 py-2">
                    <Monogram name={it.letter.name} size="sm" className="w-8 shrink-0" />
                    <ItemBody title={it.letter.name} seconds={it.seconds} share={items[0] ? it.seconds / items[0].seconds : 0} sub={pluralize(it.letter.articles, 'article')} />
                  </div>
                )}
              </motion.li>
            ))}
            {!items.length && <li className="px-2 py-6 text-center text-body-md text-mute">Nothing read {rangeLabel}.</li>}
          </ul>
        </Card>
      </div>
    </div>
  )
}

/** A row of "What you read": its time, a bar for its share against the top one, and a detail line. */
function ItemBody({ title, seconds, share, sub }: { title: string; seconds: number; share: number; sub: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-label-sm text-ink">{title}</span>
        <span className="shrink-0 text-body-sm tabular text-body">{formatDuration(seconds, { short: true })}</span>
      </div>
      <ProgressBar value={share} thin className="mt-1.5" />
      <div className="mt-1 truncate text-body-sm text-mute">{sub}</div>
    </div>
  )
}

/** "6am" on the axis, "6 am" in prose — follows the locale's 12/24h clock. */
function hourLabel(h: number, long = false) {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  const s = d.toLocaleTimeString(undefined, { hour: 'numeric' }).toLowerCase()
  return long ? s : s.replace(/\s/g, '')
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-md border border-hairline bg-canvas-elevated ${className}`}
    >
      {children}
    </motion.div>
  )
}

function Hero({ seconds }: { seconds: number }) {
  const v = useCountUp(seconds)
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  return (
    <div className="mt-6 flex items-baseline gap-1.5 text-ink">
      {h > 0 && (
        <>
          <span className="text-[56px] font-semibold leading-none tracking-[-2.8px]">{h}</span>
          <span className="mr-2 text-heading-md text-mute">h</span>
        </>
      )}
      <span className="text-[56px] font-semibold leading-none tracking-[-2.8px]">{m}</span>
      <span className="text-heading-md text-mute">m</span>
    </div>
  )
}

function Delta({ now, before }: { now: number; before: number }) {
  if (before <= 0 && now <= 0) return null
  if (before <= 0) return <span className="inline-flex items-center gap-0.5 rounded-full bg-success/10 px-2 py-0.5 text-body-sm font-medium text-success"><ArrowUpRight className="size-3.5" />New</span>
  const pct = Math.round(((now - before) / before) * 100)
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-body-sm font-medium ${up ? 'bg-success/10 text-success' : 'bg-hairline-soft text-body'}`} title="Compared with the previous period">
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}%
    </span>
  )
}

function Tile({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: { now: number; before: number } }) {
  return (
    <Card className="flex flex-col justify-between p-4 sm:p-5">
      <div className="text-body-sm text-mute">{label}</div>
      <div className="mt-3">
        <div className="text-[26px] font-semibold leading-8 tracking-[-1px] text-ink">{value}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-body-sm text-mute">
          {delta && <Delta {...delta} />}
          {sub}
        </div>
      </div>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-heading-md tabular text-ink">{value}</div>
      <div className="text-body-sm text-mute">{label}</div>
    </div>
  )
}

function NoData({ hasBooks }: { hasBooks: boolean }) {
  const navigate = useNavigate()
  return (
    <Card className="flex flex-col items-center px-6 py-16 text-center">
      <div className="flex h-16 items-end gap-1.5">
        {[28, 44, 20, 56, 36, 64, 48].map((h, i) => (
          <motion.span
            key={i}
            className="w-3 rounded-t-[4px] bg-hairline"
            initial={{ height: 0 }}
            animate={{ height: h }}
            transition={{ delay: 0.1 + i * 0.06, type: 'spring', stiffness: 200, damping: 18 }}
          />
        ))}
      </div>
      <h2 className="mt-6 text-heading-md text-ink">Your insights will grow here</h2>
      <p className="mt-2 max-w-md text-body-md text-mute">
        Reading time is tracked automatically while a book is open and you’re active — and on Substack, by the I read extension for Chrome. Read for a few minutes and come back.
      </p>
      <Button className="mt-6" onClick={() => navigate('/')}>
        <BookOpen className="size-4" /> {hasBooks ? 'Go read something' : 'Add a book'}
      </Button>
    </Card>
  )
}
