import { Download, ExternalLink, Minus, Newspaper, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import type { WebRead } from '../db/db'
import { updateSettings, useSettings } from '../lib/settings'
import { useWebReads, webDays, webSeconds, webToday } from '../lib/web'
import { addDays, startOfDay } from '../lib/stats'
import { formatDuration, formatDurationLong, relativeTime } from '../lib/format'
import { BarChart } from './charts/BarChart'
import { ProgressBar } from './ui/Progress'
import { isNative } from '../lib/native'
import { useExtension } from '../lib/share'
import { SubstackMark, XMark } from './ShareQuote'

/**
 * Substack reading, counted by the Chrome extension (extension/) — its own
 * daily goal, apart from the books one.
 */

/** "Substack · 12 of 30 min" — under the books goal on the Library's Today card. */
export function SubstackTodayLine() {
  const reads = useWebReads()
  const { substackGoalMinutes: goal } = useSettings()
  if (!reads?.length) return null
  const m = Math.floor(webToday(reads) / 60)
  return (
    <p className="mt-1 flex items-center gap-1.5 text-body-sm text-mute">
      <Newspaper className={`size-3.5 ${m >= goal ? 'text-success' : 'text-faint'}`} />
      Substack · {m} of {goal} min
    </p>
  )
}

/** Insights: today against the goal, the last two weeks, and what you read. */
export function SubstackInsights() {
  const reads = useWebReads()
  const { substackGoalMinutes: goal } = useSettings()
  if (!reads?.length) return null
  const today = webToday(reads)
  const week = webSeconds(reads, addDays(startOfDay(Date.now()), -6))
  const met = today >= goal * 60
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="mt-4 rounded-md border border-hairline bg-canvas-elevated p-5 sm:p-6"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-heading-md text-ink">
            <Newspaper className="size-5 text-mute" /> Substack
          </h2>
          <p className="text-body-md text-mute">Ideas and general knowledge — counted in Chrome by the I read extension.</p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-mono-eyebrow text-mute">Today</div>
            <div className={`mt-1 text-heading-md tabular ${met ? 'text-success' : 'text-ink'}`}>
              {Math.floor(today / 60)}
              <span className="text-body-md text-mute"> / {goal} min</span>
            </div>
          </div>
          <div>
            <div className="text-mono-eyebrow text-mute">7 days</div>
            <div className="mt-1 text-heading-md tabular text-ink">{formatDuration(week, { short: true })}</div>
          </div>
        </div>
      </div>
      <ProgressBar value={today / (goal * 60)} thin color={met ? 'var(--color-success)' : 'var(--color-link)'} className="mb-6" />
      <BarChart
        ariaLabel="Substack minutes per day, last 14 days"
        height={170}
        data={webDays(reads, 14)}
        format={(m) => formatDurationLong(m * 60)}
        tick={(m) => `${Math.round(m)}m`}
        goal={{ value: goal, label: `Goal ${goal}m` }}
      />
      <h3 className="mb-2 mt-6 text-label-sm text-ink">Recently read</h3>
      <ul className="-mx-2">
        {reads.slice(0, 8).map((r) => (
          <ReadRow key={r.id} r={r} />
        ))}
      </ul>
    </motion.section>
  )
}

function ReadRow({ r }: { r: WebRead }) {
  return (
    <li>
      <a href={r.url} target="_blank" rel="noopener noreferrer" className="group flex items-baseline gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-hairline-soft">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-md text-ink group-hover:underline">{r.title || r.url}</span>
          <span className="block truncate text-body-sm text-mute">{[r.publication, r.author, relativeTime(r.start)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="shrink-0 text-body-sm tabular text-body">{r.seconds < 60 ? `${r.seconds}s` : `${Math.round(r.seconds / 60)} min`}</span>
        <ExternalLink className="size-3.5 shrink-0 self-center text-faint" />
      </a>
    </li>
  )
}

/** Settings → Sharing: where quotes go, and whether posting to Substack is ready here. */
export function SharingSettings() {
  const ext = useExtension()
  return (
    <div className="divide-y divide-hairline">
      <div className="flex items-start gap-3 py-3 first:pt-0">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-ink text-canvas">
          <XMark className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-body-md text-ink">X</div>
          <div className="text-body-sm text-mute">Nothing to connect: sharing opens X’s post screen with your quote and the book filled in — you press Post, as whoever is signed in to X.</div>
        </div>
      </div>
      <div className="flex items-start gap-3 py-3 last:pb-0">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#ff6719] text-white">
          <SubstackMark className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-body-md text-ink">
            Substack
            <span className={`rounded-full px-2 py-px text-[11px] font-medium ${ext.canPost ? 'bg-success/15 text-success' : 'bg-hairline-soft text-mute'}`}>
              {ext.canPost ? 'Ready' : ext.present ? 'Update the extension' : isNative ? 'Copy & paste here' : 'Needs the extension'}
            </span>
          </div>
          <div className="text-body-sm text-mute">
            {ext.canPost
              ? 'Quotes post as a Note from whoever is signed in to substack.com in this Chrome — through the I read extension. You check the Note before it goes.'
              : ext.present
                ? 'This version of the extension can’t post yet: download it again above, replace the folder, and press Reload on chrome://extensions.'
                : isNative
                  ? 'On the tablet, sharing copies the quote and opens Substack Notes to paste it. Posting it for you works in Chrome on your PC with the I read extension.'
                  : 'Install the I read extension (Substack, above) and sign in to substack.com in Chrome — then quotes post as Notes straight from here.'}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Settings: the Substack goal, the extension to download, and whether it's reporting. */
export function SubstackSettings() {
  const { substackGoalMinutes: goal } = useSettings()
  const reads = useWebReads()
  const last = reads?.[0]
  const setGoal = (m: number) => updateSettings({ substackGoalMinutes: Math.max(5, Math.min(240, m)) })
  return (
    <div>
      <div className="flex items-center gap-4">
        <button onClick={() => setGoal(goal - 5)} aria-label="Less" className="grid size-10 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft">
          <Minus className="size-4" />
        </button>
        <div className="min-w-[120px] text-center">
          <motion.span key={goal} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block text-[40px] font-semibold leading-none tracking-[-1.6px] text-ink">
            {goal}
          </motion.span>
          <span className="ml-1 text-body-md text-mute">min / day</span>
        </div>
        <button onClick={() => setGoal(goal + 5)} aria-label="More" className="grid size-10 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft">
          <Plus className="size-4" />
        </button>
      </div>

      <div className="mt-6 rounded-md border border-hairline p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-body-md text-ink">Chrome extension</div>
            <div className="text-body-sm text-mute">
              {last ? `Reporting · last read ${relativeTime(last.end)}` : 'Not reporting yet — install it, then sign in from its icon.'}
            </div>
          </div>
          {!isNative && (
            <a
              href="/i-read-substack.zip"
              download
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-hairline bg-canvas-elevated px-4 text-sm font-medium text-ink transition-colors hover:bg-hairline-soft"
            >
              <Download className="size-4" /> Download
            </a>
          )}
        </div>
        {isNative && <p className="mt-3 text-body-sm text-body">It’s for Chrome on your PC: open I read there, Settings → Substack, to download it.</p>}
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-body-sm text-body">
          <li>Download it and unzip — you get an <span className="font-medium text-ink">i-read-substack</span> folder.</li>
          <li>
            In Chrome, open <code className="rounded-[4px] bg-hairline-soft px-1 text-[12px]">chrome://extensions</code> and switch on <span className="font-medium text-ink">Developer mode</span> (top right).
          </li>
          <li>
            Click <span className="font-medium text-ink">Load unpacked</span> and choose the folder.
          </li>
          <li>Click the I read icon in Chrome’s toolbar and sign in with this account. Then just read on Substack.</li>
        </ol>
        <p className="mt-3 text-body-sm text-mute">
          It counts only while you’re actually reading — the tab in front and you scrolling or moving now and then — on substack.com and newsletters on their own domains. Offline, it keeps the time and sends it later.
        </p>
      </div>
    </div>
  )
}
