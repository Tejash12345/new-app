import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, UserPlus, Check, X, Flame, UserMinus, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOnlineCheck } from '../hooks/useOnline'
import { Button, Empty, GlassCard, Input, Page, SectionTitle } from '../components/ui'

type SearchRow = { id: string; full_name: string; email: string; xp: number; study_streak: number; last_seen?: string }
type FriendRow = {
  friendship_id: string
  friend_id: string
  full_name: string
  email: string
  xp: number
  study_streak: number
  status: 'pending' | 'accepted'
  direction: 'incoming' | 'outgoing'
  last_seen?: string
}

/** Best display name: full name, else the part of the email before @. */
function displayName(r: { full_name?: string; email?: string }) {
  const n = (r.full_name || '').trim()
  if (n) return n
  const e = r.email || ''
  return e ? e.split('@')[0] : 'Student'
}

function avatarColor(id: string) {
  const colors = ['#6C8CFF', '#FF6584', '#00BFA6', '#FFB454', '#A76CFF', '#42C7F5']
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}

function Avatar({ id, name, online }: { id: string; name: string; online?: boolean }) {
  return (
    <div className="relative shrink-0">
      <div className="flex h-11 w-11 items-center justify-center rounded-full text-base font-bold text-white"
        style={{ background: avatarColor(id) }}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </div>
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
      )}
    </div>
  )
}

export function FriendsPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchRow[]>([])
  const [searching, setSearching] = useState(false)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  const isOnline = useOnlineCheck()
  function notify(text: string, ok = true) {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 3000)
  }
  // tick so online status (from last_seen) re-evaluates as time passes
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20_000)
    return () => clearInterval(t)
  }, [])

  const { data: friends = [] } = useQuery<FriendRow[]>({
    queryKey: ['friends', user?.id],
    enabled: !!user,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_friends')
      if (error) throw error
      return (data as FriendRow[]) ?? []
    },
  })

  const { data: suggested = [] } = useQuery<SearchRow[]>({
    queryKey: ['suggested', user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc('suggested_users')
      return (data as SearchRow[]) ?? []
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
      const { data, error } = await supabase.rpc('search_users', { q })
      if (error) notify(`Search failed: ${error.message}`, false)
      setResults((data as SearchRow[]) ?? [])
      setSearching(false)
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  const friendIds = new Set(friends.map((f) => f.friend_id))
  const accepted = friends.filter((f) => f.status === 'accepted')
  const incoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming')
  const outgoing = friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing')
  const onlineFriends = accepted.filter((f) => isOnline(f.friend_id, f.last_seen))
  const suggestedFiltered = suggested.filter((s) => !friendIds.has(s.id))
  const onlineCount = onlineFriends.length

  async function sendRequest(addresseeId: string) {
    if (!user) return
    // RPC handles every case: mutual request -> instant friends, duplicate -> no-op
    const { data, error } = await supabase.rpc('send_friend_request', { target: addresseeId })
    if (error) {
      // fallback for a database that hasn't run upgrade-7 yet
      const missing = error.code === 'PGRST202' || /find the function/i.test(error.message)
      if (missing) {
        const { error: e2 } = await supabase
          .from('friendships')
          .insert({ requester_id: user.id, addressee_id: addresseeId })
        if (e2) { notify(`Could not send request: ${e2.message}`, false); return }
        notify('Friend request sent! ✓')
      } else {
        notify(`Could not send request: ${error.message}`, false)
        return
      }
    } else if (data === 'accepted') {
      notify('They already added you — you are now friends! 🎉')
    } else if (data === 'pending') {
      notify('Request already sent — waiting for them to accept.')
    } else {
      notify('Friend request sent! ✓')
    }
    qc.invalidateQueries({ queryKey: ['friends', user.id] })
    qc.invalidateQueries({ queryKey: ['suggested', user.id] })
  }
  async function accept(id: string) {
    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    if (error) { notify(`Could not accept: ${error.message}`, false); return }
    notify('Friend added! Say hi in Chat. 💬')
    qc.invalidateQueries({ queryKey: ['friends', user?.id] })
  }
  async function removeFriendship(id: string) {
    const { error } = await supabase.from('friendships').delete().eq('id', id)
    if (error) { notify(`Could not remove: ${error.message}`, false); return }
    qc.invalidateQueries({ queryKey: ['friends', user?.id] })
    qc.invalidateQueries({ queryKey: ['suggested', user?.id] })
  }

  return (
    <Page title="Friends" subtitle="Connect with other students, cheer each other on, study together. 🦁">
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className={`fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-xl ${
            toast.ok ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
        >
          {toast.text}
        </motion.div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* find friends */}
        <GlassCard>
          <SectionTitle>Find students</SectionTitle>
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by name or email…"
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
                  <Avatar id={r.id} name={displayName(r)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900 dark:text-white">{displayName(r)}</div>
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
          </div>

          {/* discover — see people without searching */}
          {query.trim().length < 2 && (
            <div className="mt-2">
              <div className="mb-2 mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">
                Discover students
              </div>
              {suggestedFiltered.length === 0 ? (
                <Empty emoji="🦁" text={'No one else here yet.\nInvite friends with the Share link on the Get App page!'} />
              ) : (
                <div className="space-y-2">
                  {suggestedFiltered.map((r) => {
                    const online = isOnline(r.id, r.last_seen)
                    return (
                      <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3 py-2.5">
                        <Avatar id={r.id} name={displayName(r)} online={online} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-slate-900 dark:text-white">{displayName(r)}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {online ? <span className="font-semibold text-emerald-500">● Online</span>
                              : <><span>⭐ {r.xp} XP</span><span className="flex items-center gap-0.5"><Flame size={11} /> {r.study_streak}</span></>}
                          </div>
                        </div>
                        <Button size="sm" onClick={() => sendRequest(r.id)}><UserPlus size={15} /> Add</Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
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
                    <Avatar id={f.friend_id} name={displayName(f)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-900 dark:text-white">{displayName(f)}</div>
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
            <SectionTitle
              right={
                onlineCount > 0 ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> {onlineCount} online
                  </span>
                ) : undefined
              }
            >
              My friends ({accepted.length})
            </SectionTitle>

            {/* online-now strip — names of friends online right now */}
            {onlineFriends.length > 0 && (
              <div className="mb-3 flex gap-3 overflow-x-auto rounded-2xl bg-emerald-500/5 p-3">
                {onlineFriends.map((f) => (
                  <div key={f.friendship_id} className="flex w-16 shrink-0 flex-col items-center gap-1">
                    <Avatar id={f.friend_id} name={displayName(f)} online />
                    <span className="w-full truncate text-center text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {displayName(f).split(' ')[0]}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {accepted.length === 0 ? (
              <Empty emoji="🤝" text="No friends yet. Search for students and send a request!" />
            ) : (
              <div className="space-y-2">
                {accepted
                  .slice()
                  .sort((a, b) => {
                    const ao = isOnline(a.friend_id, a.last_seen) ? 1 : 0
                    const bo = isOnline(b.friend_id, b.last_seen) ? 1 : 0
                    if (ao !== bo) return bo - ao
                    return b.xp - a.xp
                  })
                  .map((f) => {
                    const online = isOnline(f.friend_id, f.last_seen)
                    return (
                      <div key={f.friendship_id} className="group flex items-center gap-3 rounded-2xl bg-white/40 dark:bg-white/5 px-3 py-2.5">
                        <Avatar id={f.friend_id} name={displayName(f)} online={online} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-slate-900 dark:text-white">{displayName(f)}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {online
                              ? <span className="font-semibold text-emerald-500">● Online now</span>
                              : <><span>⭐ {f.xp} XP</span><span className="flex items-center gap-0.5"><Flame size={11} /> {f.study_streak}</span></>}
                          </div>
                        </div>
                        <button onClick={() => removeFriendship(f.friendship_id)}
                          className="rounded-full p-2 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-500">
                          <UserMinus size={16} />
                        </button>
                      </div>
                    )
                  })}
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
                    <Avatar id={f.friend_id} name={displayName(f)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-900 dark:text-white">{displayName(f)}</div>
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
