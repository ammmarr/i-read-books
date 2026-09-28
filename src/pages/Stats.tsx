import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { ArrowDownRight, ArrowUpRight, BookOpen, ChartColumn, Table2 } from 'lucide-react'
import { db, type Book, type Session } from '../db/db'
import { bookProgress } from '../db/books'
import { PageContainer, PageHeader } from '../components/AppShell'
import { BookCover } from '../components/BookCover'
import { BarChart } from '../components/charts/BarChart'
import { Heatmap } from '../components/charts/Heatmap'
import { Button } from '../components/ui/Button'
import { ProgressBar } from '../components/ui/Progress'
import { Segmented } from '../components/ui/Segmented'
import { useSettings } from '../lib/settings'
import { useCountUp } from '../lib/hooks'
import { compact, formatDuration, formatDurationLong } from '../lib/format'
import {
  RANGES, addDays, bookStats, buckets, dailyTotals, heatmap, hourOfDay, previousWindow, rangeStart, startOfDay, streaks, summarize, type RangeKey,
} from '../lib/stats'

export default function Stats() {
  const sessions = useLiveQuery(() => db.sessions.toArray(), [])
  const books = useLiveQuery(() => db.books.toArray(), [])
  const [range, setRange] = useState<RangeKey>(() => {
    try { return (localStorage.getItem('irb-range') as RangeKey) || '30d' } catch { return '30d' }
  })
  const pick = (r: RangeKey) => {
    setRange(r)
    try { localStorage.setItem('irb-range', r) } catch { /* ignore */ }
  }

  if (!sessions || !books) return <PageContainer><div className="skeleton h-40 rounded-md" /></PageContainer>

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
      {sessions.length === 0 ? <NoData hasBooks={books.length > 0} /> : <Dashboard key={range} range={range} sessions={sessions} books={books} />}
    </PageContainer>
  )
}

function Dashboard({ range, sessions, books }: { range: RangeKey; sessions: Session[]; books: Book[] }) {
  const { dailyGoalMinutes } = useSettings()
  const now = Date.now()
  const start = rangeStart(range, sessions, now)
  const end = addDays(startOfDay(now), 1)
  const sum = useMemo(() => summarize(sessions, start, end), [sessions, start, end])
  const prevW = previousWindow(range, start, end)
  const prev = useMemo(() => (prevW ? summarize(sessions, prevW.start, prevW.end) : null), [sessions, prevW?.start, prevW?.end]) // eslint-disable-line react-hooks/exhaustive-deps
  const st = useMemo(() => streaks(dailyTotals(sessions)), [sessions])
  const { grain, buckets: bs } = useMemo(() => buckets(range, sessions, now), [range, sessions]) // eslint-disable-line react-hooks/exhaustive-deps
  const inRange = useMemo(() => sessions.filter((s) => s.start >= start && s.start < end), [sessions, start, end])
  const hours = useMemo(() => hourOfDay(inRange), [inRange])
  const heat = useMemo(() => heatmap(sessions, 53, dailyGoalMinutes * 60), [sessions, dailyGoalMinutes])
  const finishedInRange = books.filter((b) => b.finishedAt && b.finishedAt >= start && b.finishedAt < end).length
  const [asTable, setAsTable] = useState(false)
  const rangeLabel = RANGES.find((r) => r.key === range)!.long.toLowerCase()

  const goalPerBucket = grain === 'day' ? dailyGoalMinutes * 60 : grain === 'week' ? dailyGoalMinutes * 60 * 7 : 0
  const peakHour = hours.indexOf(Math.max(...hours))
  const totalHourSecs = hours.reduce((a, b) => a + b, 0)

  const booksInRange = useMemo(() => {
    const ids = new Set(inRange.map((s) => s.bookId))
    return books
      .filter((b) => ids.has(b.id))
      .map((b) => ({ book: b, inRange: inRange.filter((s) => s.bookId === b.id).reduce((a, s) => a + s.seconds, 0), stats: bookStats(b, sessions, sum.pagesPerHour) }))
      .sort((a, b) => b.inRange - a.inRange)
  }, [books, inRange, sessions, sum.pagesPerHour])

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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Tile label="Pages read" value={compact(sum.pages)} delta={prev ? { now: sum.pages, before: prev.pages } : undefined} />
          <Tile label="Daily average" value={formatDuration(sum.avgSecondsPerDay, { short: true })} sub={`${sum.activeDays} of ${sum.days} days`} />
          <Tile label="Current streak" value={`${st.current} ${st.current === 1 ? 'day' : 'days'}`} sub={`Best ${st.longest}`} />
          <Tile label="Reading pace" value={sum.pagesPerHour ? `${Math.round(sum.pagesPerHour)}` : '—'} sub="pages per hour" />
          <Tile label="Sessions" value={compact(sum.sessions)} sub={sum.sessions ? `avg ${formatDuration(sum.seconds / sum.sessions, { short: true })}` : undefined} />
          <Tile label="Books finished" value={String(finishedInRange)} sub={`${sum.booksTouched} opened`} />
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
                  <th className="py-2 text-right font-medium">Pages</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...bs].reverse().map((b) => (
                  <tr key={b.key} className="border-t border-hairline">
                    <td className="py-2 text-ink">{b.title}</td>
                    <td className="py-2 text-right text-body">{formatDuration(b.seconds)}</td>
                    <td className="py-2 text-right text-body">{b.pages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <BarChart
            ariaLabel={`Reading minutes per ${grain}, ${rangeLabel}`}
            data={bs.map((b) => ({ key: b.key, label: b.label, title: b.title, value: b.seconds / 60, detail: b.pages ? `${b.pages} pages` : undefined, isCurrent: b.isCurrent }))}
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
            <p className="text-body-md text-mute">Each square is a day. Darker means closer to — or past — your {dailyGoalMinutes}-minute goal.</p>
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
            data={hours.map((s, h) => ({ key: String(h), label: hourLabel(h), title: `${hourLabel(h, true)} – ${hourLabel((h + 1) % 24, true)}`, value: s / 60 }))}
            format={(m) => formatDurationLong(m * 60)}
            tick={(m) => (m >= 120 ? `${Math.round(m / 60)}h` : `${Math.round(m)}m`)}
          />
        </Card>

        {/* ── Per book ── */}
        <Card className="p-5 sm:p-6">
          <h2 className="text-heading-md text-ink">Books</h2>
          <p className="mb-4 text-body-md text-mute">Where your time went, and how far along you are.</p>
          <ul className="-mx-2 space-y-1">
            {booksInRange.slice(0, 6).map(({ book, inRange: secs, stats }, i) => (
              <motion.li key={book.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                <Link to={`/book/${book.id}`} className="flex items-center gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-hairline-soft">
                  <div className="w-8 shrink-0 rounded-[2px] shadow-cover">
                    <BookCover book={book} rounded="rounded-[2px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-label-sm text-ink">{book.title}</span>
                      <span className="shrink-0 text-body-sm tabular text-body">{formatDuration(secs, { short: true })}</span>
                    </div>
                    <ProgressBar value={bookProgress(book)} thin className="mt-1.5" />
                    <div className="mt-1 flex justify-between text-body-sm text-mute">
                      <span className="tabular">{Math.round(bookProgress(book) * 100)}%</span>
                      <span>{book.status === 'finished' ? 'Finished' : stats.remainingSeconds ? `~${formatDurationLong(stats.remainingSeconds)} to go` : ''}</span>
                    </div>
                  </div>
                </Link>
              </motion.li>
            ))}
            {!booksInRange.length && <li className="px-2 py-6 text-center text-body-md text-mute">No reading {rangeLabel}.</li>}
          </ul>
        </Card>
      </div>
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
        Reading time is tracked automatically while a book is open and you’re active — it pauses when you step away. Read for a few minutes and come back.
      </p>
      <Button className="mt-6" onClick={() => navigate('/')}>
        <BookOpen className="size-4" /> {hasBooks ? 'Go read something' : 'Add a book'}
      </Button>
    </Card>
  )
}
