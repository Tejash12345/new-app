import {
  createContext, useContext, useEffect, useState, type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, Settings } from '../lib/types'

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) setProfile(data as Profile)
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
