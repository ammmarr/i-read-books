import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, StickyNote, Trash2 } from 'lucide-react'
import type { Highlight, HighlightColor } from '../db/db'

export const HL_COLORS: { key: HighlightColor; swatch: string; label: string }[] = [
  { key: 'yellow', swatch: '#fcd34d', label: 'Yellow' },
  { key: 'green', swatch: '#6ee7a0', label: 'Green' },
  { key: 'blue', swatch: '#7cb8ff', label: 'Blue' },
  { key: 'pink', swatch: '#f99ac8', label: 'Pink' },
  { key: 'purple', swatch: '#b9a4fb', label: 'Purple' },
]

export const swatchOf = (c: HighlightColor) => HL_COLORS.find((x) => x.key === c)!.swatch

interface Anchor {
  rect: DOMRect
  /** Prefer placing below (touch devices, where the OS menu sits above a selection). */
  below?: boolean
}

function usePlacement(anchor: Anchor | null, size: { w: number; h: number }) {
  const [pos, setPos] = useState({ x: 0, y: 0, below: false })
  useLayoutEffect(() => {
    if (!anchor) return
    const { rect } = anchor
    const gap = 10
    let below = !!anchor.below
    if (!below && rect.top - size.h - gap < 64) below = true
    if (below && rect.bottom + size.h + gap > window.innerHeight - 72) below = false
    const x = Math.max(8, Math.min(rect.left + rect.width / 2 - size.w / 2, window.innerWidth - size.w - 8))
    const y = below ? rect.bottom + gap + (anchor.below ? 28 : 0) : rect.top - size.h - gap
    setPos({ x, y: Math.max(8, Math.min(y, window.innerHeight - size.h - 8)), below })
  }, [anchor, size.w, size.h])
  return pos
}

function Swatches({ value, onPick }: { value?: HighlightColor; onPick: (c: HighlightColor) => void }) {
  return (
    <div className="flex items-center gap-1">
      {HL_COLORS.map((c, i) => (
        <motion.button
          key={c.key}
          aria-label={`Highlight ${c.label.toLowerCase()}`}
          title={`${c.label} (${i + 1})`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(c.key)}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.02 * i, type: 'spring', stiffness: 600, damping: 24 }}
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.88 }}
          className="relative grid size-8 place-items-center rounded-full"
        >
          <span className="size-5 rounded-full ring-1 ring-black/10" style={{ background: c.swatch }} />
          {value === c.key && <Check className="absolute size-3 text-black/70" strokeWidth={3} />}
        </motion.button>
      ))}
    </div>
  )
}

export function SelectionToolbar({
  anchor, onHighlight, onNote, onCopy,
}: {
  anchor: Anchor | null
  onHighlight: (c: HighlightColor) => void
  onNote: () => void
  onCopy: () => void
}) {
  const pos = usePlacement(anchor, { w: 300, h: 44 })
  return createPortal(
    <AnimatePresence>
      {anchor && (
        <motion.div
          key="sel"
          role="toolbar"
          aria-label="Highlight selection"
          initial={{ opacity: 0, scale: 0.9, y: pos.below ? -6 : 6 }}
          animate={{ opacity: 1, scale: 1, y: 0, left: pos.x, top: pos.y }}
          exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={{ left: pos.x, top: pos.y }}
          className="fixed z-[70] flex h-11 items-center gap-0.5 rounded-full border border-hairline bg-canvas-elevated px-1.5 shadow-floating"
          onPointerDown={(e) => e.preventDefault()}
        >
          <Swatches onPick={onHighlight} />
          <span className="mx-1 h-5 w-px bg-hairline" />
          <ToolBtn label="Highlight with note" onClick={onNote}>
            <StickyNote className="size-4" />
          </ToolBtn>
          <ToolBtn label="Copy" onClick={onCopy}>
            <Copy className="size-4" />
          </ToolBtn>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function ToolBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-full transition-colors ${danger ? 'text-error hover:bg-error/10' : 'text-body hover:bg-hairline-soft hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

export function HighlightPopover({
  highlight, anchor, focusNote, onClose, onColor, onNote, onDelete, onCopy,
}: {
  highlight: Highlight | null
  anchor: Anchor | null
  focusNote?: boolean
  onClose: () => void
  onColor: (c: HighlightColor) => void
  onNote: (note: string) => void
  onDelete: () => void
  onCopy: () => void
}) {
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const pos = usePlacement(anchor, { w: 320, h: editing || highlight?.note ? 188 : 52 })

  useEffect(() => {
    setNote(highlight?.note ?? '')
    setEditing(!!focusNote || !!highlight?.note)
  }, [highlight?.id, focusNote]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!highlight) return
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [highlight, onClose])

  // Autosave the note as you type (debounced) — no save button to forget.
  useEffect(() => {
    if (!highlight || note === (highlight.note ?? '')) return
    const t = setTimeout(() => onNote(note), 400)
    return () => clearTimeout(t)
  }, [note]) // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <AnimatePresence>
      {highlight && anchor && (
        <motion.div
          ref={panel}
          key={highlight.id}
          initial={{ opacity: 0, scale: 0.92, y: pos.below ? -6 : 6 }}
          animate={{ opacity: 1, scale: 1, y: 0, left: pos.x, top: pos.y }}
          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          style={{ left: pos.x, top: pos.y }}
          className="fixed z-[70] w-[320px] max-w-[calc(100vw-16px)] overflow-hidden rounded-md border border-hairline bg-canvas-elevated shadow-floating"
        >
          <div className="flex h-[50px] items-center gap-0.5 px-1.5">
            <Swatches value={highlight.color} onPick={onColor} />
            <span className="mx-1 h-5 w-px bg-hairline" />
            <ToolBtn label={editing ? 'Hide note' : 'Add note'} onClick={() => setEditing((v) => !v)}>
              <StickyNote className={`size-4 ${highlight.note ? 'fill-link/20 text-link' : ''}`} />
            </ToolBtn>
            <ToolBtn label="Copy text" onClick={onCopy}>
              <Copy className="size-4" />
            </ToolBtn>
            <ToolBtn label="Delete highlight" onClick={onDelete} danger>
              <Trash2 className="size-4" />
            </ToolBtn>
          </div>
          <AnimatePresence initial={false}>
            {editing && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="border-t border-hairline"
              >
                <textarea
                  autoFocus={!!focusNote || !highlight.note}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => note !== (highlight.note ?? '') && onNote(note)}
                  placeholder="Write a thought…"
                  rows={4}
                  className="block w-full resize-none bg-transparent px-3.5 py-3 text-body-md text-ink outline-none placeholder:text-faint"
                />
                <div className="flex items-center justify-between px-3.5 pb-2.5 text-body-sm text-faint">
                  <span>Saved automatically</span>
                  <span className="tabular">{note.length ? `${note.length} chars` : ''}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
