import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Download, HardDrive, ListPlus, MonitorSmartphone, Minus, Plus, ShieldCheck, Upload } from 'lucide-react'
import { PageContainer, PageHeader } from '../components/AppShell'
import { Button } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { useToast } from '../components/ui/Toast'
import { Toggle } from '../reader/ReaderSettings'
import { updateSettings, useSettings, type PageTheme } from '../lib/settings'
import { setTheme } from '../lib/theme'
import { exportBackup, importBackup } from '../lib/backup'
import { isStandalone, useInstallPrompt } from '../lib/install'
import { formatBytes } from '../lib/format'
import { AccountSync } from '../components/AccountSync'
import { useImporter } from '../components/Importer'
import { cloudEnabled } from '../lib/supabase'

const GOALS = [10, 15, 20, 30, 45, 60]

export default function SettingsPage() {
  const s = useSettings()
  const { toast } = useToast()
  const { available, install } = useInstallPrompt()
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { pickCsv } = useImporter()

  const refreshStorage = async () => {
    const est = await navigator.storage?.estimate?.().catch(() => null)
    const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false
    if (est) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted })
  }
  useEffect(() => {
    refreshStorage()
  }, [])

  const setGoal = (m: number) => updateSettings({ dailyGoalMinutes: Math.max(5, Math.min(240, m)) })

  return (
    <PageContainer className="max-w-[720px]">
      <PageHeader eyebrow="Preferences" title="Settings" />

      {cloudEnabled && (
        <Group title="Account & sync" desc="Sign in to keep your PC and tablet in step.">
          <AccountSync />
        </Group>
      )}

      <Group title="Daily goal" desc="A small, steady target builds the habit. Your streak counts any day with at least a minute of reading.">
        <div className="flex items-center gap-4">
          <button onClick={() => setGoal(s.dailyGoalMinutes - 5)} aria-label="Less" className="grid size-10 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft">
            <Minus className="size-4" />
          </button>
          <div className="min-w-[120px] text-center">
            <motion.span key={s.dailyGoalMinutes} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block text-[40px] font-semibold leading-none tracking-[-1.6px] text-ink">
              {s.dailyGoalMinutes}
            </motion.span>
            <span className="ml-1 text-body-md text-mute">min / day</span>
          </div>
          <button onClick={() => setGoal(s.dailyGoalMinutes + 5)} aria-label="More" className="grid size-10 place-items-center rounded-full border border-hairline text-body hover:bg-hairline-soft">
            <Plus className="size-4" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <button
              key={g}
              onClick={() => setGoal(g)}
              className={`h-8 rounded-full border px-3 text-body-sm font-medium transition-colors ${s.dailyGoalMinutes === g ? 'border-ink bg-ink text-canvas' : 'border-hairline text-body hover:bg-hairline-soft'}`}
            >
              {g} min
            </button>
          ))}
        </div>
      </Group>

      <Group title="Appearance">
        <Row label="App theme">
          <Segmented
            size="sm"
            value={s.theme}
            onChange={(t) => setTheme(t)}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Row>
        <Row label="Page colour" hint="How PDF pages look while reading">
          <Segmented<PageTheme>
            size="sm"
            value={s.pageTheme}
            onChange={(t) => updateSettings({ pageTheme: t })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'paper', label: 'Paper' },
              { value: 'sepia', label: 'Sepia' },
              { value: 'night', label: 'Night' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Reading">
        <Toggle label="Hide controls while reading" hint="Scroll up or tap the page to bring them back" checked={s.autoHideChrome} onChange={(v) => updateSettings({ autoHideChrome: v })} />
        <Toggle label="Keep screen on" hint="Stops your tablet from dimming mid-chapter" checked={s.keepAwake} onChange={(v) => updateSettings({ keepAwake: v })} />
        <Toggle label="Show session timer" hint="A small clock in the reader’s top bar" checked={s.showSessionTimer} onChange={(v) => updateSettings({ showSessionTimer: v })} />
      </Group>

      {(available || !isStandalone()) && (
        <Group title="Install" desc="Install I read to use it like a normal app — its own window, Start menu and taskbar on a PC (with “Open with I read” for PDFs), or your home screen on a tablet. Works fully offline.">
          {available ? (
            <Button onClick={async () => (await install()) && toast({ message: 'Installed', description: 'Find I read on your home screen.' })}>
              <MonitorSmartphone className="size-4" /> Install app
            </Button>
          ) : (
            <p className="text-body-md text-body">
              In Chrome on Android, open the ⋮ menu and choose <span className="font-medium text-ink">Add to Home screen → Install</span>. On a PC, use the install icon at the right of the address bar.
            </p>
          )}
        </Group>
      )}

      <Group
        title="Your data"
        desc={
          cloudEnabled
            ? 'Everything is stored on this device first, so it works offline. When you’re signed in it also syncs to your private cloud library.'
            : 'Books, highlights and reading history live only on this device — nothing is uploaded anywhere.'
        }
      >
        {storage && (
          <div className="mb-5 rounded-md border border-hairline p-4">
            <div className="flex items-center justify-between gap-3 text-body-md">
              <span className="flex items-center gap-2 text-ink">
                <HardDrive className="size-4 text-mute" /> {formatBytes(storage.usage)} used
              </span>
              <span className="text-mute">of {formatBytes(storage.quota)} available</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline">
              <motion.div
                className="h-full rounded-full bg-ink"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(1, (storage.usage / Math.max(1, storage.quota)) * 100)}%` }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-body-sm">
              <span className={`flex items-center gap-1.5 ${storage.persisted ? 'text-success' : 'text-mute'}`}>
                <ShieldCheck className="size-3.5" />
                {storage.persisted ? 'Protected from automatic cleanup' : 'The browser may clear this under low storage'}
              </span>
              {!storage.persisted && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const ok = await navigator.storage?.persist?.().catch(() => false)
                    await refreshStorage()
                    toast(ok ? { message: 'Storage protected' } : { tone: 'info', message: 'Not granted yet', description: 'Installing the app usually allows it.' })
                  }}
                >
                  Protect
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportBackup().then(() => toast({ message: 'Backup downloaded', description: 'Highlights, notes, progress and history.' }))}>
            <Download className="size-4" /> Export backup
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Restore backup
          </Button>
          <Button variant="outline" onClick={pickCsv}>
            <ListPlus className="size-4" /> Import reading list (CSV)
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const r = await importBackup(f)
                toast({
                  message: `Restored ${r.highlights} highlights, ${r.sessions} sessions`,
                  description: r.missing ? `${r.missing} book${r.missing > 1 ? 's' : ''} not in this library — add the PDF${r.missing > 1 ? 's' : ''}, then restore again.` : `Across ${r.matched} books.`,
                  duration: 7000,
                })
              } catch (err) {
                toast({ tone: 'error', message: 'Couldn’t restore that file', description: (err as Error).message })
              }
            }}
          />
        </div>
        <p className="mt-3 text-body-sm text-faint">
          Reading lists from Notion or Goodreads (CSV) become books on your list — add their PDFs later. Backups don’t include PDF files.
        </p>
      </Group>

      <p className="mt-10 text-center text-body-sm text-faint">
        I read · version {__APP_VERSION__} · made for one reader
      </p>
    </PageContainer>
  )
}

function Group({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mb-4 rounded-md border border-hairline bg-canvas-elevated p-5 sm:p-6"
    >
      <h2 className="text-heading-md text-ink">{title}</h2>
      {desc && <p className="mt-1 text-body-md text-mute">{desc}</p>}
      <div className="mt-5">{children}</div>
    </motion.section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div>
        <div className="text-body-md text-ink">{label}</div>
        {hint && <div className="text-body-sm text-mute">{hint}</div>}
      </div>
      {children}
    </div>
  )
}
