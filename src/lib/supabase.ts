import { createClient } from '@supabase/supabase-js'

// Trim the env values: a stray space (e.g. pasted into a Vercel env var) is
// tolerated by REST (sent as a header, where servers strip whitespace) but
// breaks the realtime WebSocket, where the key rides in the URL query string
// and the space is preserved as %20 — Supabase then rejects the connection.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
