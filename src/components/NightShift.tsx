import { AnimatePresence, motion } from 'motion/react'
import { Moon, Sun } from 'lucide-react'
import { updateSettings } from '../lib/settings'
import {
  setNightShiftMode, setNightShiftNow, setNightShiftPreview, useNightShift, useNightShiftPreview, WARM_LAYER, warmLayerOpacity, type NightShiftMode,
} from '../lib/nightShift'
import { Segmented } from './ui/Segmented'

/**
 * The warm layer itself: one amber sheet over everything, blended with
 * "multiply" so whites turn warm and blues drop — cheap to draw while
 * scrolling. Fades in and out slowly, the way Night Shift does.
 */
export function NightShiftLayer() {
  const { active, warmth } = useNightShift()
  const preview = useNightShiftPreview()
  const on = active || preview
  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key="night-shift"
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[2147483646]"
          style={{ background: WARM_LAYER, mixBlendMode: 'multiply' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: warmLayerOpacity(warmth), transition: { duration: preview ? 0.15 : 1.2, ease: 'easeInOut' } }}
          exit={{ opacity: 0, transition: { duration: 0.9, ease: 'easeInOut' } }}
        />
      )}
    </AnimatePresence>
  )
}

/** Less warm ↔ More warm. Shows the tint while you drag, even if Night Shift is off. */
export function WarmthSlider() {
  const { warmth } = useNightShift()
  const end = () => setNightShiftPreview(false)
  return (
    <div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(warmth * 100)}
        aria-label="Warmth"
        className="warmth-range"
        onPointerDown={() => setNightShiftPreview(true)}
        onPointerUp={end}
        onPointerCancel={end}
        onBlur={end}
        onChange={(e) => updateSettings({ nightShiftWarmth: Number(e.target.value) / 100 })}
      />
      <div className="mt-1 flex justify-between text-body-sm text-faint">
        <span>Less warm</span>
        <span>More warm</span>
      </div>
    </div>
  )
}

const MODES: { value: NightShiftMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
  { value: 'scheduled', label: 'Scheduled' },
]

/** The full controls (Settings): mode, schedule, warmth. */
export function NightShiftSettings() {
  const ns = useNightShift()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-body-md text-ink">
            <Moon className="size-4 text-warning" /> Night Shift
          </div>
          <div className="text-body-sm text-mute">Warmer colours that are easier on your eyes at night — pages included.</div>
        </div>
        <Segmented size="sm" value={ns.mode} onChange={setNightShiftMode} ariaLabel="Night Shift" options={MODES} />
      </div>
      <AnimatePresence initial={false}>
        {ns.mode === 'scheduled' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 text-body-md text-body">
              From
              <TimeInput value={ns.from} onChange={(v) => updateSettings({ nightShiftFrom: v, nightShiftOverride: null })} label="Starts at" />
              to
              <TimeInput value={ns.to} onChange={(v) => updateSettings({ nightShiftTo: v, nightShiftOverride: null })} label="Ends at" />
              <span className="text-body-sm text-faint">{ns.active ? '· on now' : '· off now'}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <WarmthSlider />
    </div>
  )
}

/** The quick version (reader's Display panel): on/off right now, and warmth. */
export function NightShiftQuick() {
  const ns = useNightShift()
  const note =
    ns.mode === 'scheduled'
      ? ns.overrideUntil
        ? `${ns.active ? 'On' : 'Off'} until ${new Date(ns.overrideUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, then back to the schedule`
        : `Scheduled ${ns.from} – ${ns.to}`
      : 'Schedule it in Settings'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-body-md text-ink">
            {ns.active ? <Moon className="size-4 text-warning" /> : <Sun className="size-4 text-mute" />} Warm screen
          </span>
          <span className="block text-body-sm text-mute">{note}</span>
        </span>
        <button
          role="switch"
          aria-checked={ns.active}
          aria-label="Night Shift"
          onClick={() => setNightShiftNow(!ns.active)}
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 ${ns.active ? 'bg-warning' : 'bg-hairline'}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-canvas-elevated shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-[var(--ease-out-expo)] ${
              ns.active ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>
      <WarmthSlider />
    </div>
  )
}

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="time"
      value={value}
      aria-label={label}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="h-9 rounded-sm border border-hairline bg-canvas-elevated px-2 text-body-md tabular text-ink outline-none focus:border-link focus:ring-3 focus:ring-link/15"
    />
  )
}
