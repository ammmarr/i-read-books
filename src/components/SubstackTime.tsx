import { BookOpen, Download, Minus, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { goalsOf, updateSettings, useSettings } from '../lib/settings'
import { useWebReads } from '../lib/web'
import { relativeTime } from '../lib/format'
import { isNative } from '../lib/native'
import { useExtension } from '../lib/share'
import { SubstackMark, XMark } from './ShareQuote'

/**
 * Settings → Daily goals: books and Substack each have a goal; the overall
 * goal is simply the two together.
 */
export function DailyGoals() {
  const s = useSettings()
  const g = goalsOf(s)
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <motion.span key={g.overall} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block text-[40px] font-semibold leading-none tracking-[-1.6px] text-ink">
          {g.overall}
        </motion.span>
        <span className="text-body-md text-mute">min a day overall</span>
      </div>
      <p className="mt-1 text-body-sm text-mute">Books and Substack together — set each below.</p>
      <div className="mt-5 divide-y divide-hairline rounded-md border border-hairline">
        <GoalRow
          icon={<BookOpen className="size-4" />}
          tone="var(--color-link)"
          label="Books"
          value={g.books}
          min={5}
          onChange={(m) => updateSettings({ dailyGoalMinutes: m })}
        />
        <GoalRow
          icon={<SubstackMark className="size-3.5" />}
          tone="var(--color-substack)"
          label="Substack"
          hint={g.substack === 0 ? 'No Substack goal' : undefined}
          value={g.substack}
          min={0}
          onChange={(m) => updateSettings({ substackGoalMinutes: m })}
        />
      </div>
    </div>
  )
}

function GoalRow({ icon, tone, label, hint, value, min, onChange }: { icon: React.ReactNode; tone: string; label: string; hint?: string; value: number; min: number; onChange: (m: number) => void }) {
  const set = (m: number) => onChange(Math.max(min, Math.min(240, m)))
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full text-white" style={{ background: tone }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body-md text-ink">{label}</div>
        {hint && <div className="text-body-sm text-mute">{hint}</div>}
      </div>
      <button onClick={() => set(value - 5)} disabled={value <= min} aria-label={`Less ${label.toLowerCase()}`} className="grid size-8 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft disabled:opacity-40">
        <Minus className="size-3.5" />
      </button>
      <div className="w-[72px] text-center">
        <span className="text-heading-md tabular text-ink">{value}</span>
        <span className="ml-1 text-body-sm text-mute">min</span>
      </div>
      <button onClick={() => set(value + 5)} aria-label={`More ${label.toLowerCase()}`} className="grid size-8 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft">
        <Plus className="size-3.5" />
      </button>
    </div>
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

/** Settings → Substack: the extension to download, and whether it's reporting. */
export function SubstackSettings() {
  const reads = useWebReads()
  const last = reads?.[0]
  return (
    <div>
      <div className="rounded-md border border-hairline p-4">
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
