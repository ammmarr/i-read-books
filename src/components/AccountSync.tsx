import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Cloud, CloudAlert, CloudCheck, CloudDownload, CloudOff, LogOut, Pencil, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { NavLink } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { cloudEnabled, useAuth } from '../lib/supabase'
import { downloadAllBooks, signOutAndStop, syncNow, useSyncState, type SyncStatus } from '../lib/sync'
import { deleteAccount, updateName, type DeleteStep } from '../lib/auth'
import { db } from '../db/db'
import { formatDurationLong, relativeTime } from '../lib/format'
import { AuthFlow, Spinner } from './auth/AuthFlow'
import { Button } from './ui/Button'
import { Sheet } from './ui/Sheet'
import { useToast } from './ui/Toast'

const LABEL: Record<SyncStatus, string> = {
  off: 'Sync not configured',
  'signed-out': 'Not signed in — this device only',
  idle: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes will sync later',
  error: 'Sync problem',
}

function StatusIcon({ status, className = 'size-4' }: { status: SyncStatus; className?: string }) {
  if (status === 'syncing') return <RefreshCw className={`${className} animate-spin text-link [animation-duration:1.2s]`} />
  if (status === 'idle') return <CloudCheck className={`${className} text-success`} />
  if (status === 'offline') return <CloudOff className={`${className} text-mute`} />
  if (status === 'error') return <CloudAlert className={`${className} text-warning`} />
  return <Cloud className={`${className} text-faint`} />
}

/** Small cloud in the header: glanceable sync state, links to settings. */
export function SyncIndicator() {
  const { status, lastSyncedAt, error } = useSyncState()
  if (!cloudEnabled) return null
  const title = status === 'idle' && lastSyncedAt ? `Synced ${relativeTime(lastSyncedAt)}` : status === 'error' ? `${LABEL.error}: ${error}` : LABEL[status]
  return (
    <NavLink
      to="/settings"
      title={title}
      aria-label={title}
      className="grid size-10 place-items-center rounded-full text-body transition-colors hover:bg-hairline-soft hover:text-ink"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={status} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.18 }} className="grid">
          <StatusIcon status={status} className="size-[18px]" />
        </motion.span>
      </AnimatePresence>
    </NavLink>
  )
}

export function AccountSync() {
  const { user, ready, name } = useAuth()
  const sync = useSyncState()
  const { toast } = useToast()
  const [dl, setDl] = useState<{ done: number; total: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  if (!cloudEnabled) {
    return (
      <p className="text-body-md text-body">
        Cloud sync isn’t set up in this build. Add <code className="text-code">VITE_SUPABASE_URL</code> and{' '}
        <code className="text-code">VITE_SUPABASE_ANON_KEY</code> to <code className="text-code">.env</code> and rebuild.
      </p>
    )
  }
  if (!ready) return <div className="skeleton h-24 rounded-md" />
  if (!user) return <AuthFlow initial="signin" />

  const display = name || user.email?.split('@')[0] || 'Reader'
  return (
    <div>
      <div className="rounded-md border border-hairline p-4">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-ink text-[18px] font-semibold uppercase text-canvas"
          >
            {display[0]}
          </motion.div>
          <div className="min-w-0 flex-1">
            <NameEditor name={name} fallback={display} />
            <div className="truncate text-body-sm text-mute">{user.email}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
          <StatusIcon status={sync.status} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate text-body-sm text-body">
            {sync.status === 'idle' && sync.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}` : LABEL[sync.status]}
          </span>
          <Button variant="outline" size="sm" onClick={() => syncNow()} disabled={sync.status === 'syncing'}>
            <RefreshCw className={`size-3.5 ${sync.status === 'syncing' ? 'animate-spin' : ''}`} /> Sync now
          </Button>
        </div>
      </div>
      {sync.status === 'error' && sync.error && (
        <p className="mt-2 rounded-sm bg-warning/10 px-3 py-2 text-body-sm text-body">
          {/relation .* does not exist|schema cache|Could not find the (table|function)|column .* does not exist/i.test(sync.error)
            ? 'Your cloud database needs setting up or updating — run the latest supabase/schema.sql in the Supabase SQL editor.'
            : sync.error}
        </p>
      )}
      {sync.status !== 'error' && sync.warning && (
        <p className="mt-2 rounded-sm bg-warning/10 px-3 py-2 text-body-sm text-body">{sync.warning}</p>
      )}
      <p className="mt-3 text-body-sm text-mute">
        Your library, reading list, progress, highlights, notes and reading time sync across every device you sign in on. PDFs upload once and download on
        other devices the first time you open them.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!!dl}
          onClick={async () => {
            const n = await downloadAllBooks((done, total) => setDl({ done, total }))
            setDl(null)
            toast({ message: n ? `${n} books downloaded` : 'Every book is already on this device', description: n ? 'Available offline now.' : undefined })
          }}
        >
          <CloudDownload className="size-4" />
          {dl ? `Downloading ${dl.done} of ${dl.total}…` : 'Download all for offline'}
        </Button>
        <Button variant="ghost" onClick={() => signOutAndStop().then(() => toast({ message: 'Signed out', description: 'Your books stay on this device.' }))}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>

      <div className="mt-6 border-t border-hairline pt-4">
        <button onClick={() => setDeleting(true)} className="text-body-md text-error underline-offset-4 hover:underline">
          Delete account…
        </button>
        <p className="mt-0.5 text-body-sm text-faint">Permanently removes your cloud library and login.</p>
      </div>
      <DeleteAccount open={deleting} onClose={() => setDeleting(false)} email={user.email ?? ''} />
    </div>
  )
}

function NameEditor({ name, fallback }: { name: string; fallback: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setValue(name), [name])

  const save = async () => {
    if (!value.trim()) return setErr('Name can’t be empty.')
    if (value.trim() === name) return setEditing(false)
    setBusy(true)
    const r = await updateName(value)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setErr(null)
    setEditing(false)
  }

  if (!editing)
    return (
      <button onClick={() => setEditing(true)} className="group flex max-w-full items-center gap-1.5 text-left" aria-label="Edit your name">
        <span className="truncate text-label-sm text-ink">{name || fallback}</span>
        <Pencil className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-ink" />
      </button>
    )
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setEditing(false), setValue(name))}
        placeholder="Your name"
        autoComplete="name"
        className={`h-8 min-w-0 flex-1 rounded-sm border bg-canvas-elevated px-2 text-label-sm text-ink outline-none focus:ring-3 ${err ? 'border-error ring-error/15' : 'border-link ring-link/15'}`}
      />
      <button type="submit" aria-label="Save name" disabled={busy} className="grid size-8 place-items-center rounded-full text-success hover:bg-hairline-soft">
        {busy ? <Spinner /> : <Check className="size-4" />}
      </button>
      <button type="button" aria-label="Cancel" onClick={() => (setEditing(false), setValue(name), setErr(null))} className="grid size-8 place-items-center rounded-full text-faint hover:bg-hairline-soft">
        <X className="size-4" />
      </button>
    </form>
  )
}

const STEP_LABEL: Record<DeleteStep, string> = {
  files: 'Removing your uploaded books…',
  account: 'Deleting your account…',
  device: 'Tidying up this device…',
  done: 'Done',
}

function DeleteAccount({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
  const { toast } = useToast()
  const [erase, setErase] = useState(false)
  const [typed, setTyped] = useState('')
  const [step, setStep] = useState<DeleteStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const counts = useLiveQuery(async () => {
    const [books, highlights, sessions] = await Promise.all([db.books.count(), db.highlights.count(), db.sessions.toArray()])
    return { books, highlights, seconds: sessions.reduce((a, s) => a + s.seconds, 0) }
  }, [])

  useEffect(() => {
    if (open) {
      setTyped('')
      setError(null)
      setStep(null)
      setErase(false)
    }
  }, [open])

  const ready = typed.trim().toUpperCase() === 'DELETE'
  const working = step !== null && step !== 'done'

  const run = async () => {
    setError(null)
    const r = await deleteAccount({ eraseDevice: erase, onStep: setStep })
    if (!r.ok) {
      setStep(null)
      return setError(r.error)
    }
    toast({ message: 'Your account is deleted', description: erase ? 'This device is empty now.' : 'Your books are still here, on this device only.', duration: 6000 })
    setTimeout(onClose, 300)
  }

  return (
    <Sheet open={open} onClose={working ? () => {} : onClose} title="Delete your account?" width={460}>
      <div className="flex gap-3 rounded-md border border-error/25 bg-error/5 p-3.5">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-error" />
        <div className="text-body-md text-ink">
          This permanently deletes <span className="font-medium">{email}</span> and everything stored in the cloud
          {counts ? (
            <>
              : <span className="font-medium">{counts.books} books</span>, <span className="font-medium">{counts.highlights} highlights & notes</span>
              {counts.seconds > 60 && (
                <>
                  , <span className="font-medium">{formatDurationLong(counts.seconds)}</span> of reading history
                </>
              )}
              , and every uploaded PDF.
            </>
          ) : (
            '.'
          )}{' '}
          It can’t be undone.
        </div>
      </div>

      <fieldset className="mt-5 space-y-2" disabled={working}>
        <legend className="mb-2 text-label-sm text-ink">This device</legend>
        {[
          { v: false, title: 'Keep my books here', body: 'Carry on reading offline. Nothing on this device changes.' },
          { v: true, title: 'Erase this device too', body: 'Remove every book, highlight and statistic from this device.' },
        ].map((o) => (
          <label
            key={String(o.v)}
            className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${erase === o.v ? 'border-ink bg-hairline-soft' : 'border-hairline hover:bg-hairline-soft/60'}`}
          >
            <input type="radio" name="erase" className="mt-1 accent-[var(--color-ink)]" checked={erase === o.v} onChange={() => setErase(o.v)} />
            <span>
              <span className="block text-body-md text-ink">{o.title}</span>
              <span className="block text-body-sm text-mute">{o.body}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="mt-5 block">
        <span className="mb-1.5 block text-label-sm text-ink">
          Type <span className="font-mono">DELETE</span> to confirm
        </span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={working}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="DELETE"
          className="h-11 w-full rounded-sm border border-hairline bg-canvas-elevated px-3 font-mono text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-error focus:ring-3 focus:ring-error/15"
        />
      </label>

      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="mt-3 text-body-sm text-error">
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={working}>
          Keep my account
        </Button>
        <Button variant="danger" onClick={run} disabled={!ready || working}>
          {working && <Spinner />}
          {working ? STEP_LABEL[step!] : 'Delete account forever'}
        </Button>
      </div>
    </Sheet>
  )
}
