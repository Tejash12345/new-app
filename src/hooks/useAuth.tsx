import {
  createContext, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { syncMascotsFromSettings } from '../lib/mascot'
import type { Profile, Settings } from '../lib/types'

// ---- session backup, so a flaky token refresh can't kick you to login ----
// Mobile WebViews often drop a token refresh (network blip on resume, or a
// refresh-token rotation race). supabase-js reacts by emitting SIGNED_OUT with
// a null session — which used to bounce the user straight to the login screen
// even though their login was still valid. We keep a copy of the last good
// tokens in a separate key and, on an UNEXPECTED sign-out, try to restore the
// session before ever showing login. Only a real logout or a truly dead refresh
// token drops you out.
const BACKUP_KEY = 'fl-session-backup'
function readBackup(): { access_token: string; refresh_token: string } | null {
  try { const r = localStorage.getItem(BACKUP_KEY); return r ? JSON.parse(r) : null } catch { return null }
}
function writeBackup(s: Session) {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token })) } catch { /* quota / private mode */ }
}
function clearBackup() {
  try { localStorage.removeItem(BACKUP_KEY) } catch { /* ignore */ }
}
/** Try to re-establish the session from the backup refresh token (2 tries, for
 *  transient network failures). Returns true if a session came back. */
async function tryRecover(): Promise<boolean> {
  const b = readBackup()
  if (!b?.refresh_token) return false
  for (let i = 0; i < 2; i++) {
    try {
      const { data, error } = await supabase.auth.setSession(b)
      if (!error && data.session) return true
    } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

type AuthCtx = {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (patch: Partial<Pick<Profile, 'full_name' | 'avatar_url' | 'is_private'>> & { settings?: Settings }) => Promise<void>
  addXp: (amount: number, reason: string) => Promise<void>
  touchStudyStreak: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const userSignedOut = useRef(false) // true only for a deliberate Log out tap
  const recovering = useRef(false)    // a recovery attempt is in flight

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      if (data.session) { writeBackup(data.session); setSession(data.session); setLoading(false); return }
      // supabase has no stored session — try our backup before showing login
      // (covers a wiped/rotated store where our refresh token is still good)
      recovering.current = true
      const ok = await tryRecover()
      recovering.current = false
      if (cancelled) return
      if (!ok) setSession(null) // genuinely logged out → login screen
      setLoading(false)         // if ok, SIGNED_IN already set the session
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (s) { writeBackup(s); setSession(s); return }
      // s === null
      if (event === 'SIGNED_OUT') {
        if (userSignedOut.current) { userSignedOut.current = false; clearBackup(); setSession(null); return }
        if (recovering.current) return // a recovery is already running — don't stack
        // UNEXPECTED sign-out (failed refresh / resume / network blip): recover
        recovering.current = true
        void tryRecover().then((ok) => {
          recovering.current = false
          if (!ok) { clearBackup(); setSession(null) } // truly logged out
          // ok → SIGNED_IN fired + session restored → no bounce to login
        })
      }
      // ignore other null-session events to avoid a login flash
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [])

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) {
      setProfile(data as Profile)
      // custom mascot chosen on another device follows the account
      syncMascotsFromSettings((data as Profile).settings)
    }
  }

  useEffect(() => {
    if (session?.user) loadProfile(session.user.id)
    else setProfile(null)
  }, [session?.user?.id])

  const value: AuthCtx = {
    user: session?.user ?? null,
    profile,
    loading,
    signOut: async () => {
      userSignedOut.current = true // this is a REAL logout — don't auto-recover it
      clearBackup()
      await supabase.auth.signOut()
    },
    refreshProfile: async () => {
      if (session?.user) await loadProfile(session.user.id)
    },
    updateProfile: async (patch) => {
      if (!session?.user) return
      await supabase.from('profiles').update(patch).eq('id', session.user.id)
      await loadProfile(session.user.id)
    },
    addXp: async (amount, reason) => {
      if (!session?.user || !profile) return
      const xp = profile.xp + amount
      await supabase.from('profiles').update({ xp }).eq('id', session.user.id)
      await supabase.from('xp_events').insert({ user_id: session.user.id, amount, reason })
      setProfile({ ...profile, xp })
    },
    touchStudyStreak: async () => {
      if (!session?.user || !profile) return
      const today = new Date()
      const todayStr = today.toISOString().slice(0, 10)
      if (profile.last_study_date === todayStr) return
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const yStr = yesterday.toISOString().slice(0, 10)
      const streak = profile.last_study_date === yStr ? profile.study_streak + 1 : 1
      await supabase
        .from('profiles')
        .update({ study_streak: streak, last_study_date: todayStr })
        .eq('id', session.user.id)
      setProfile({ ...profile, study_streak: streak, last_study_date: todayStr })
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
