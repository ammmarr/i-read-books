import { useState } from 'react'
import type { Book } from '../db/db'
import { useObjectUrl } from '../lib/hooks'

interface Props {
  book: Pick<Book, 'cover' | 'title' | 'author' | 'tint' | 'pageSizes'> & Partial<Pick<Book, 'coverUrl'>>
  className?: string
  /** Fixed width in px; otherwise fills its container width. */
  width?: number
  rounded?: string
}

/**
 * A book cover rendered from page 1. A soft spine highlight and inner shadow on
 * the left edge make a flat PDF render read as a physical object.
 */
export function BookCover({ book, className = '', width, rounded = 'rounded-[4px]' }: Props) {
  const blobUrl = useObjectUrl(book.cover)
  const url = blobUrl ?? book.coverUrl
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const paper = PAPERS[hash(book.title) % PAPERS.length]
  const first = book.pageSizes?.[0]
  const ratio = first ? Math.min(1.6, Math.max(1.05, first.h / first.w)) : 1.5

  return (
    <div
      className={`relative overflow-hidden bg-hairline-soft ${rounded} ${className}`}
      style={{ aspectRatio: `1 / ${ratio}`, width, backgroundColor: url && !failed ? book.tint : paper.bg }}
    >
      {(!url || failed || !loaded) && (
        // Typeset cover — shown for list books without artwork, and while art loads.
        <div className="absolute inset-0 flex flex-col p-[9%] @container" style={{ background: paper.bg, color: paper.ink }}>
          <span className="mb-[8%] h-px w-1/3 opacity-40" style={{ background: paper.ink }} />
          <span className="line-clamp-5 text-[clamp(10px,13cqw,17px)] font-semibold leading-[1.15] tracking-tight">{book.title}</span>
          <span className="mt-auto line-clamp-2 text-[clamp(8px,8cqw,12px)] opacity-70">{book.author}</span>
        </div>
      )}
      {url && !failed && (
        <img
          src={url}
          alt=""
          draggable={false}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {/* spine + page-edge lighting */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.16)_0%,rgba(255,255,255,0.18)_2.5%,rgba(0,0,0,0.06)_5%,transparent_9%,transparent_94%,rgba(0,0,0,0.06)_100%)]" />
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/[0.06]" />
    </div>
  )
}

/** Muted cloth-bound colours for typeset covers, picked deterministically per title. */
const PAPERS = [
  { bg: '#e9e4d8', ink: '#2b2a26' },
  { bg: '#d9e2e8', ink: '#1f2a33' },
  { bg: '#2f3a36', ink: '#e8eee9' },
  { bg: '#e7d9d3', ink: '#3a2622' },
  { bg: '#232323', ink: '#ededed' },
  { bg: '#dfe5d7', ink: '#26301f' },
  { bg: '#3a3450', ink: '#ece8f7' },
  { bg: '#efe7cf', ink: '#3b3218' },
]

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
