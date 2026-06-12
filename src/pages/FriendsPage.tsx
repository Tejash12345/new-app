import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, UserPlus, Check, X, Flame, UserMinus, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button, Empty, GlassCard, Input, Page, SectionTitle } from '../components/ui'

type SearchRow = { id: string; full_name: string; xp: number; study_streak: number }
type FriendRow = {
  friendship_id: string
  friend_id: string
  full_name: string
  xp: number
  study_streak: number
  status: 'pending' | 'accepted'
  direction: 'incoming' | 'outgoing'
}

function avatarColor(id: string) {
  const colors = ['#6C8CFF', '#FF6584', '#00BFA6', '#FFB454', '#A76CFF', '#42C7F5']
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}

function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
      style={{ background: avatarColor(id) }}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

export function FriendsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchRow[]>([])
  const [searching, setSearching] = useState(false)

  const { data: friends = [] } = useQuery<FriendRow[]>({
    queryKey: ['friends', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_friends')
      if (error) throw error
      return (data as FriendRow[]) ?? []
    },
  })

  // realtime refresh on any friendship change
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel(`friends-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' },
        () => qc.invalidateQueries({ queryKey: ['friends', user.id] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  // debounced search
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_users', { q })
      setResults((data as SearchRow[]) ?? [])
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  const friendIds = new Set(friends.map((f) => f.friend_id))
  const accepted = friends.filter((f) => f.status === 'accepted')
  const incoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming')
  const outgoing = friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing')

  async function sendRequest(addresseeId: string) {
    if (!user) return
    await supabase.from('friendships').insert({ requester_id: user.id, addressee_id: addresseeId })
    qc.invalidateQueries({ queryKey: ['friends', user.id] })
  }
  async function accept(id: string) {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['friends', user?.id] })
  }
  async function removeFriendship(id: string) {
    await supabase.from('friendships').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['friends', user?.id] })
  }

  return (
    <Page title="Friends" subtitle="Connect with other students, cheer each other on, study together. 🦁">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* find friends */}
        <GlassCard>
          <SectionTitle>Find students</SectionTitle>
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="mt-3 space-y-2">
            {searching && <p className="py-4 text-center text-sm text-slate-400">Searching…</p>}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">No students found for "{query}".</p>
            )}
            {results.map((r) => {
              const already = friendIds.has(r.id)
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3 py-2.5">
                  <Avatar id={r.id} name={r.full_name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900 dark:text-white">{r.full_name}</div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>⭐ {r.xp} XP</span><span className="flex items-center gap-0.5"><Flame size={11} /> {r.study_streak}</span>
                    </div>
                  </div>
                  {already ? (
                    <span className="text-xs font-semibold text-slate-400">Added</span>
                  ) : (
                    <Button size="sm" onClick={() => sendRequest(r.id)}><UserPlus size={15} /> Add</Button>
                  )}
                </div>
              )
            })}
            {query.trim().length < 2 && (
              <Empty emoji="🔎" text={'Type a name to find other students.\nSend them a friend request to connect!'} />
            )}
          </div>
        </GlassCard>

        <div className="space-y-5">
          {/* requests */}
          {incoming.length > 0 && (
            <GlassCard>
              <SectionTitle>Friend requests ({incoming.length})</SectionTitle>
              <div className="space-y-2">
                {incoming.map((f) => (
                  <motion.div key={f.friendship_id}
                    initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3 py-2.5">
                    <Avatar id={f.friend_id} name={f.full_name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-900 dark:text-white">{f.full_name}</div>
                      <div className="text-xs text-slate-500">wants to be your friend</div>
                    </div>
                    <button onClick={() => accept(f.friendship_id)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25">
                      <Check size={17} />
                    </button>
                    <button onClick={() => removeFriendship(f.friendship_id)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 hover:bg-rose-500/20">
                      <X size={17} />
                    </button>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          )}

          {/* my friends */}
          <GlassCard>
            <SectionTitle>My friends ({accepted.length})</SectionTitle>
            {accepted.length === 0 ? (
              <Empty emoji="🤝" text="No friends yet. Search for students and send a request!" />
            ) : (
              <div className="space-y-2">
                {accepted
                  .slice()
                  .sort((a, b) => b.xp - a.xp)
                  .map((f) => (
                    <div key={f.friendship_id} className="group flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3 py-2.5">
                      <Avatar id={f.friend_id} name={f.full_name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900 dark:text-white">{f.full_name}</div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>⭐ {f.xp} XP</span>
                          <span className="flex items-center gap-0.5"><Flame size={11} /> {f.study_streak} day streak</span>
                        </div>
                      </div>
                      <button onClick={() => removeFriendship(f.friendship_id)}
                        className="rounded-full p-2 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500">
                        <UserMinus size={16} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </GlassCard>

          {/* sent */}
          {outgoing.length > 0 && (
            <GlassCard>
              <SectionTitle>Sent requests ({outgoing.length})</SectionTitle>
              <div className="space-y-2">
                {outgoing.map((f) => (
                  <div key={f.friendship_id} className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3 py-2.5">
                    <Avatar id={f.friend_id} name={f.full_name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-900 dark:text-white">{f.full_name}</div>
                      <div className="flex items-center gap-1 text-xs text-amber-500"><Clock size={11} /> Pending</div>
                    </div>
                    <button onClick={() => removeFriendship(f.friendship_id)}
                      className="text-xs font-semibold text-slate-400 hover:text-rose-500">Cancel</button>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      </div>
    </Page>
  )
}
