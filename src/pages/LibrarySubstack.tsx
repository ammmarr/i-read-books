import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownUp, ExternalLink, Search, Trash2, X } from 'lucide-react'
import { db, type WebRead } from '../db/db'
import { Button } from '../components/ui/Button'
import { Menu } from '../components/ui/Menu'
import { useToast } from '../components/ui/Toast'
import { SubstackMark } from '../components/ShareQuote'
import { articlesOf, monogram, newslettersOf, type Article } from '../lib/web'
import { formatDuration, formatDurationLong, pluralize, relativeTime } from '../lib/format'
import { startOfDay } from '../lib/stats'
import { useIsDark } from '../lib/theme'
import { useIsTouch } from '../lib/hooks'

/**
 * The Substack side of the Library: what you've read there (counted by the
 * I read Chrome extension), shelved like your books — newsletters as covers,
 * articles by day.
 */

type Sort = 'recent' | 'time' | 'title'
const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Recently read' },
  { key: 'time', label: 'Most time' },
  { key: 'title', label: 'Title' },
]

/** A newsletter's cover: its initials on a colour of its own. */
export function Monogram({ name, className = '', size = 'md' }: { name: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const dark = useIsDark()
  const m = monogram(name)
  const text = size === 'lg' ? 'text-[34px] tracking-[-1.2px]' : size === 'md' ? 'text-[22px] tracking-[-0.6px]' : 'text-[13px]'
  return (
    <div
      aria-hidden
      className={`relative grid aspect-square place-items-center overflow-hidden rounded-[6px] font-semibold ${text} ${className}`}
      style={{ background: dark ? m.bgDark : m.bg, color: dark ? m.inkDark : m.ink }}
    >
      {m.letters}
      {size !== 'sm' && (
        <SubstackMark className="absolute bottom-[8%] right-[8%] size-[16%] opacity-40" />
      )}
    </div>
  )
}

/** The hero: the article you were last reading, to pick up again. */
export function SubstackContinueCard({ reads, onPick }: { reads: WebRead[]; onPick: (publication: string) => void }) {
  const latest = useMemo(() => articlesOf(reads)[0], [reads])
  if (!latest) return <SubstackEmpty />
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex gap-5 overflow-hidden rounded-md border border-hairline bg-canvas-elevated p-4 sm:gap-6 sm:p-6"
    >
      <div className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full opacity-[0.12] blur-3xl" style={{ background: 'var(--color-substack)' }} />
      <a href={latest.url} target="_blank" rel="noopener noreferrer" className="relative w-[84px] shrink-0 self-start sm:w-[112px]" aria-label={`Continue ${latest.title}`}>
        <motion.div whileHover={{ rotate: -1.5, y: -3 }} whileTap={{ scale: 0.97 }} className="shadow-cover-lift rounded-[6px]">
          <Monogram name={latest.publication} size="lg" />
        </motion.div>
      </a>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="text-mono-eyebrow text-mute">Continue reading</div>
        <h2 className="mt-2 line-clamp-2 text-heading-md text-ink">{latest.title}</h2>
        <p className="mt-0.5 truncate text-body-md text-body">{[latest.publication, latest.author].filter(Boolean).join(' · ')}</p>
        <div className="mt-auto pt-4">
          <p className="text-body-sm text-mute">
            <span className="font-medium text-ink">{formatDurationLong(latest.seconds)}</span> read
            {latest.days > 1 ? ` over ${latest.days} days` : ''} · last opened {relativeTime(latest.last)}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={latest.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-canvas transition-colors hover:bg-ink/85"
            >
              <ExternalLink className="size-4" /> Continue reading
            </a>
            <Button variant="ghost" onClick={() => onPick(latest.publication)} className="hidden sm:inline-flex">
              More from {latest.publication.length > 22 ? 'this newsletter' : latest.publication}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/** Nothing from Substack yet: how it gets here. */
function SubstackEmpty() {
  return (
    <div className="relative flex items-center gap-5 overflow-hidden rounded-md border border-dashed border-hairline bg-canvas-elevated p-6">
      <span className="grid size-14 shrink-0 place-items-center rounded-[10px] text-white" style={{ background: 'var(--color-substack)' }}>
        <SubstackMark className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="text-heading-md text-ink">Your Substack reading lands here</p>
        <p className="mt-1 text-body-md text-body">
          The I read extension for Chrome counts the time you actively read on Substack and shelves each article here.{' '}
          <Link to="/settings" className="text-link hover:underline">
            Set it up in Settings
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

/** Below the hero: newsletters as a shelf, then every article by day. */
export function SubstackShelf({ reads, pub, setPub }: { reads: WebRead[]; pub: string | null; setPub: (p: string | null) => void }) {
  const touch = useIsTouch()
  const { toast } = useToast()
  const articles = useMemo(() => articlesOf(reads), [reads])
  const letters = useMemo(() => newslettersOf(articles), [articles])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>(() => {
    try {
      return (localStorage.getItem('irb-substack-sort') as Sort) || 'recent'
    } catch {
      return 'recent'
    }
  })

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = articles.filter(
      (a) => (!pub || a.publication === pub) && (!q || a.title.toLowerCase().includes(q) || a.publication.toLowerCase().includes(q) || a.author?.toLowerCase().includes(q)),
    )
    if (sort === 'time') return [...list].sort((a, b) => b.seconds - a.seconds)
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [articles, pub, query, sort])

  const groups = useMemo(() => (sort === 'recent' ? groupByDay(shown) : [{ label: '', items: shown }]), [shown, sort])

  const remove = async (a: Article) => {
    const rows = reads.filter((r) => r.url === a.url)
    await db.webReads.bulkDelete(rows.map((r) => r.id))
    toast({ message: 'Removed from your reading', description: a.title, action: { label: 'Undo', onClick: () => void db.webReads.bulkPut(rows) } })
  }

  if (!articles.length) return null
  return (
    <>
      {/* ── Newsletters ── */}
      <div className="mt-10 flex flex-wrap items-baseline gap-3">
        <h2 className="mr-auto text-heading-md text-ink">
          Your newsletters <span className="text-body-md tabular text-faint">{letters.length}</span>
        </h2>
        {pub && (
          <button onClick={() => setPub(null)} className="text-body-sm text-link hover:underline">
            Show all
          </button>
        )}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 md:gap-x-5">
        {letters.map((n, i) => {
          const on = pub === n.name
          return (
            <motion.button
              key={n.name}
              onClick={() => setPub(on ? null : n.name)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: pub && !on ? 0.45 : 1, y: 0, transition: { delay: Math.min(i, 12) * 0.03 } }}
              whileHover={touch ? undefined : { y: -4 }}
              whileTap={{ scale: 0.97 }}
              aria-pressed={on}
              className="group flex flex-col text-left"
            >
              <div className={`rounded-[6px] shadow-cover transition-shadow group-hover:shadow-cover-lift ${on ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas' : ''}`}>
                <Monogram name={n.name} />
              </div>
              <div className="mt-2.5 line-clamp-2 text-label-sm text-ink">{n.name}</div>
              <div className="mt-0.5 truncate text-body-sm text-mute">
                {pluralize(n.articles, 'article')} · {formatDuration(n.seconds, { short: true })}
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* ── Articles ── */}
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-heading-md text-ink">
          {pub ? pub : 'Articles'} <span className="text-body-md tabular text-faint">{shown.length}</span>
          {pub && (
            <button onClick={() => setPub(null)} aria-label="Show every newsletter" className="ml-2 inline-grid size-6 place-items-center rounded-full align-middle text-faint hover:bg-hairline-soft hover:text-ink">
              <X className="size-3.5" />
            </button>
          )}
        </h2>
        <div className="relative order-last w-full sm:order-none sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search articles"
            className="h-9 w-full rounded-sm border border-hairline bg-canvas-elevated pl-9 pr-8 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-faint hover:text-ink">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Menu
          label="Sort by"
          items={SORTS.map((s) => ({
            label: s.label,
            checked: sort === s.key,
            onSelect: () => {
              setSort(s.key)
              try {
                localStorage.setItem('irb-substack-sort', s.key)
              } catch {
                /* ignore */
              }
            },
          }))}
          trigger={(p) => (
            <Button {...p} variant="outline" size="md" className="px-3">
              <ArrowDownUp className="size-4 text-body" />
              <span className="hidden sm:inline">{SORTS.find((s) => s.key === sort)?.label}</span>
            </Button>
          )}
        />
      </div>

      <div className="mt-4 space-y-6">
        {groups.map((g) => (
          <section key={g.label || 'all'}>
            {g.label && <div className="mb-1 px-1 text-mono-eyebrow text-mute">{g.label}</div>}
            <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-canvas-elevated">
              <AnimatePresence initial={false}>
                {g.items.map((a) => (
                  <motion.li key={a.url} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="group relative">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 py-3 pl-3 pr-12 transition-colors hover:bg-hairline-soft/60 sm:pl-4">
                      <Monogram name={a.publication} size="sm" className="w-10 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-label-sm text-ink group-hover:underline group-hover:decoration-hairline group-hover:underline-offset-4">{a.title}</div>
                        <div className="mt-0.5 truncate text-body-sm text-mute">{[a.publication, a.author].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-body-sm tabular text-ink">{a.seconds < 60 ? `${a.seconds}s` : formatDuration(a.seconds, { short: true })}</div>
                        <div className="text-body-sm text-faint">{sort === 'recent' ? timeOrDays(a) : relativeTime(a.last)}</div>
                      </div>
                    </a>
                    <button
                      onClick={() => remove(a)}
                      aria-label={`Remove ${a.title} from your reading`}
                      title="Remove from your reading"
                      className={`absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-faint hover:bg-error/10 hover:text-error ${touch ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))}
        {shown.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-label-sm text-ink">No articles match “{query}”</p>
            <p className="mt-1 text-body-md text-mute">Try a different title, newsletter or author.</p>
          </div>
        )}
      </div>
    </>
  )
}

/** "Today", "Yesterday", "This week", then by month. */
function groupByDay(list: Article[]) {
  const today = startOfDay(Date.now())
  const label = (t: number) => {
    const d = startOfDay(t)
    if (d === today) return 'Today'
    if (today - d <= 864e5 * 1.5) return 'Yesterday'
    if (today - d < 7 * 864e5) return 'This week'
    return new Date(t).toLocaleDateString(undefined, { month: 'long', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
  }
  const out: { label: string; items: Article[] }[] = []
  for (const a of list) {
    const l = label(a.last)
    const g = out.find((x) => x.label === l)
    if (g) g.items.push(a)
    else out.push({ label: l, items: [a] })
  }
  return out
}

const timeOrDays = (a: Article) => (a.days > 1 ? `${a.days} days` : new Date(a.last).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
