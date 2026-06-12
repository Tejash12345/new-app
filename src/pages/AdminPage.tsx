import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { Profile } from '../lib/types'
import { Empty, GlassCard, Page, SectionTitle } from '../components/ui'
import { levelForXp } from '../lib/utils'

/**
 * Admin dashboard. Requires profiles.role = 'admin' AND the admin RLS
 * policies from supabase/schema.sql (admin_read_all_profiles).
 */
export function AdminPage() {
  const { profile } = useAuth()

  const { data: users = [], error } = useQuery<Profile[]>({
    queryKey: ['admin-users'],
    enabled: profile?.role === 'admin',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Profile[]
    },
  })

  if (profile?.role !== 'admin') {
    return (
      <Page title="Admin" subtitle="Restricted area.">
        <GlassCard><Empty emoji="🔒" text={'You need the admin role to view this page.\nSet role = admin for your user in the Supabase profiles table.'} /></GlassCard>
      </Page>
    )
  }

  const totalXp = users.reduce((a, u) => a + u.xp, 0)
  const activeStreaks = users.filter((u) => u.study_streak > 0).length

  return (
    <Page title="Admin" subtitle="User management and platform overview.">
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          ['Total users', users.length],
          ['Active streaks', activeStreaks],
          ['Total XP earned', totalXp],
        ].map(([label, val]) => (
          <GlassCard key={label as string} className="!p-4 text-center">
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{val}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </GlassCard>
        ))}
      </div>

      <GlassCard>
        <SectionTitle>Users</SectionTitle>
        {error && (
          <p className="mb-3 rounded-2xl bg-amber-400/10 px-4 py-2.5 text-sm text-amber-600">
            Could not list all users — make sure you ran the admin policies section of schema.sql.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">XP / Level</th>
                <th className="py-2">Streak</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-200/40 dark:border-white/5">
                  <td className="py-2.5 pr-4 font-semibold text-slate-900 dark:text-white">{u.full_name || '—'}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{u.email}</td>
                  <td className="py-2.5 pr-4">
                    <span className={u.role === 'admin' ? 'rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600' : 'text-slate-500'}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500">{u.xp} XP · Lv {levelForXp(u.xp)}</td>
                  <td className="py-2.5 text-slate-500">🔥 {u.study_streak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </Page>
  )
}
