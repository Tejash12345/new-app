import { createClient } from '@supabase/supabase-js'

// Trim the env values: a stray space (e.g. pasted into a Vercel env var) is
// tolerated by REST (sent as a header, where servers strip whitespace) but
// breaks the realtime WebSocket, where the key rides in the URL query string
// and the space is preserved as %20 — Supabase then rejects the connection.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

// exported for the streaming AI client, which calls the edge function via raw
// fetch (supabase.functions.invoke buffers the whole body and can't stream)
export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Single sign-on bridge to the Android wrapper. The native side mirrors this
// session (FLAuth channel → recoverSession) but cannot refresh tokens itself,
// and until now it only PULLED the token from localStorage on real page loads.
// A SPA almost never reloads, so after the hourly token rotation — or when the
// app is reopened with an expired token that the web client refreshes right
// after launch — the native copy went stale: the App Guard showed its manual
// login / "Sync failed" even though the web app was signed in, and Wellbeing
// limit changes stopped reaching the blocker. Push every fresh session to the
// bridge the moment auth state changes instead (deduped by access token).
let lastPushedToken = ''
supabase.auth.onAuthStateChange((_event, session) => {
  const fl = (window as unknown as { FLAuth?: { postMessage: (s: string) => void } }).FLAuth
  if (!fl || !session?.access_token || session.access_token === lastPushedToken) return
  lastPushedToken = session.access_token
  try { fl.postMessage(JSON.stringify(session)) } catch { /* bridge unavailable */ }
})
