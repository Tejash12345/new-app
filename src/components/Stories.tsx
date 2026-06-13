import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, X, Eye, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/utils'

const STORY_MS = 5000

type Story = {
  id: string
  user_id: string
  author_name: string
  author_avatar_url: string
  media_url: string
  caption: string
  created_at: string
  expires_at: string
}
type StoryView = {
  id: string
  story_id: string
  viewer_id: string
  viewer_name: string
  viewer_avatar_url: string
  created_at: string
}
type Group = {
  user_id: string
  author_name: string
  author_avatar_url: string
  stories: Story[]
  allSeen: boolean
}

function initialOf(name: string) {
  return (name || '?').slice(0, 1).toUpperCase()
}

/** Small circular avatar used in the bar and viewer lists. */
function Pic({ url, name, className }: { url?: string; name: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand-400 to-brand-600 font-bold text-white', className)}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initialOf(name)}
    </div>
  )
}

function buildGroups(stories: Story[], seen: Set<string>, myId?: string): Group[] {
  const byUser = new Map<string, Story[]>()
  for (const s of stories) {
    const arr = byUser.get(s.user_id) ?? []
    arr.push(s)
    byUser.set(s.user_id, arr)
  }
  const groups: Group[] = []
  byUser.forEach((list, uid) => {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const last = list[list.length - 1]
    groups.push({
      user_id: uid,
      author_name: last.author_name,
      author_avatar_url: last.author_avatar_url,
      stories: list,
      allSeen: list.every((s) => seen.has(s.id)),
    })
  })
  groups.sort((a, b) => {
    if (a.user_id === myId) return -1
    if (b.user_id === myId) return 1
    if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1
    return b.stories[b.stories.length - 1].created_at.localeCompare(a.stories[a.stories.length - 1].created_at)
  })
  return groups
}

export function StoriesBar() {
  const { user, profile } = useAuth()
  const [stories, setStories] = useState<Story[]>([])
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [openAt, setOpenAt] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [missing, setMissing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const myName = profile?.full_name?.trim() || profile?.email?.split('@')[0] || 'Student'
  const myAvatar = profile?.avatar_url || ''

  async function load() {
    if (!user) return
    const nowIso = new Date().toISOString()
    const { data, error } = await supabase
      .from('stories').select('*').gt('expires_at', nowIso).order('created_at', { ascending: true })
    if (error) { setMissing(true); return }
    setMissing(false)
    setStories((data as Story[]) ?? [])
    const { data: views } = await supabase.from('story_views').select('story_id').eq('viewer_id', user.id)
    setSeen(new Set(((views as { story_id: string }[]) ?? []).map((v) => v.story_id)))
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 10 * 1024 * 1024) { alert('Image too big — 10 MB max.'); return }
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').replace(/[^\w]+/g, '').slice(0, 5) || 'jpg'
      const path = `${user.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('stories').upload(path, file, { contentType: file.type || undefined })
      if (upErr) {
        alert(/bucket.*not.*found/i.test(upErr.message) ? 'Stories storage missing — run upgrade-14.sql in Supabase first.' : `Upload failed: ${upErr.message}`)
        return
      }
      const url = supabase.storage.from('stories').getPublicUrl(path).data.publicUrl
      const { error: insErr } = await supabase.from('stories').insert({
        user_id: user.id, author_name: myName, author_avatar_url: myAvatar, media_url: url, caption: '',
      })
      if (insErr) { alert(`Could not post story: ${insErr.message}`); return }
      await load()
    } finally {
      setUploading(false)
    }
  }

  if (missing) return null
  const groups = buildGroups(stories, seen, user?.id)
  const myGroup = groups.find((g) => g.user_id === user?.id)
  const others = groups.filter((g) => g.user_id !== user?.id)

  return (
    <div className="mb-5 -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {/* your story */}
      <button
        onClick={() => (myGroup ? setOpenAt(groups.indexOf(myGroup)) : fileRef.current?.click())}
        className="flex w-16 shrink-0 flex-col items-center gap-1"
      >
        <div className="relative">
          <div className={cn('rounded-full p-[2.5px]', myGroup && !myGroup.allSeen
            ? 'bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-500' : 'bg-slate-300 dark:bg-white/20')}>
            <div className="rounded-full bg-white p-[2px] dark:bg-slate-900">
              <Pic url={myAvatar} name={myName} className="h-14 w-14 text-lg" />
            </div>
          </div>
          <span
            onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
            className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-brand-500 text-white dark:border-slate-900"
          >
            {uploading ? <span className="text-[9px]">…</span> : <Plus size={12} />}
          </span>
        </div>
        <span className="w-full truncate text-center text-[11px] text-slate-500">Your story</span>
      </button>

      {/* others */}
      {others.map((g) => (
        <button key={g.user_id} onClick={() => setOpenAt(groups.indexOf(g))} className="flex w-16 shrink-0 flex-col items-center gap-1">
          <div className={cn('rounded-full p-[2.5px]', g.allSeen ? 'bg-slate-300 dark:bg-white/20'
            : 'bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-500')}>
            <div className="rounded-full bg-white p-[2px] dark:bg-slate-900">
              <Pic url={g.author_avatar_url} name={g.author_name} className="h-14 w-14 text-lg" />
            </div>
          </div>
          <span className="w-full truncate text-center text-[11px] text-slate-500">{g.author_name.split(' ')[0]}</span>
        </button>
      ))}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      <AnimatePresence>
        {openAt !== null && groups[openAt] && (
          <StoryViewer
            groups={groups}
            start={openAt}
            myId={user?.id}
            myName={myName}
            myAvatar={myAvatar}
            onSeen={(id) => setSeen((s) => new Set(s).add(id))}
            onClose={() => { setOpenAt(null); load() }}
            onDeleted={() => { setOpenAt(null); load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function StoryViewer({
  groups, start, myId, myName, myAvatar, onSeen, onClose, onDeleted,
}: {
  groups: Group[]; start: number; myId?: string; myName: string; myAvatar: string
  onSeen: (id: string) => void; onClose: () => void; onDeleted: () => void
}) {
  const [gi, setGi] = useState(start)
  const [si, setSi] = useState(0)
  const [paused, setPaused] = useState(false)
  const [viewers, setViewers] = useState<StoryView[] | null>(null)
  const group = groups[gi]
  const story = group?.stories[si]
  const mine = story?.user_id === myId

  function go(ngi: number, nsi: number) { setGi(ngi); setSi(nsi); setViewers(null) }
  function next() {
    if (!group) return
    if (si < group.stories.length - 1) go(gi, si + 1)
    else if (gi < groups.length - 1) go(gi + 1, 0)
    else onClose()
  }
  function prev() {
    if (si > 0) go(gi, si - 1)
    else if (gi > 0) go(gi - 1, 0)
  }

  // record a view (not your own) when a story is shown
  useEffect(() => {
    if (!story || mine || !myId) return
    onSeen(story.id)
    supabase.from('story_views').upsert(
      { story_id: story.id, viewer_id: myId, viewer_name: myName, viewer_avatar_url: myAvatar },
      { onConflict: 'story_id,viewer_id', ignoreDuplicates: true },
    ).then(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id])

  // auto-advance
  useEffect(() => {
    if (!story || paused || viewers !== null) return
    const t = setTimeout(next, STORY_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, paused, viewers])

  async function openViewers() {
    if (!story) return
    setPaused(true)
    const { data } = await supabase.from('story_views').select('*')
      .eq('story_id', story.id).order('created_at', { ascending: false })
    setViewers((data as StoryView[]) ?? [])
  }
  async function del() {
    if (!story) return
    if (!confirm('Delete this story?')) return
    await supabase.from('stories').delete().eq('id', story.id)
    onDeleted()
  }

  if (!story) return null

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="relative h-full w-full max-w-md">
        {/* progress bars */}
        <div className="absolute left-2 right-2 top-2 z-10 flex gap-1">
          {group.stories.map((s, idx) => (
            <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <motion.div
                className="h-full bg-white"
                initial={{ width: idx < si ? '100%' : '0%' }}
                animate={{ width: idx < si ? '100%' : idx > si ? '0%' : (paused || viewers !== null ? '40%' : '100%') }}
                transition={{ duration: idx === si && !paused && viewers === null ? STORY_MS / 1000 : 0, ease: 'linear' }}
              />
            </div>
          ))}
        </div>

        {/* header */}
        <div className="absolute left-3 right-3 top-5 z-10 flex items-center gap-2.5">
          <Pic url={story.author_avatar_url} name={story.author_name} className="h-9 w-9 text-sm ring-2 ring-white/40" />
          <div className="flex-1 truncate text-sm font-bold text-white drop-shadow">{story.author_name}</div>
          {mine && (
            <button onClick={del} className="rounded-full p-1.5 text-white/90 hover:bg-white/15"><Trash2 size={18} /></button>
          )}
          <button onClick={onClose} className="rounded-full p-1.5 text-white hover:bg-white/15"><X size={20} /></button>
        </div>

        {/* media */}
        <img src={story.media_url} alt="" className="h-full w-full object-contain" />

        {story.caption && (
          <div className="absolute bottom-24 left-4 right-4 text-center text-sm font-medium text-white drop-shadow">{story.caption}</div>
        )}

        {/* tap zones */}
        <button aria-label="Previous" onClick={prev} className="absolute left-0 top-12 bottom-20 w-1/3" />
        <button aria-label="Next" onClick={next} className="absolute right-0 top-12 bottom-20 w-1/3" />
        <button onClick={prev} className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-1 text-white sm:block"><ChevronLeft size={22} /></button>
        <button onClick={next} className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/15 p-1 text-white sm:block"><ChevronRight size={22} /></button>

        {/* seen-by (author only) */}
        {mine && (
          <button onClick={openViewers} className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
            <Eye size={16} /> Seen by
          </button>
        )}
      </div>

      {/* viewers sheet */}
      <AnimatePresence>
        {viewers !== null && (
          <motion.div
            className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-md rounded-t-3xl bg-slate-900 p-5 text-white"
            initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold"><Eye size={18} /> Seen by {viewers.length}</div>
              <button onClick={() => { setViewers(null); setPaused(false) }} className="rounded-full p-1.5 hover:bg-white/10"><X size={18} /></button>
            </div>
            {viewers.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/60">No views yet.</p>
            ) : (
              <div className="max-h-64 space-y-2.5 overflow-y-auto">
                {viewers.map((v) => (
                  <div key={v.id} className="flex items-center gap-3">
                    <Pic url={v.viewer_avatar_url} name={v.viewer_name} className="h-9 w-9 text-sm" />
                    <span className="text-sm font-semibold">{v.viewer_name}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
