import type { AuthError } from '@supabase/supabase-js'
import { db, markSyncTransaction, writeTombstones, SYNC_TABLES } from '../db/db'
import { BUCKET, SITE_URL, refreshAuth, supabase } from './supabase'
import { resetSyncCursors } from './sync'

export const MIN_PASSWORD = 8

/** Supabase error → something a person can act on. */
export function friendlyAuthError(e: Pick<AuthError, 'message'> & { code?: string; status?: number }): string {
  const code = e.code ?? ''
  const m = e.message ?? ''
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(m)) return 'That email and password don’t match. Check both, or reset your password.'
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(m)) return 'Please confirm your email first — the link is in your inbox.'
  if (code === 'user_already_exists' || /already registered/i.test(m)) return 'There’s already an account with this email. Sign in instead.'
  if (code === 'weak_password' || /password should be/i.test(m)) return `Choose a stronger password — at least ${MIN_PASSWORD} characters, mixing letters and numbers.`
  if (code === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(m)) return 'That doesn’t look like a valid email address.'
  if (code.startsWith('over_') || e.status === 429 || /rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.'
  if (code === 'same_password') return 'That’s your current password — choose a new one.'
  if (code === 'signup_disabled') return 'New sign-ups are turned off for this app.'
  if (/fetch|network|load failed/i.test(m)) return 'Can’t reach the server. Check your connection and try again.'
  return m || 'Something went wrong. Please try again.'
}

export function passwordChecks(p: string) {
  return {
    length: p.length >= MIN_PASSWORD,
    mix: /[a-zA-Z]/.test(p) && /\d|[^a-zA-Z]/.test(p),
  }
}

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string; code?: string }
const fail = (e: AuthError | Error): { ok: false; error: string; code?: string } => ({
  ok: false,
  error: friendlyAuthError(e as AuthError),
  code: (e as AuthError).code,
})

export async function signUp(name: string, email: string, password: string): Promise<Result<'confirm' | 'signed-in' | 'exists'>> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' }
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: name.trim() }, emailRedirectTo: SITE_URL },
  })
  if (error) return fail(error)
  // With confirmations on, Supabase answers an existing email with a
  // look-alike success (no identities) so accounts can't be enumerated.
  if (data.user && data.user.identities?.length === 0) return { ok: true, data: 'exists' }
  return { ok: true, data: data.session ? 'signed-in' : 'confirm' }
}

export async function signIn(email: string, password: string): Promise<Result> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  return error ? fail(error) : { ok: true }
}

export async function resendConfirmation(email: string): Promise<Result> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' }
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: SITE_URL } })
  return error ? fail(error) : { ok: true }
}

export async function sendPasswordReset(email: string): Promise<Result> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' }
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: SITE_URL })
  return error ? fail(error) : { ok: true }
}

export async function setNewPassword(password: string): Promise<Result> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' }
  const { error } = await supabase.auth.updateUser({ password })
  return error ? fail(error) : { ok: true }
}

export async function updateName(name: string): Promise<Result> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' }
  const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } })
  if (error) return fail(error)
  refreshAuth()
  return { ok: true }
}

export type DeleteStep = 'files' | 'account' | 'device' | 'done'

/**
 * Permanently deletes the cloud account: uploaded PDFs/covers first (storage
 * can only be emptied through its API), then the user row — which cascades to
 * every synced table. Locally we either erase everything or keep the library
 * as a fresh, never-synced copy.
 */
export async function deleteAccount(opts: { eraseDevice: boolean; onStep?: (s: DeleteStep) => void }): Promise<Result> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' }
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user.id
  if (!uid) return { ok: false, error: 'You’re signed out. Sign in again to delete your account.' }
  if (!navigator.onLine) return { ok: false, error: 'You’re offline. Connect to the internet to delete your account.' }

  // Pre-flight: make sure the server side is installed *before* touching
  // anything, so a failure can never leave a half-deleted account.
  const probe = await supabase.from('irb_profiles').select('user_id', { head: true, count: 'exact' }).limit(1)
  if (probe.error) {
    return {
      ok: false,
      error: /schema cache|does not exist|Could not find/i.test(probe.error.message)
        ? 'Your cloud database isn’t set up yet — run supabase/schema.sql in the Supabase SQL editor, then try again.'
        : probe.error.message,
    }
  }

  opts.onStep?.('files')
  try {
    for (;;) {
      const { data: files, error } = await supabase.storage.from(BUCKET).list(uid, { limit: 1000 })
      if (error) throw error
      if (!files?.length) break
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(files.map((f) => `${uid}/${f.name}`))
      if (rmErr) throw rmErr
      if (files.length < 1000) break
    }
  } catch (e) {
    return { ok: false, error: `Couldn’t remove your uploaded books: ${(e as Error).message}` }
  }

  opts.onStep?.('account')
  const { error } = await supabase.rpc('irb_delete_account')
  if (error) {
    return {
      ok: false,
      error: /irb_delete_account|schema cache|does not exist/i.test(error.message)
        ? 'The delete function isn’t installed yet — run supabase/schema.sql in your Supabase SQL editor, then try again.'
        : error.message,
    }
  }

  opts.onStep?.('device')
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  resetSyncCursors(uid)
  writeTombstones([])
  if (opts.eraseDevice) {
    await db.transaction('rw', [db.books, db.files, db.highlights, db.bookmarks, db.sessions, db.recaps], async () => {
      markSyncTransaction()
      await Promise.all([db.books.clear(), db.files.clear(), db.highlights.clear(), db.bookmarks.clear(), db.sessions.clear(), db.recaps.clear()])
    })
  } else {
    // Keep reading here; everything becomes "not yet uploaded" again, in case
    // you ever sign up again.
    await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
      markSyncTransaction()
      for (const t of SYNC_TABLES) await db.table(t).toCollection().modify({ dirty: 1 })
      await db.books.toCollection().modify((b) => {
        b.filePath = undefined
        b.coverPath = undefined
        b.uploadError = undefined
      })
    })
  }
  opts.onStep?.('done')
  return { ok: true }
}
