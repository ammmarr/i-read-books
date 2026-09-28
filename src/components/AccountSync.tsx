import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Cloud, CloudAlert, CloudCheck, CloudDownload, CloudOff, LogOut, RefreshCw } from 'lucide-react'
import { NavLink } from 'react-router'
import { cloudEnabled, supabase, useAuth } from '../lib/supabase'
import { downloadAllBooks, signOutAndStop, syncNow, useSyncState, type SyncStatus } from '../lib/sync'
import { relativeTime } from '../lib/format'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
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
  const { user, ready } = useAuth()
  const sync = useSyncState()
  const { toast } = useToast()
  const [dl, setDl] = useState<{ done: number; total: number } | null>(null)

  if (!cloudEnabled) {
    return (
      <p className="text-body-md text-body">
        Cloud sync isn’t set up in this build. Add <code className="text-code">VITE_SUPABASE_URL</code> and{' '}
        <code className="text-code">VITE_SUPABASE_ANON_KEY</code> to <code className="text-code">.env</code> and rebuild.
      </p>
    )
  }
  if (!ready) return <div className="skeleton h-24 rounded-md" />
  if (!user) return <SignInForm />

  return (
    <div>
      <div className="flex items-center gap-3 rounded-md border border-hairline p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-[15px] font-semibold uppercase text-canvas">
          {(user.email ?? '?')[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-label-sm text-ink">{user.email}</div>
          <div className="flex items-center gap-1.5 text-body-sm text-mute">
            <StatusIcon status={sync.status} className="size-3.5" />
            {sync.status === 'idle' && sync.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}` : LABEL[sync.status]}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => syncNow()} disabled={sync.status === 'syncing'}>
          <RefreshCw className={`size-3.5 ${sync.status === 'syncing' ? 'animate-spin' : ''}`} /> Sync now
        </Button>
      </div>
      {sync.status === 'error' && sync.error && (
        <p className="mt-2 rounded-sm bg-warning/10 px-3 py-2 text-body-sm text-body">
          {/relation .* does not exist|schema cache/i.test(sync.error)
            ? 'The database tables are missing — run supabase/schema.sql in your Supabase SQL editor.'
            : sync.error}
        </p>
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
        <Button variant="ghost" onClick={() => signOutAndStop().then(() => toast({ message: 'Signed out', description: 'Books stay on this device.' }))}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </div>
  )
}

function SignInForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMsg(null)
    const redirect = window.location.origin + window.location.pathname
    const { data, error } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
    setBusy(false)
    if (error) return setMsg({ tone: 'error', text: error.message })
    if (mode === 'up' && !data.session) setMsg({ tone: 'info', text: 'Check your inbox to confirm your email, then sign in here.' })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Segmented
        size="sm"
        value={mode}
        onChange={(m) => {
          setMode(m)
          setMsg(null)
        }}
        options={[
          { value: 'in', label: 'Sign in' },
          { value: 'up', label: 'Create account' },
        ]}
      />
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-10 w-full rounded-sm border border-hairline bg-canvas-elevated px-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
      />
      <input
        type="password"
        required
        minLength={6}
        autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-10 w-full rounded-sm border border-hairline bg-canvas-elevated px-3 text-body-md text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-link focus:ring-3 focus:ring-link/15"
      />
      <AnimatePresence>
        {msg && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`text-body-sm ${msg.tone === 'error' ? 'text-error' : 'text-body'}`}
          >
            {msg.text}
          </motion.p>
        )}
      </AnimatePresence>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'One moment…' : mode === 'in' ? 'Sign in & sync' : 'Create account'}
      </Button>
      <p className="text-body-sm text-faint">Books you already added here upload to your account after you sign in.</p>
    </form>
  )
}
