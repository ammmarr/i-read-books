import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { ArrowRight, BookOpen } from 'lucide-react'
import { db, type Book, type Session, type WebRead } from '../db/db'
import { PageContainer, PageHeader } from '../components/AppShell'
import { Button } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { TodayGauge } from './LibraryShelf'
import { Card, CommitGraph, Hero, HighlightsSection, InsightsCard, TimeChart, YearAndBooks, type Insight, type Said } from './InsightsParts'
import { marksOf } from '../lib/marks'
import { dailyGoal, useSettings } from '../lib/settings'
import { useAllReading } from '../lib/web'
import { readShares } from '../lib/share'
import { spoken } from '../lib/welcome'
import { formatDuration, pluralize } from '../lib/format'
import { RANGES, addDays, buckets, dailyTotals, dayKey, finishGuesses, finishedBooks, onTrackFor, previousWindow, rangeStart, startOfDay, streaks, summarize, type RangeKey } from '../lib/stats'

/** All your reading — books and the web — as one: a sentence, the time, insights, a year of days, highlights & quotes, and your books. */
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

const DAY = 86_400_000

function Dashboard({ range, sessions, bookSessions, reads, books }: {
  range: RangeKey; sessions: Session[]; bookSessions: Session[]; reads: WebRead[]; books: Book[]
}) {
  const navigate = useNavigate()
  const goalMinutes = dailyGoal(useSettings())
  const goal = goalMinutes * 60
  const now = Date.now()
  const start = rangeStart(range, sessions, now)
  const end = addDays(startOfDay(now), 1)
  const sum = useMemo(() => summarize(sessions, start, end), [sessions, start, end])
  const prevW = previousWindow(range, start, end)
  const prev = useMemo(() => (prevW ? summarize(sessions, prevW.start, prevW.end) : null), [sessions, prevW?.start, prevW?.end]) // eslint-disable-line react-hooks/exhaustive-deps
  const daily = useMemo(() => dailyTotals(sessions), [sessions])
  const st = useMemo(() => streaks(daily), [daily])
  const { grain, buckets: bs } = useMemo(() => buckets(range, sessions, now, start), [range, sessions, start]) // eslint-disable-line react-hooks/exhaustive-deps
  const highlights = useLiveQuery(() => db.highlights.toArray(), [])
  const web = useLiveQuery(() => db.webAnnotations.toArray(), [])
  const marks = useMemo(() => marksOf(highlights ?? [], web ?? [], books), [highlights, web, books])
  // Each day's books, pages and highlights, for the year of days.
  const dayInfo = useMemo(() => {
    const title = new Map(books.map((b) => [b.id, b.title]))
    const m = new Map<string, { books: string[]; pages: number; marks: number }>()
    const get = (k: string) => {
      let d = m.get(k)
      if (!d) m.set(k, (d = { books: [], pages: 0, marks: 0 }))
      return d
    }
    for (const s of bookSessions) {
      const d = get(dayKey(s.start))
      const t = title.get(s.bookId)
      if (t && !d.books.includes(t)) d.books.push(t)
      d.pages += s.pages.length
    }
    for (const x of marks) get(dayKey(x.at)).marks++
    return m
  }, [bookSessions, books, marks])
  const shares = useMemo(() => readShares(), [])
  const highlightsByBook = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of highlights ?? []) m.set(h.bookId, (m.get(h.bookId) ?? 0) + 1)
    return m
  }, [highlights])

  const r = RANGES.find((x) => x.key === range)!
  const inThe = range === 'all' ? 'since you started' : `in the ${r.long.toLowerCase()}`
  const before = range === '1y' ? 'the year before' : `the ${r.long.toLowerCase().replace('last ', '')} before`
  const goalDays = useMemo(() => {
    let n = 0
    for (const [k, t] of daily) {
      const ts = new Date(`${k}T00:00:00`).getTime()
      if (ts >= start && ts < end && goal > 0 && t.seconds >= goal) n++
    }
    return n
  }, [daily, start, end, goal])
  const current = books
    .filter((b) => b.lastOpenedAt && b.status !== 'finished' && b.pageCount > 0)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0]

  // ── The sentence ──
  const said: Said = []
  if (sum.seconds >= 60) {
    said.push('You read ', { b: spoken(sum.seconds) }, ` ${inThe}`)
    if (prev && prev.seconds > 0 && sum.seconds - prev.seconds >= 600) said.push(', ', { b: `${spoken(sum.seconds - prev.seconds)} more` }, ` than ${before}`)
    said.push('.')
  } else said.push(`Nothing read ${inThe} yet.`)
  const next = finishGuesses(books, bookSessions).find((g) => g.date != null && (g.days ?? 0) <= 60)
  if (next?.date != null) {
    const d = new Date(next.date)
    const when = next.days === 0 ? 'today' : next.days === 1 ? 'tomorrow' : (next.days ?? 99) <= 6 ? `this ${d.toLocaleDateString(undefined, { weekday: 'long' })}` : `on ${d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`
    said.push(' ', { b: next.book.title }, ' ends ', { b: when }, ' at your pace.')
  }
  const better = (a: number, b: number | undefined) =>
    b && a > b * 1.005 ? <span className="text-body-sm font-normal text-success">↑ {Math.round(((a - b) / b) * 100)}%</span> : null

  // ── Insights, worked out from your own numbers ──
  const insights = useMemo(() => {
    const out: Insight[] = []
    const days = Math.round((end - start) / DAY)
    if (days >= 14) {
      let we = 0, wd = 0, nwe = 0, nwd = 0
      for (let d = start; d < end; d = addDays(d, 1)) {
        const s = daily.get(dayKey(d))?.seconds ?? 0
        if ([0, 6].includes(new Date(d).getDay())) { we += s; nwe++ } else { wd += s; nwd++ }
      }
      const a = we / Math.max(1, nwe), b = wd / Math.max(1, nwd)
      if (a > 0 && b > 0 && a / b >= 1.1) out.push({ a: 'You read ', b: `${Math.round((a / b - 1) * 100)}% more`, c: ' on weekends than on weekdays.' })
      else if (a > 0 && b > 0 && b / a >= 1.1) out.push({ a: 'You read ', b: `${Math.round((b / a - 1) * 100)}% more`, c: ' on weekdays than at the weekend.' })
    }
    // Where you highlight most, for the pages you read there.
    const pages = new Map<string, Set<number>>()
    for (const s of bookSessions) if (s.start >= start && s.start < end) {
      const set = pages.get(s.bookId) ?? new Set<number>()
      s.pages.forEach((p) => set.add(p))
      pages.set(s.bookId, set)
    }
    let dense: { title: string; every: number } | null = null
    for (const b of books) {
      const n = marks.filter((m) => m.from === b.id && m.at >= start && m.at < end).length
      const p = pages.get(b.id)?.size ?? 0
      if (n >= 5 && p >= 10 && (!dense || p / n < dense.every)) dense = { title: b.title, every: p / n }
    }
    if (dense) out.push({ a: 'You highlight most in ', b: dense.title, c: `: one highlight every ${pluralize(Math.max(1, Math.round(dense.every)), 'page')}.` })
    let best = { d: 0, s: 0 }
    for (let d = start; d < end; d = addDays(d, 1)) {
      const s = daily.get(dayKey(d))?.seconds ?? 0
      if (s > best.s) best = { d, s }
    }
    if (best.s >= 30 * 60) out.push({ a: 'Your best day was ', b: new Date(best.d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), c: `: ${spoken(best.s)}.` })
    if (st.current >= 3) out.push({ a: '', b: `${st.current} days in a row`, c: st.longest > st.current ? ` now; your best is ${st.longest}.` : ' now, your longest yet.' })
    const done = books.filter((b) => b.status === 'finished' && b.finishedAt && b.finishedAt >= start && b.finishedAt < end)
    if (done.length) out.push({ a: 'You finished ', b: pluralize(done.length, 'book'), c: ` ${inThe}${done.length === 1 ? `: ${done[0].title}` : ''}.` })
    const year = finishedBooks(books, new Date().getFullYear()).length
    const track = onTrackFor(year)
    if (track && track > year) out.push({ a: 'At this pace you’ll finish ', b: pluralize(track, 'book'), c: ' this year.' })
    const sh = shares.filter((s) => s.at >= start && s.at < end && s.title)
    if (sh.length >= 3) {
      const by = new Map<string, number>()
      for (const s of sh) by.set(s.title!, (by.get(s.title!) ?? 0) + 1)
      const [title, k] = [...by.entries()].sort((a, b) => b[1] - a[1])[0]
      out.push({ a: 'The quotes you share come mostly from ', b: title, c: `: ${k} of ${sh.length}.` })
    }
    return out
  }, [start, end, daily, bookSessions, books, marks, st, inThe, shares])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <Hero
        said={said}
        stats={[
          { label: 'Daily average', value: formatDuration(sum.avgSecondsPerDay, { short: true }), extra: better(sum.avgSecondsPerDay, prev?.avgSecondsPerDay) },
          { label: 'Goal reached', value: goal ? `${goalDays} of ${pluralize(sum.days, 'day')}` : 'No goal set' },
          { label: 'Streak', value: pluralize(st.current, 'day'), extra: st.longest > st.current ? <span className="text-body-sm font-normal text-mute">best {st.longest}</span> : null },
          { label: 'Pages read', value: sum.pages.toLocaleString(), extra: better(sum.pages, prev?.pages) },
        ]}
        aside={
          <>
            <TodayGauge sessions={bookSessions} reads={reads} />
            {current && (
              <Button className="mt-1 w-[210px] max-w-full justify-center" onClick={() => navigate(`/read/${current.id}`)}>
                <span className="truncate">Continue {current.title}</span> <ArrowRight className="size-4 shrink-0" />
              </Button>
            )}
          </>
        }
      />
      <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <TimeChart
          buckets={bs}
          grain={grain}
          goal={grain === 'day' ? goal : grain === 'week' ? goal * 7 : 0}
          highlights={bs.map((b) => marks.filter((m) => m.at >= b.start && m.at < b.end).length)}
          total={sum.seconds}
          change={prev && prev.seconds > 0 ? (sum.seconds - prev.seconds) / prev.seconds : null}
          before={before}
        />
        <InsightsCard items={insights} />
      </div>
      <CommitGraph daily={daily} goal={goal} streak={st} info={dayInfo} />
      <HighlightsSection marks={marks} books={books} shares={shares} start={start} end={end} prev={prevW} buckets={bs} rangeLabel={r.long} before={before} />
      <YearAndBooks daily={daily} goal={goal} books={books} sessions={bookSessions} highlightsByBook={highlightsByBook} />
    </motion.div>
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
        Reading time is tracked automatically while a book is open and you’re active — and on the web, by the I read extension for Chrome. Read for a few minutes and come back.
      </p>
      <Button className="mt-6" onClick={() => navigate('/')}>
        <BookOpen className="size-4" /> {hasBooks ? 'Go read something' : 'Add a book'}
      </Button>
    </Card>
  )
}
