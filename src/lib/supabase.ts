import { createClient, type Session as AuthSession, type SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { useSyncExternalStore } from 'react'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Where email links (confirm, reset) should land. The Android app can't receive them, so they open the website. */
export const SITE_URL =
  !Capacitor.isNativePlatform() && typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)
    ? window.location.origin + window.location.pathname
    : (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://i-read-books-teal.vercel.app/'

/**
 * Email links come back as `?code=…` (PKCE) — or `#error=…` when a link has
 * expired. Read them before the hash router sees them, then tidy the URL.
 */
export type AuthNotice = { tone: 'success' | 'error' | 'info'; message: string; description?: string }
let notice: AuthNotice | null = null
const hadCode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code')
if (typeof window !== 'undefined') {
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''))
  const err = q.get('error_description') ?? h.get('error_description')
  const code = q.get('error_code') ?? h.get('error_code')
  if (err) {
    notice =
      code === 'otp_expired'
        ? { tone: 'error', message: 'That link has expired', description: 'Links work once and expire after an hour. Request a new one below.' }
        : { tone: 'error', message: 'That link didn’t work', description: err.replace(/\+/g, ' ') }
    window.history.replaceState(null, '', window.location.pathname + '#/')
  }
}

/** null when the app is built without Supabase settings — it then runs local-only. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'irb-auth' },
      })
    : null

export const BUCKET = 'irb-books'
export const cloudEnabled = !!supabase

let session: AuthSession | null = null
let ready = !supabase
/** Set when the user arrives from a "reset password" email. */
let recovering = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (supabase) {
  supabase.auth.getSession().then(({ data, error }) => {
    session = data.session
    ready = true
    if (hadCode) {
      // Confirmed on a different browser than the one that signed up → no
      // PKCE verifier here, but the email *is* confirmed: just sign in.
      if (error || !data.session) notice ??= { tone: 'success', message: 'Email confirmed', description: 'Sign in to start syncing.' }
      else if (!recovering) notice ??= { tone: 'success', message: 'You’re in', description: 'Your email is confirmed and sync is on.' }
      const clean = new URL(window.location.href)
      clean.searchParams.delete('code')
      window.history.replaceState(null, '', clean.pathname + clean.search + (clean.hash || '#/'))
    }
    emit()
  })
  supabase.auth.onAuthStateChange((event, s) => {
    session = s
    ready = true
    if (event === 'PASSWORD_RECOVERY') recovering = true
    if (event === 'SIGNED_OUT') recovering = false
    emit()
  })
}

export function getAuthSession() {
  return session
}

export function onAuthChange(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function takeAuthNotice() {
  const n = notice
  notice = null
  return n
}

export function endRecovery() {
  recovering = false
  emit()
}

export function useAuth() {
  const s = useSyncExternalStore(onAuthChange, () => session)
  const r = useSyncExternalStore(onAuthChange, () => ready)
  const rec = useSyncExternalStore(onAuthChange, () => recovering)
  const name = (s?.user.user_metadata?.full_name as string | undefined)?.trim() || ''
  return { session: s, user: s?.user ?? null, ready: r, recovering: rec, name }
}

/** Nudge subscribers after profile edits (updateUser doesn't always fire an event). */
export function refreshAuth() {
  supabase?.auth.getSession().then(({ data }) => {
    session = data.session
    emit()
  })
}
