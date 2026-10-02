import { Minus, Plus } from 'lucide-react'
import { Sheet } from '../components/ui/Sheet'
import { Segmented } from '../components/ui/Segmented'
import { updateSettings, useSettings, type PageTheme, type ZoomMode } from '../lib/settings'
import { setTheme, useIsDark } from '../lib/theme'
import { NightShiftQuick } from '../components/NightShift'

interface Props {
  open: boolean
  onClose: () => void
  zoomMode: ZoomMode
  zoomPercent: number
  onZoomMode: (m: Exclude<ZoomMode, 'custom'>) => void
  onZoomStep: (dir: 1 | -1) => void
}

const THEMES: { key: PageTheme; label: string; paper: string; ink: string }[] = [
  { key: 'auto', label: 'Auto', paper: 'linear-gradient(135deg,#fff 50%,#1b1b1b 50%)', ink: '#888' },
  { key: 'paper', label: 'Paper', paper: '#ffffff', ink: '#171717' },
  { key: 'sepia', label: 'Sepia', paper: '#f4ecd8', ink: '#5b4636' },
  { key: 'night', label: 'Night', paper: '#1b1b1b', ink: '#d6d6d6' },
]

export function ReaderSettings({ open, onClose, zoomMode, zoomPercent, onZoomMode, onZoomStep }: Props) {
  const s = useSettings()
  const dark = useIsDark()
  return (
    <Sheet open={open} onClose={onClose} side="right" width={360} title="Display">
      <Section label="Page">
        <div className="grid grid-cols-4 gap-2">
          {THEMES.map((t) => {
            const active = s.pageTheme === t.key
            return (
              <button key={t.key} onClick={() => updateSettings({ pageTheme: t.key })} className="group flex flex-col items-center gap-2">
                <span
                  className={`grid h-14 w-full place-items-center rounded-sm border text-[15px] font-semibold transition-all duration-200 ${
                    active ? 'border-ink ring-2 ring-ink/10' : 'border-hairline group-hover:border-faint'
                  }`}
                  style={{ background: t.paper, color: t.ink }}
                >
                  Aa
                </span>
                <span className={`text-body-sm ${active ? 'font-medium text-ink' : 'text-mute'}`}>{t.label}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section label="Night Shift">
        <NightShiftQuick />
      </Section>

      <Section label="Zoom">
        <div className="flex items-center gap-2">
          <button onClick={() => onZoomStep(-1)} aria-label="Zoom out" className="grid size-9 place-items-center rounded-sm border border-hairline text-body hover:bg-hairline-soft">
            <Minus className="size-4" />
          </button>
          <div className="flex-1 text-center text-label-sm tabular text-ink">{zoomPercent}%</div>
          <button onClick={() => onZoomStep(1)} aria-label="Zoom in" className="grid size-9 place-items-center rounded-sm border border-hairline text-body hover:bg-hairline-soft">
            <Plus className="size-4" />
          </button>
        </div>
        <Segmented
          stretch
          className="mt-3"
          value={zoomMode === 'custom' ? ('none' as never) : zoomMode}
          onChange={onZoomMode}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'width', label: 'Fit width' },
            { value: 'page', label: 'Fit page' },
          ]}
        />
        <p className="mt-2 text-body-sm text-faint">Pinch or Ctrl + scroll to zoom. Double-tap to zoom in on a spot.</p>
      </Section>

      <Section label="App theme">
        <Segmented
          stretch
          value={s.theme}
          onChange={(t) => setTheme(t)}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
        {s.pageTheme === 'auto' && <p className="mt-2 text-body-sm text-faint">Pages follow the app: {dark ? 'night' : 'paper'} right now.</p>}
      </Section>

      <Section label="Reading">
        <Toggle label="Hide controls while reading" hint="Scroll up or tap to bring them back" checked={s.autoHideChrome} onChange={(v) => updateSettings({ autoHideChrome: v })} />
        <Toggle label="Keep screen on" hint="Stops the tablet from dimming mid-chapter" checked={s.keepAwake} onChange={(v) => updateSettings({ keepAwake: v })} />
        <Toggle label="Show session timer" checked={s.showSessionTimer} onChange={(v) => updateSettings({ showSessionTimer: v })} />
      </Section>
    </Sheet>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline py-5 first:border-t-0 first:pt-1">
      <h3 className="mb-3 text-mono-eyebrow text-mute">{label}</h3>
      {children}
    </section>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-4 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-body-md text-ink">{label}</span>
        {hint && <span className="block text-body-sm text-mute">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-ink' : 'bg-hairline'}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-canvas-elevated shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-[var(--ease-out-expo)] ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </label>
  )
}
