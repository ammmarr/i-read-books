import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { ArrowLeft, Check, CircleAlert, Lock, Mail, MailCheck, User } from 'lucide-react'
import { MIN_PASSWORD, passwordChecks, resendConfirmation, sendPasswordReset, signIn, signUp } from '../../lib/auth'
import { Field } from '../ui/Field'
import { Button } from '../ui/Button'

export type AuthMode = 'signup' | 'signin' | 'forgot' | 'sent-confirm' | 'sent-reset' | 'success'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface Props {
  initial?: AuthMode
  /** Called after a successful sign-in (the parent usually closes itself). */
  onSignedIn?: () => void
}

/**
 * The whole account journey in one card: create account → confirm email →
 * sign in, plus forgot-password. Each step slides in; errors are inline and
 * actionable (resend the email, switch to sign-in, reset the password).
 */
export function AuthFlow({ initial = 'signup', onSignedIn }: Props) {
  const [mode, setMode] = useState<AuthMode>(initial)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [cooldown, setCooldown] = useState(0)
  const shake = useAnimationControls()
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const go = (m: AuthMode) => {
    setMode(m)
    setError(null)
    setTouched({})
    if (m === 'signin' || m === 'signup' || m === 'forgot') setTimeout(() => firstField.current?.focus(), 250)
  }

  const nudge = () => shake.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.4 } })

  const emailErr = touched.email && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null
  const nameErr = touched.name && !name.trim() ? 'Tell us what to call you.' : null
  const checks = passwordChecks(password)
  const pwErr = touched.password && mode === 'signup' && !checks.length ? `Use at least ${MIN_PASSWORD} characters.` : touched.password && !password ? 'Enter your password.' : null

  const resend = async () => {
    setBusy(true)
    const r = await resendConfirmation(email)
    setBusy(false)
    if (r.ok) {
      setCooldown(60)
      setError(null)
      if (mode !== 'sent-confirm') go('sent-confirm')
    } else setError({ text: r.error })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, email: true, password: true })
    const bad =
      !EMAIL_RE.test(email.trim()) ||
      (mode === 'signup' && (!name.trim() || !checks.length)) ||
      (mode === 'signin' && !password)
    if (bad) return nudge()
    setBusy(true)
    setError(null)
    if (mode === 'signup') {
      const r = await signUp(name, email, password)
      setBusy(false)
      if (!r.ok) {
        nudge()
        return setError({ text: r.error, action: r.code === 'user_already_exists' ? { label: 'Sign in instead', run: () => go('signin') } : undefined })
      }
      if (r.data === 'exists') {
        nudge()
        return setError({ text: 'There’s already an account with this email.', action: { label: 'Sign in instead', run: () => go('signin') } })
      }
      if (r.data === 'confirm') {
        setCooldown(60)
        return go('sent-confirm')
      }
      go('success')
      setTimeout(() => onSignedIn?.(), 1400)
    } else if (mode === 'signin') {
      const r = await signIn(email, password)
      setBusy(false)
      if (!r.ok) {
        nudge()
        return setError({
          text: r.error,
          action:
            r.code === 'email_not_confirmed'
              ? { label: 'Resend confirmation email', run: resend }
              : r.code === 'invalid_credentials'
                ? { label: 'Reset password', run: () => go('forgot') }
                : undefined,
        })
      }
      go('success')
      setTimeout(() => onSignedIn?.(), 1400)
    } else if (mode === 'forgot') {
      const r = await sendPasswordReset(email)
      setBusy(false)
      if (!r.ok) {
        nudge()
        return setError({ text: r.error })
      }
      setCooldown(60)
      go('sent-reset')
    }
  }

  const slide = {
    initial: { opacity: 0, x: 16 },
    animate: { opacity: 1, x: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const } },
    exit: { opacity: 0, x: -12, transition: { duration: 0.14 } },
  }

  return (
    <motion.div layout transition={{ layout: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }} className="overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {(mode === 'signup' || mode === 'signin' || mode === 'forgot') && (
          <motion.form key={mode} {...slide} onSubmit={submit} noValidate>
            <motion.div animate={shake}>
              <div className="mb-5">
                {mode === 'forgot' && (
                  <button type="button" onClick={() => go('signin')} className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-sm px-1 text-body-sm text-mute hover:text-ink">
                    <ArrowLeft className="size-3.5" /> Back to sign in
                  </button>
                )}
                <h2 className="text-heading-md text-ink">
                  {mode === 'signup' ? 'Create your account' : mode === 'signin' ? 'Welcome back' : 'Reset your password'}
                </h2>
                <p className="mt-1 text-body-md text-mute">
                  {mode === 'signup'
                    ? 'Keep your library, highlights and progress in sync on every device.'
                    : mode === 'signin'
                      ? 'Sign in to pick up where you left off.'
                      : 'We’ll email you a link to choose a new one.'}
                </p>
              </div>

              <div className="space-y-4">
                {mode === 'signup' && (
                  <Field
                    ref={firstField}
                    label="Your name"
                    icon={<User />}
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    placeholder="What should we call you?"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                    error={nameErr}
                  />
                )}
                <Field
                  ref={mode === 'signup' ? undefined : firstField}
                  label="Email"
                  type="email"
                  icon={<Mail />}
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  enterKeyHint={mode === 'forgot' ? 'send' : 'next'}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  error={emailErr}
                />
                {mode !== 'forgot' && (
                  <Field
                    label="Password"
                    type="password"
                    icon={<Lock />}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    enterKeyHint="go"
                    placeholder={mode === 'signup' ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    error={pwErr}
                    aside={
                      mode === 'signin' ? (
                        <button type="button" onClick={() => go('forgot')} className="text-body-sm text-link hover:underline">
                          Forgot password?
                        </button>
                      ) : undefined
                    }
                    hint={
                      mode === 'signup' && password ? (
                        <span className="flex flex-wrap gap-x-4 gap-y-1">
                          <Check2 ok={checks.length}>{MIN_PASSWORD}+ characters</Check2>
                          <Check2 ok={checks.mix}>Letters and a number or symbol</Check2>
                        </span>
                      ) : undefined
                    }
                  />
                )}
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    role="alert"
                    className="overflow-hidden"
                  >
                    <div className="mt-4 flex gap-2.5 rounded-sm border border-error/25 bg-error/5 px-3 py-2.5">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-error" />
                      <div className="text-body-md text-ink">
                        {error.text}
                        {error.action && (
                          <button type="button" onClick={error.action.run} className="ml-1 font-medium text-link hover:underline">
                            {error.action.label}
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button type="submit" size="lg" disabled={busy} className="mt-5 w-full">
                {busy && <Spinner />}
                {mode === 'signup' ? 'Create account' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
              </Button>
            </motion.div>

            {mode !== 'forgot' && (
              <p className="mt-5 text-center text-body-md text-mute">
                {mode === 'signup' ? 'Already have an account?' : 'New to I READ BOOKS?'}{' '}
                <button type="button" onClick={() => go(mode === 'signup' ? 'signin' : 'signup')} className="font-medium text-ink underline-offset-4 hover:underline">
                  {mode === 'signup' ? 'Sign in' : 'Create an account'}
                </button>
              </p>
            )}
          </motion.form>
        )}

        {(mode === 'sent-confirm' || mode === 'sent-reset') && (
          <motion.div key={mode} {...slide} className="text-center">
            <motion.div
              initial={{ scale: 0.6, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.05 }}
              className="mx-auto grid size-16 place-items-center rounded-full bg-link-soft text-link"
            >
              <MailCheck className="size-7" />
            </motion.div>
            <h2 className="mt-5 text-heading-md text-ink">{mode === 'sent-confirm' ? 'Confirm your email' : 'Check your inbox'}</h2>
            <p className="mx-auto mt-2 max-w-sm text-body-md text-body">
              We sent a link to <span className="font-medium text-ink">{email.trim()}</span>.{' '}
              {mode === 'sent-confirm'
                ? 'Open it on any device to activate your account, then sign in here.'
                : 'Open it to choose a new password. It’s valid for an hour.'}
            </p>
            <p className="mt-2 text-body-sm text-faint">Can’t find it? Check spam or promotions.</p>
            <div className="mt-6 flex flex-col gap-2">
              <Button size="lg" onClick={() => go('signin')}>
                {mode === 'sent-confirm' ? 'I’ve confirmed — sign in' : 'Back to sign in'}
              </Button>
              <Button
                variant="outline"
                size="lg"
                disabled={busy || cooldown > 0}
                onClick={mode === 'sent-confirm' ? resend : async () => {
                  setBusy(true)
                  const r = await sendPasswordReset(email)
                  setBusy(false)
                  if (r.ok) setCooldown(60)
                  else setError({ text: r.error })
                }}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
              </Button>
              <button onClick={() => go(mode === 'sent-confirm' ? 'signup' : 'forgot')} className="mt-1 text-body-sm text-mute hover:text-ink">
                Use a different email
              </button>
            </div>
            {error && <p className="mt-3 text-body-sm text-error">{error.text}</p>}
          </motion.div>
        )}

        {mode === 'success' && (
          <motion.div key="success" {...slide} className="py-6 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              className="mx-auto grid size-16 place-items-center rounded-full bg-success/15 text-success"
            >
              <motion.svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.4 }} />
              </motion.svg>
            </motion.div>
            <h2 className="mt-5 text-heading-md text-ink">{name.trim() ? `Welcome, ${name.trim().split(' ')[0]}` : 'You’re signed in'}</h2>
            <p className="mt-1 text-body-md text-mute">Syncing your library…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Check2({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 transition-colors ${ok ? 'text-success' : 'text-faint'}`}>
      <motion.span animate={{ scale: ok ? [1, 1.3, 1] : 1 }} transition={{ duration: 0.25 }} className="grid">
        <Check className="size-3.5" strokeWidth={ok ? 3 : 2} />
      </motion.span>
      {children}
    </span>
  )
}

export function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
}
