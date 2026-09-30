import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bookmark as BookmarkIcon, BookmarkPlus, ChevronRight, Copy, Highlighter, ListTree, NotebookPen, X } from 'lucide-react'
import type { Book, Bookmark, Highlight, HighlightColor, Recap } from '../db/db'
import type { Chapter } from '../lib/recaps'
import type { OutlineItem } from '../lib/pdf'
import { Sheet } from '../components/ui/Sheet'
import { Segmented } from '../components/ui/Segmented'
import { Button } from '../components/ui/Button'
import { relativeTime, pluralize } from '../lib/format'
import { HL_COLORS, swatchOf } from './HighlightTools'

export type SidebarTab = 'contents' | 'highlights' | 'bookmarks'

interface Props {
  open: boolean
  onClose: () => void
  tab: SidebarTab
  onTab: (t: SidebarTab) => void
  book: Book
  outline: OutlineItem[]
  chapterTitle?: string
  currentPage: number
  highlights: Highlight[]
  bookmarks: Bookmark[]
  onJump: (page: number) => void
  onJumpHighlight: (h: Highlight) => void
  onToggleBookmark: () => void
  onDeleteBookmark: (b: Bookmark) => void
  onCopyAll: () => void
  chapterFor: (page: number) => string | undefined
  chapters: Chapter[]
  recaps: Recap[]
  /** What "Recap" in Contents writes about right now. */
  recapTarget: Chapter | null
  onRecap: (c: Chapter) => void
}

export function ReaderSidebar(p: Props) {
  return (
    <Sheet open={p.open} onClose={p.onClose} side="left" width={380} flush title={p.book.title} description={p.book.author || pluralize(p.book.pageCount, 'page')}>
      <div className="sticky top-0 z-10 border-b border-hairline bg-canvas-elevated px-4 py-3">
        <Segmented
          stretch
          value={p.tab}
          onChange={p.onTab}
          options={[
            { value: 'contents', label: <><ListTree className="size-3.5" /> Contents</> },
            { value: 'highlights', label: <><Highlighter className="size-3.5" /> Notes <span className="tabular text-faint">{p.highlights.length}</span></> },
            { value: 'bookmarks', label: <><BookmarkIcon className="size-3.5" /> Marks <span className="tabular text-faint">{p.bookmarks.length}</span></> },
          ]}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={p.tab}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18 }}
          className="px-2 py-3"
        >
          {p.tab === 'contents' && <Contents {...p} />}
          {p.tab === 'highlights' && <Highlights {...p} />}
          {p.tab === 'bookmarks' && <Bookmarks {...p} />}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  )
}

function RecapButton({ target, recaps, onRecap }: Pick<Props, 'recaps' | 'onRecap'> & { target: Chapter | null }) {
  if (!target) return null
  const r = recaps.find((x) => x.start === target.start)
  return (
    <div className="px-2 pb-2">
      <Button variant="outline" className="w-full min-w-0 justify-start" onClick={() => onRecap(target)} title="Recap (R)">
        <NotebookPen className="size-4 shrink-0 text-link" />
        <span className="shrink-0">{r?.state === 'done' ? 'Your recap:' : 'Recap:'}</span>
        <span className="min-w-0 truncate font-normal text-body">{target.title}</span>
      </Button>
    </div>
  )
}

const cleanTitle = (t: string) => t.replace(/\s+/g, ' ').trim()

function Contents({ outline, currentPage, onJump, chapterTitle, book, chapters, recaps, recapTarget, onRecap }: Props) {
  if (!outline.length)
    return (
      <Empty icon={<ListTree className="size-5" />} title="No table of contents" body="This PDF doesn't include chapter bookmarks. Use the page scrubber or search to get around.">
        <div className="-mx-2 mt-5 text-left">
          <RecapButton target={recapTarget} recaps={recaps} onRecap={onRecap} />
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5 px-2">
          {Array.from({ length: Math.min(book.pageCount, 60) }, (_, i) => {
            const page = Math.round((i / Math.max(1, Math.min(book.pageCount, 60) - 1)) * (book.pageCount - 1))
            return (
              <button
                key={i}
                onClick={() => onJump(page)}
                className={`h-8 rounded-sm text-body-sm tabular transition-colors ${
                  Math.abs(page - currentPage) < book.pageCount / 120 + 0.5 ? 'bg-ink text-canvas' : 'bg-hairline-soft text-body hover:bg-hairline'
                }`}
              >
                {page + 1}
              </button>
            )
          })}
        </div>
      </Empty>
    )
  // Chapters (as recaps see them) matched by where they start and their title.
  const recapOf: RecapOf = (it) => {
    const c = it.page != null ? chapters.find((ch) => ch.start === it.page && ch.title === cleanTitle(it.title)) : undefined
    if (!c) return undefined
    const r = recaps.find((x) => x.start === c.start)
    return r && r.state !== 'skipped' ? { recap: r, open: () => onRecap(c) } : undefined
  }
  return (
    <>
      <RecapButton target={recapTarget} recaps={recaps} onRecap={onRecap} />
      <ul>
        {outline.map((it, i) => (
          <OutlineNode key={i} item={it} depth={0} currentPage={currentPage} onJump={onJump} chapterTitle={chapterTitle} recapOf={recapOf} />
        ))}
      </ul>
    </>
  )
}

type RecapOf = (it: OutlineItem) => { recap: Recap; open: () => void } | undefined

function OutlineNode({
  item, depth, currentPage, onJump, chapterTitle, recapOf,
}: {
  item: OutlineItem
  depth: number
  currentPage: number
  onJump: (p: number) => void
  chapterTitle?: string
  recapOf: RecapOf
}) {
  const containsCurrent = useMemo(() => {
    const walk = (it: OutlineItem): boolean => it.title === chapterTitle || it.items.some(walk)
    return item.items.some(walk)
  }, [item, chapterTitle])
  const [open, setOpen] = useState(containsCurrent || depth === 0 && item.items.length > 0 && item.items.length < 6)
  const active = item.title === chapterTitle
  const rc = recapOf(item)
  return (
    <li>
      <div
        className={`group flex items-center rounded-sm transition-colors ${active ? 'bg-hairline-soft' : 'hover:bg-hairline-soft/70'}`}
        style={{ paddingLeft: depth * 14 }}
      >
        {item.items.length ? (
          <button onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'} className="grid size-8 shrink-0 place-items-center text-faint hover:text-ink">
            <ChevronRight className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="w-8 shrink-0" />
        )}
        <button
          disabled={item.page == null}
          onClick={() => item.page != null && onJump(item.page)}
          className="flex min-w-0 flex-1 items-baseline gap-3 py-2 pr-3 text-left"
        >
          <span className={`min-w-0 flex-1 text-body-md ${active ? 'font-medium text-ink' : depth === 0 ? 'text-ink' : 'text-body'}`}>
            {active && <motion.span layoutId="toc-dot" className="mr-2 inline-block size-1.5 -translate-y-0.5 rounded-full bg-link" />}
            {item.title}
          </span>
          {item.page != null && <span className="shrink-0 text-body-sm tabular text-faint">{item.page + 1}</span>}
        </button>
        {rc && (
          <button
            onClick={rc.open}
            aria-label={rc.recap.state === 'done' ? 'Your recap' : 'Recap waiting'}
            title={rc.recap.state === 'done' ? 'Your recap' : 'Recap waiting'}
            className="-ml-2 mr-1 grid size-8 shrink-0 place-items-center rounded-full hover:bg-hairline"
          >
            {rc.recap.state === 'done' ? <NotebookPen className="size-3.5 text-link" /> : <span className="size-2 rounded-full bg-warning" />}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && item.items.length > 0 && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {item.items.map((c, i) => (
              <OutlineNode key={i} item={c} depth={depth + 1} currentPage={currentPage} onJump={onJump} chapterTitle={chapterTitle} recapOf={recapOf} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  )
}

function Highlights({ highlights, onJumpHighlight, onCopyAll }: Props) {
  const [color, setColor] = useState<HighlightColor | 'all'>('all')
  const list = highlights.filter((h) => color === 'all' || h.color === color).sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1])
  if (!highlights.length)
    return <Empty icon={<Highlighter className="size-5" />} title="No highlights yet" body="Select any text on a page and pick a colour. Add a note to remember why it mattered." />
  return (
    <div>
      <div className="mb-2 flex items-center gap-1 px-2">
        <button
          onClick={() => setColor('all')}
          className={`h-7 rounded-full px-2.5 text-body-sm font-medium transition-colors ${color === 'all' ? 'bg-ink text-canvas' : 'text-body hover:bg-hairline-soft'}`}
        >
          All
        </button>
        {HL_COLORS.filter((c) => highlights.some((h) => h.color === c.key)).map((c) => (
          <button
            key={c.key}
            aria-label={`Only ${c.label}`}
            onClick={() => setColor(c.key)}
            className={`grid size-7 place-items-center rounded-full transition-colors ${color === c.key ? 'bg-hairline' : 'hover:bg-hairline-soft'}`}
          >
            <span className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: c.swatch }} />
          </button>
        ))}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onCopyAll}>
          <Copy className="size-3.5" /> Copy all
        </Button>
      </div>
      <ul className="space-y-0.5">
        <AnimatePresence initial={false}>
          {list.map((h) => (
            <motion.li key={h.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
              <button onClick={() => onJumpHighlight(h)} className="flex w-full gap-3 rounded-sm px-2 py-2.5 text-left transition-colors hover:bg-hairline-soft">
                <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ background: swatchOf(h.color) }} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-4 text-body-md text-ink">{h.text}</span>
                  {h.note && <span className="mt-1.5 block rounded-sm bg-hairline-soft px-2 py-1.5 text-body-sm text-body">{h.note}</span>}
                  <span className="mt-1.5 block text-body-sm text-faint">
                    Page {h.page + 1} · {relativeTime(h.createdAt)}
                  </span>
                </span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

function Bookmarks({ bookmarks, currentPage, onJump, onToggleBookmark, onDeleteBookmark, chapterFor }: Props) {
  const here = bookmarks.some((b) => b.page === currentPage)
  return (
    <div>
      <div className="px-2 pb-2">
        <Button variant="outline" className="w-full" onClick={onToggleBookmark}>
          <BookmarkPlus className="size-4" />
          {here ? `Remove bookmark on page ${currentPage + 1}` : `Bookmark page ${currentPage + 1}`}
        </Button>
      </div>
      {!bookmarks.length ? (
        <Empty icon={<BookmarkIcon className="size-5" />} title="No bookmarks" body="Bookmark pages you want to come back to. Press B while reading." />
      ) : (
        <ul>
          <AnimatePresence initial={false}>
            {[...bookmarks]
              .sort((a, b) => a.page - b.page)
              .map((b) => (
                <motion.li key={b.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="group flex items-center rounded-sm hover:bg-hairline-soft">
                  <button onClick={() => onJump(b.page)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5 text-left">
                    <BookmarkIcon className="size-4 shrink-0 fill-link text-link" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-md text-ink">Page {b.page + 1}</span>
                      <span className="block truncate text-body-sm text-faint">{chapterFor(b.page) ?? relativeTime(b.createdAt)}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => onDeleteBookmark(b)}
                    aria-label="Remove bookmark"
                    className="mr-1 grid size-8 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:text-error group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                  >
                    <X className="size-4" />
                  </button>
                </motion.li>
              ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

function Empty({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-hairline-soft text-mute">{icon}</div>
      <p className="mt-4 text-label-sm text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-body-md text-mute">{body}</p>
      {children}
    </div>
  )
}
