import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { DocText, Match } from './textIndex'
import { snippet } from './textIndex'

interface Props {
  query: string
  onQuery: (q: string) => void
  matches: Match[]
  current: number
  scanned: number
  total: number
  onGo: (n: number) => void
  onClose: () => void
  text: DocText
  chapterFor: (page: number) => string | undefined
}

export function SearchPanel({ query, onQuery, matches, current, scanned, total, onGo, onClose, text, chapterFor }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [showList, setShowList] = useState(true)
  const searching = !!query.trim() && scanned < total
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  useEffect(() => setShowList(true), [query])

  // Keep the active result visible in the list.
  useEffect(() => {
    listRef.current?.querySelector(`[data-n="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const step = (d: 1 | -1) => matches.length && onGo((current + d + matches.length) % matches.length)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 36 }}
      className="pointer-events-auto absolute right-2 top-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+60px)] z-50 flex max-h-[min(560px,calc(100dvh-160px))] w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-hairline bg-canvas-elevated shadow-floating sm:right-4 sm:w-[400px]"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 pl-3 pr-1.5">
        <Search className="size-4 shrink-0 text-faint" />
        <input
          ref={input}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              step(e.shiftKey ? -1 : 1)
              setShowList(false)
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              onClose()
            }
          }}
          placeholder="Search in book"
          enterKeyHint="search"
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-body-md text-ink outline-none placeholder:text-faint"
        />
        {query && (
          <span className="shrink-0 px-1 text-body-sm tabular text-mute">
            {matches.length ? `${current + 1} / ${matches.length}${searching ? '+' : ''}` : searching ? '…' : '0'}
          </span>
        )}
        <NavBtn label="Previous result (Shift+Enter)" onClick={() => step(-1)} disabled={!matches.length}>
          <ChevronUp className="size-4" />
        </NavBtn>
        <NavBtn label="Next result (Enter)" onClick={() => step(1)} disabled={!matches.length}>
          <ChevronDown className="size-4" />
        </NavBtn>
        <NavBtn label="Close search (Esc)" onClick={onClose}>
          <X className="size-4" />
        </NavBtn>
      </div>
      {searching && (
        <div className="h-px shrink-0 bg-hairline">
          <motion.div className="h-px bg-link" animate={{ width: `${(scanned / Math.max(1, total)) * 100}%` }} transition={{ ease: 'linear', duration: 0.2 }} />
        </div>
      )}
      {query.trim() && showList && (
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto border-t border-hairline py-1">
          {!matches.length && !searching && (
            <div className="px-4 py-8 text-center">
              <p className="text-label-sm text-ink">No results for “{query.trim()}”</p>
              <p className="mt-1 text-body-sm text-mute">Scanned PDFs without a text layer can't be searched.</p>
            </div>
          )}
          {matches.slice(0, 500).map((m) => {
            const idx = text.peekIndex(m.page)
            const s = idx ? snippet(idx, m.start, m.end) : null
            const chapter = chapterFor(m.page)
            return (
              <button
                key={m.n}
                data-n={m.n}
                onClick={() => {
                  onGo(m.n)
                  if (window.matchMedia('(max-width: 639px)').matches) setShowList(false)
                }}
                className={`block w-full px-4 py-2.5 text-left transition-colors ${m.n === current ? 'bg-hairline-soft' : 'hover:bg-hairline-soft/60'}`}
              >
                <div className="mb-0.5 flex items-baseline gap-2 text-body-sm text-faint">
                  <span className="tabular">Page {m.page + 1}</span>
                  {chapter && <span className="truncate">· {chapter}</span>}
                </div>
                {s && (
                  <div className="line-clamp-2 text-body-md text-body">
                    {s.before}
                    <mark className="rounded-[3px] bg-[rgb(255_170_0/0.3)] px-0.5 text-ink">{s.match}</mark>
                    {s.after}
                  </div>
                )}
              </button>
            )
          })}
          {matches.length > 500 && <p className="px-4 py-3 text-body-sm text-faint">Showing the first 500 of {matches.length} results.</p>}
        </div>
      )}
    </motion.div>
  )
}

function NavBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 shrink-0 place-items-center rounded-full text-body transition-colors hover:bg-hairline-soft hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}
