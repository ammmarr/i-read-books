import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ChartColumn, Cloud, Highlighter, Lock } from 'lucide-react'
import { useLocation } from 'react-router'
import { cloudEnabled, endRecovery, takeAuthNotice, useAuth } from '../../lib/supabase'
import { MIN_PASSWORD, passwordChecks, setNewPassword } from '../../lib/auth'
import { AuthFlow, Spinner } from './AuthFlow'
import { Logo } from '../Logo'
import { Sheet } from '../ui/Sheet'
import { Field } from '../ui/Field'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'

const SEEN_KEY = 'irb-welcome-seen'
const seen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/**
 * First-run screen: create an account (to sync) or carry on without one.
 * Shown once, only when cloud sync is available and nobody is signed in.
 */
export function Welcome() {
  const { user, ready } = useAuth()
  const location = useLocation()
  const [dismissed, setDismissed] = useState(seen)
  const open = cloudEnabled && ready && !user && !dismissed && !location.pathname.startsWith('/read/')

  const close = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  // Signing in (here or via an email link) completes onboarding.
  useEffect(() => {
    if (user) close()
  }, [user])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="welcome"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          className="fixed inset-0 z-[85] overflow-y-auto bg-canvas"
        >
          <div className="mx-auto grid min-h-full max-w-[1080px] items-center gap-10 px-5 pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+24px)] pt-[calc(var(--safe-area-inset-top,env(safe-area-inset-top))+32px)] md:grid-cols-[1fr_440px] md:gap-16 md:px-10">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
              <motion.div
                initial={{ opacity: 0, y: 12, rotate: -2 }}
                animate={{ opacity: 1, y: 0, rotate: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="text-ink"
              >
                <Logo className="h-28 md:h-36" title="I read" weight={5.5} />
              </motion.div>
              <div className="mt-4 text-[22px] font-semibold tracking-[-0.6px] text-ink">I read</div>
              <h1 className="mt-8 text-[34px] font-semibold leading-[40px] tracking-[-1.4px] text-ink md:text-display-xl">
                A quiet place
                <br />
                for your books.
              </h1>
              <p className="mt-4 max-w-md text-body-lg text-body">Read PDFs beautifully, keep every highlight, and watch the habit grow — on your PC and your tablet.</p>
              <ul className="mt-8 hidden space-y-4 md:block">
                {[
                  { icon: Cloud, title: 'In sync everywhere', body: 'Start on the PC, continue on the tablet — right where you stopped.' },
                  { icon: Highlighter, title: 'Highlights & notes', body: 'Five colours, notes, and everything exportable as Markdown.' },
                  { icon: ChartColumn, title: 'Reading insights', body: 'Streaks, time read, pace and a year of reading at a glance.' },
                ].map((f, i) => (
                  <motion.li
                    key={f.title}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.08 }}
                    className="flex gap-3"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-hairline bg-canvas-elevated text-ink">
                      <f.icon className="size-4" />
                    </span>
                    <span>
                      <span className="block text-label-sm text-ink">{f.title}</span>
                      <span className="block text-body-md text-mute">{f.body}</span>
                    </span>
                  </motion.li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="rounded-lg border border-hairline bg-canvas-elevated p-6 shadow-floating sm:p-8">
                <AuthFlow initial="signup" />
              </div>
              <button onClick={close} className="mx-auto mt-5 block rounded-sm px-2 py-1 text-body-md text-mute transition-colors hover:text-ink">
                Continue without an account
              </button>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-center text-body-sm text-faint">
                <Lock className="size-3" /> You can sign in any time from Settings.
              </p>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Toasts for arriving from an email link (confirmed / expired). */
export function AuthNotices() {
  const { toast } = useToast()
  const { ready } = useAuth()
  useEffect(() => {
    if (!ready) return
    const n = takeAuthNotice()
    if (n) toast({ tone: n.tone, message: n.message, description: n.description, duration: 7000 })
  }, [ready, toast])
  return null
}

/** After opening a "reset password" email link: choose the new password. */
export function PasswordRecovery() {
  const { recovering } = useAuth()
  const { toast } = useToast()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checks = passwordChecks(pw)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!checks.length) return setError(`Use at least ${MIN_PASSWORD} characters.`)
    if (pw !== pw2) return setError('The two passwords don’t match.')
    setBusy(true)
    const r = await setNewPassword(pw)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    endRecovery()
    toast({ message: 'Password updated', description: 'You’re signed in with your new password.' })
  }

  return (
    <Sheet open={recovering} onClose={endRecovery} title="Choose a new password" description="You opened a reset link — set a new password to finish." width={420}>
      <form onSubmit={save} className="space-y-4 pt-1">
        <Field label="New password" type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`At least ${MIN_PASSWORD} characters`} />
        <Field label="Repeat it" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Spinner />} Save password
        </Button>
      </form>
    </Sheet>
  )
}
