import { createClient, type Session as AuthSession, type SupabaseClient } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when the app is built without Supabase settings — it then runs local-only. */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'irb-auth' },
      })
    : null

export const BUCKET = 'irb-books'
export const cloudEnabled = !!supabase

let session: AuthSession | null = null
let ready = !supabase
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    session = data.session
    ready = true
    emit()
  })
  supabase.auth.onAuthStateChange((_event, s) => {
    session = s
    ready = true
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

export function useAuth() {
  const s = useSyncExternalStore(onAuthChange, () => session)
  const r = useSyncExternalStore(onAuthChange, () => ready)
  return { session: s, user: s?.user ?? null, ready: r }
}
