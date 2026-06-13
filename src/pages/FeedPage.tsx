import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Heart, MessageCircle, Trash2, Plus, Film, FileText, Send,
  Camera, Briefcase, Sparkles, X, Play, Share2, ArrowLeft, Eye,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getSocket } from '../lib/socket'
import { pushNotification } from '../lib/notify'
import { useAuth } from '../hooks/useAuth'
import { useAvatars } from '../hooks/useAvatars'
import { FEED_CATEGORIES, type FeedPost, type FeedComment, type FeedType, type FeedCategory } from '../lib/types'
import { GlassCard, Page, Input, TextArea, Button, Empty, Modal } from '../components/ui'
import { cn, timeAgo } from '../lib/utils'

// ---------- on-topic helpers (tech · biology · medical) ----------

// keyword map used to auto-suggest a category and to keep the feed on-topic
const CATEGORY_HINTS: Record<FeedCategory, string[]> = {
  // technology
  'AI & ML': ['ai', 'ml', 'machine learning', 'llm', 'gpt', 'neural net', 'deep learning', 'openai', 'claude', 'gemini'],
  'Web Dev': ['react', 'vue', 'angular', 'next', 'css', 'html', 'frontend', 'backend', 'node', 'web', 'tailwind', 'vite'],
  'Mobile': ['android', 'ios', 'flutter', 'swift', 'kotlin', 'react native', 'mobile app'],
  'Cloud & DevOps': ['aws', 'azure', 'gcp', 'docker', 'kubernetes', 'devops', 'ci/cd', 'terraform', 'cloud', 'serverless'],
  'Cybersecurity': ['security', 'hacking', 'pentest', 'vulnerability', 'cve', 'encryption', 'malware', 'infosec', 'cyber'],
  'Data': ['data', 'sql', 'analytics', 'pandas', 'database', 'bigquery', 'etl', 'warehouse', 'spark'],
  'Programming': ['python', 'javascript', 'typescript', 'java', 'rust', 'golang', 'c++', 'code', 'algorithm', 'programming', 'git'],
  'Gadgets': ['gadget', 'iphone', 'laptop', 'gpu', 'chip', 'hardware', 'device', 'wearable', 'review'],
  'Blockchain': ['blockchain', 'crypto', 'web3', 'ethereum', 'bitcoin', 'solidity', 'smart contract', 'nft'],
  // biology
  'Biology': ['biology', 'cell', 'organism', 'ecology', 'evolution', 'species', 'protein', 'enzyme', 'microbio', 'botany', 'zoology'],
  'Genetics': ['gene', 'genetic', 'genome', 'crispr', 'dna', 'rna', 'mutation', 'heredity', 'chromosome'],
  'Neuroscience': ['brain', 'neuron', 'neuro', 'cognitive', 'synapse', 'nervous system', 'neural'],
  'Biotech': ['biotech', 'bioinformatics', 'gene editing', 'vaccine', 'lab', 'sequencing', 'stem cell'],
  // medical
  'Medicine': ['medicine', 'clinical', 'disease', 'treatment', 'diagnosis', 'drug', 'patient', 'therapy', 'symptom', 'medical', 'surgery'],
  'Healthcare': ['healthcare', 'hospital', 'nurse', 'doctor', 'health', 'wellness', 'public health', 'medtech', 'anatomy'],
  // misc
  'Startups': ['startup', 'founder', 'saas', 'product', 'funding', 'venture', 'launch', 'mvp'],
}
const ALL_TOPIC_WORDS = Object.values(CATEGORY_HINTS).flat()

/** Light guard: does this text look like an allowed (tech/bio/medical) topic? */
function looksOnTopic(text: string) {
  const t = text.toLowerCase()
  return ALL_TOPIC_WORDS.some((w) => t.includes(w))
}

/** Suggest the best-fit category for some text. */
function suggestCategory(text: string): FeedCategory | null {
  const t = text.toLowerCase()
  let best: FeedCategory | null = null
  let bestScore = 0
  for (const cat of FEED_CATEGORIES) {
    const score = CATEGORY_HINTS[cat].filter((w) => t.includes(w)).length
    if (score > bestScore) { bestScore = score; best = cat }
  }
  return best
}

// ---------- embed url parsing ----------

function instagramEmbedUrl(raw: string): string | null {
  const m = raw.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)
  if (!m) return null
  // always embed via the canonical /p/<shortcode>/embed form — the
  // /reel/.../embed path often renders Instagram's "content removed" error
  return `https://www.instagram.com/p/${m[1]}/embed`
}

function linkedinEmbedUrl(raw: string): string | null {
  if (/linkedin\.com\/embed\/feed\/update\//i.test(raw)) return raw.split('?')[0]
  const urn = raw.match(/urn:li:(activity|share|ugcPost):(\d+)/i)
  if (urn) return `https://www.linkedin.com/embed/feed/update/urn:li:${urn[1]}:${urn[2]}`
  const act = raw.match(/activity[:-](\d{10,})/i)
  if (act) return `https://www.linkedin.com/embed/feed/update/urn:li:activity:${act[1]}`
  return null
}

// ---------- small avatar ----------
function avatarColor(id: string) {
  const colors = ['#6C8CFF', '#FF6584', '#00BFA6', '#FFB454', '#A76CFF', '#42C7F5']
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return colors[Math.abs(h) % colors.length]
}
function Avatar({ id, name, url, size = 9 }: { id: string; name: string; url?: string | null; size?: number }) {
  const px = size * 4
  return (
    <div className="flex items-center justify-center overflow-hidden rounded-full font-bold text-white shrink-0"
      style={{ background: avatarColor(id), height: px, width: px, fontSize: px * 0.42 }}>
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : (name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

const CAT_TINT: Record<string, string> = {
  'AI & ML': '#A76CFF', 'Web Dev': '#6C8CFF', 'Mobile': '#00BFA6',
  'Cloud & DevOps': '#42C7F5', 'Cybersecurity': '#FF6584', 'Data': '#FFB454',
  'Programming': '#6C8CFF', 'Gadgets': '#8E8E93', 'Blockchain': '#F7931A',
  'Biology': '#34C759', 'Genetics': '#30B0C7', 'Neuroscience': '#AF52DE', 'Biotech': '#00BFA6',
  'Medicine': '#FF3B30', 'Healthcare': '#FF6584', 'Startups': '#FF9F0A',
}
const CAT_EMOJI: Record<string, string> = {
  'AI & ML': '🤖', 'Web Dev': '🌐', 'Mobile': '📱', 'Cloud & DevOps': '☁️',
  'Cybersecurity': '🔐', 'Data': '📊', 'Programming': '⌨️', 'Gadgets': '🔌', 'Blockchain': '⛓️',
  'Biology': '🧬', 'Genetics': '🧬', 'Neuroscience': '🧠', 'Biotech': '🔬',
  'Medicine': '⚕️', 'Healthcare': '🏥', 'Startups': '🚀',
}
function CategoryChip({ cat }: { cat: string }) {
  const tint = CAT_TINT[cat] ?? '#6C8CFF'
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      style={{ background: `${tint}22`, color: tint }}>
      <span>{CAT_EMOJI[cat] ?? '🏷️'}</span> {cat}
    </span>
  )
}

type TabKey = 'all' | 'reel' | 'post' | 'instagram' | 'linkedin'
const TABS: { key: TabKey; label: string; icon: typeof Film }[] = [
  { key: 'all', label: 'For You', icon: Sparkles },
  { key: 'reel', label: 'Reels', icon: Film },
  { key: 'post', label: 'Posts', icon: FileText },
  { key: 'instagram', label: 'Instagram', icon: Camera },
  { key: 'linkedin', label: 'LinkedIn', icon: Briefcase },
]

// shareable link: external embeds share their original URL, user content
// shares an in-app deep link that opens the exact post
function shareUrlFor(post: FeedPost) {
  if ((post.type === 'instagram' || post.type === 'linkedin') && post.embed_url) return post.embed_url
  return `${window.location.origin}/feed?post=${post.id}`
}

export function FeedPage() {
  const { user, profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusId = searchParams.get('post')

  const [posts, setPosts] = useState<FeedPost[]>([])
  const [likes, setLikes] = useState<{ id?: string; post_id: string; user_id: string }[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const myName = profile?.full_name?.trim() || profile?.email?.split('@')[0] || 'Student'
  // notification bookkeeping — don't notify for activity that already existed
  const seenLikes = useRef<Set<string>>(new Set())
  const seenComments = useRef<Set<string>>(new Set())
  const primed = useRef(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('all')
  const [cat, setCat] = useState<'All' | FeedCategory>('All')
  const [composerOpen, setComposerOpen] = useState(false)
  const [commentsFor, setCommentsFor] = useState<FeedPost | null>(null)
  const [needsUpgrade, setNeedsUpgrade] = useState(false)
  const [focusPost, setFocusPost] = useState<FeedPost | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flash(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }

  async function load() {
    const { data, error } = await supabase
      .from('feed_posts').select('*').order('created_at', { ascending: false }).limit(300)
    if (error) {
      if (/relation .* does not exist|feed_posts/i.test(error.message)) setNeedsUpgrade(true)
      setLoading(false)
      return
    }
    const postsData = (data as FeedPost[]) ?? []
    setPosts(postsData)
    const [{ data: l }, { data: c }] = await Promise.all([
      supabase.from('feed_likes').select('id, post_id, user_id'),
      supabase.from('feed_comments').select('id, post_id, user_id, author_name, author_avatar_url'),
    ])
    const likesData = (l as { id: string; post_id: string; user_id: string }[]) ?? []
    const commentsData = (c as { id: string; post_id: string; user_id: string; author_name: string; author_avatar_url: string }[]) ?? []
    setLikes(likesData)
    const counts: Record<string, number> = {}
    for (const row of commentsData) counts[row.post_id] = (counts[row.post_id] ?? 0) + 1
    setCommentCounts(counts)

    // notify me about new likes/comments on MY posts (by other people)
    const myPostIds = new Set(postsData.filter((p) => p.user_id === user?.id).map((p) => p.id))
    if (primed.current) {
      for (const lk of likesData) {
        if (lk.user_id !== user?.id && myPostIds.has(lk.post_id) && !seenLikes.current.has(lk.id)) {
          pushNotification('❤️ New like', 'Someone liked your post in the Feed.', `like-${lk.id}`)
        }
      }
      for (const cm of commentsData) {
        if (cm.user_id !== user?.id && myPostIds.has(cm.post_id) && !seenComments.current.has(cm.id)) {
          pushNotification('💬 New comment', `${cm.author_name} commented on your post.`, `cmt-${cm.id}`)
        }
      }
    }
    likesData.forEach((x) => seenLikes.current.add(x.id))
    commentsData.forEach((x) => seenComments.current.add(x.id))
    primed.current = true
    setLoading(false)
  }

  useEffect(() => {
    if (!user) return
    load()
    const ch = supabase
      .channel('feed-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_posts' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_likes' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_comments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // socket.io fast path — instant refresh + owner notifications when the
  // realtime server is configured (falls back silently to Supabase realtime)
  useEffect(() => {
    if (!user) return
    const s = getSocket()
    if (!s) return
    const onChanged = () => load()
    const onActivity = (p: { type: string; actor: string; title: string }) => {
      pushNotification(
        p.type === 'like' ? '❤️ New like' : '💬 New comment',
        `${p.actor} ${p.type === 'like' ? 'liked' : 'commented on'} ${p.title}.`,
        `feed-act-${p.type}`,
      )
      load()
    }
    s.on('feed:changed', onChanged)
    s.on('feed:activity', onActivity)
    return () => { s.off('feed:changed', onChanged); s.off('feed:activity', onActivity) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // count a view once per session when an item scrolls into view
  async function registerView(post: FeedPost) {
    const key = `flv-${post.id}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* ignore */ }
    setPosts((ps) => ps.map((p) => (p.id === post.id ? { ...p, views: (p.views ?? 0) + 1 } : p)))
    await supabase.rpc('bump_feed_view', { pid: post.id })
  }

  // resolve a shared ?post=<id> deep link (fetch it if it isn't already loaded)
  useEffect(() => {
    if (!focusId) { setFocusPost(null); return }
    const found = posts.find((p) => p.id === focusId)
    if (found) { setFocusPost(found); return }
    supabase.from('feed_posts').select('*').eq('id', focusId).maybeSingle()
      .then(({ data }) => setFocusPost((data as FeedPost) ?? null))
  }, [focusId, posts])

  const likeCount = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of likes) m[l.post_id] = (m[l.post_id] ?? 0) + 1
    return m
  }, [likes])
  const likedByMe = useMemo(
    () => new Set(likes.filter((l) => l.user_id === user?.id).map((l) => l.post_id)),
    [likes, user?.id],
  )

  async function toggleLike(post: FeedPost) {
    if (!user) return
    const mine = likedByMe.has(post.id)
    setLikes((prev) => mine
      ? prev.filter((l) => !(l.post_id === post.id && l.user_id === user.id))
      : [...prev, { post_id: post.id, user_id: user.id }])
    if (mine) {
      await supabase.from('feed_likes').delete().eq('post_id', post.id).eq('user_id', user.id)
    } else {
      await supabase.from('feed_likes').insert({ post_id: post.id, user_id: user.id })
      if (post.user_id !== user.id) {
        getSocket()?.emit('feed:activity', {
          to: post.user_id, type: 'like', actor: myName, title: post.title || 'your post',
        })
      }
    }
  }

  async function removePost(post: FeedPost) {
    setPosts((p) => p.filter((x) => x.id !== post.id))
    await supabase.from('feed_posts').delete().eq('id', post.id)
    if (focusPost?.id === post.id) setSearchParams({})
  }

  async function sharePost(post: FeedPost) {
    const url = shareUrlFor(post)
    const title = post.title || `${post.author_name}'s ${post.type}`
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (nav.share) {
      try { await nav.share({ title, text: post.body || title, url }); return }
      catch { return } // user dismissed the share sheet
    }
    try { await navigator.clipboard.writeText(url); flash('Link copied!') }
    catch { flash(url) }
  }

  const cardProps = (p: FeedPost) => ({
    liked: likedByMe.has(p.id),
    likeCount: likeCount[p.id] ?? 0,
    commentCount: commentCounts[p.id] ?? 0,
    canDelete: p.user_id === user?.id || profile?.role === 'admin',
    onLike: () => toggleLike(p),
    onComment: () => setCommentsFor(p),
    onDelete: () => removePost(p),
    onShare: () => sharePost(p),
    onView: () => registerView(p),
  })

  function handlePosted() {
    getSocket()?.emit('feed:new', { user_id: user?.id })
    load()
  }

  function emitCommentActivity(post: FeedPost) {
    if (post.user_id !== user?.id) {
      getSocket()?.emit('feed:activity', {
        to: post.user_id, type: 'comment', actor: myName, title: post.title || 'your post',
      })
    }
  }

  // instant comment-count update (before the refetch / realtime catch up)
  function bumpCommentCount(postId: string, delta: number) {
    setCommentCounts((c) => ({ ...c, [postId]: Math.max(0, (c[postId] ?? 0) + delta) }))
  }

  if (needsUpgrade) {
    return (
      <Page title="Feed" subtitle="Reels & posts — tech · biology · medical 🦁">
        <GlassCard>
          <Empty emoji="🛠️" text={'The feed needs its database tables.\nRun supabase/upgrade-9.sql in the Supabase SQL Editor, then refresh.'} />
        </GlassCard>
      </Page>
    )
  }

  // ----- shared single-post view (deep link) -----
  if (focusId) {
    return (
      <Page title="Shared post" subtitle="Someone shared this with you 🦁">
        <button onClick={() => setSearchParams({})}
          className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-brand-500">
          <ArrowLeft size={16} /> Back to feed
        </button>
        <div className="mx-auto max-w-xl">
          {focusPost ? (
            <FeedCard post={focusPost} {...cardProps(focusPost)} />
          ) : (
            <GlassCard><Empty emoji="🔍" text={'This post could not be found.\nIt may have been deleted.'} /></GlassCard>
          )}
        </div>
        {commentsFor && <CommentsModal post={commentsFor} onClose={() => setCommentsFor(null)} onChanged={load} onAdded={() => emitCommentActivity(commentsFor)} onCountChange={(d) => bumpCommentCount(commentsFor.id, d)} />}
        <Toast msg={toast} />
      </Page>
    )
  }

  const filtered = posts.filter((p) =>
    (tab === 'all' || p.type === tab) && (cat === 'All' || p.category === cat))

  return (
    <Page
      title="Feed"
      subtitle="Reels & posts — tech · biology · medical 🦁"
      actions={<Button onClick={() => setComposerOpen(true)}><Plus size={16} /> Create</Button>}
    >
      {/* type tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 rounded-2xl px-3.5 py-2 text-sm font-bold transition',
              tab === key ? 'bg-gradient-to-r from-brand-500 to-purple-500 text-white shadow-lg shadow-brand-500/30'
                : 'glass text-slate-600 dark:text-slate-300')}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* category filter */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {(['All', ...FEED_CATEGORIES] as const).map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={cn('rounded-full px-3 py-1 text-xs font-semibold transition',
              cat === c ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-400/15 text-slate-600 dark:bg-white/10 dark:text-slate-300 hover:bg-slate-400/25')}>
            {c === 'All' ? 'All' : `${CAT_EMOJI[c] ?? ''} ${c}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-4xl animate-pulse">🦁</div>
      ) : filtered.length === 0 ? (
        <GlassCard>
          <Empty emoji="📡" text={'Nothing here yet.\nTap Create to share a reel, post, or embed an Instagram reel / LinkedIn post.'} />
        </GlassCard>
      ) : tab === 'reel' ? (
        <div className="mx-auto flex max-w-md flex-col gap-6">
          {filtered.map((p) => <FeedCard key={p.id} post={p} reelMode {...cardProps(p)} />)}
        </div>
      ) : (
        <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5">
          {filtered.map((p) => (
            <div key={p.id} className="break-inside-avoid">
              <FeedCard post={p} {...cardProps(p)} />
            </div>
          ))}
        </div>
      )}

      <Composer open={composerOpen} onClose={() => setComposerOpen(false)} onPosted={handlePosted} />
      {commentsFor && <CommentsModal post={commentsFor} onClose={() => setCommentsFor(null)} onChanged={load} />}
      <Toast msg={toast} />
    </Page>
  )
}

function Toast({ msg }: { msg: string | null }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg dark:bg-white dark:text-slate-900">
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// autoplay (muted) while on screen, pause when scrolled away — like reels apps
function AutoVideo({ src, reelMode }: { src: string; reelMode?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) v.play().catch(() => {})
          else v.pause()
        }
      },
      { threshold: [0, 0.6, 1] },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [])
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      controls
      preload="metadata"
      className={cn('w-full bg-black object-contain', reelMode ? 'max-h-[70vh]' : 'max-h-96')}
    />
  )
}

// ================= one feed item =================
function FeedCard({
  post, reelMode, liked, likeCount, commentCount, canDelete, onLike, onComment, onDelete, onShare, onView,
}: {
  post: FeedPost; reelMode?: boolean; liked: boolean; likeCount: number; commentCount: number
  canDelete: boolean; onLike: () => void; onComment: () => void; onDelete: () => void; onShare: () => void
  onView: () => void
}) {
  const avatarFor = useAvatars()
  const igEmbed = post.type === 'instagram' && post.embed_url ? instagramEmbedUrl(post.embed_url) : null
  const liEmbed = post.type === 'linkedin' && post.embed_url ? linkedinEmbedUrl(post.embed_url) : null

  // count a view the first time at least half the card is on screen
  const cardRef = useRef<HTMLDivElement>(null)
  const viewedRef = useRef(false)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !viewedRef.current) {
          viewedRef.current = true
          onView()
          io.disconnect()
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id])

  return (
    <GlassCard ref={cardRef} className="!p-0 overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <Avatar id={post.user_id} name={post.author_name} url={avatarFor(post.user_id) || post.author_avatar_url} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{post.author_name}</div>
          <div className="text-[11px] text-slate-400">{timeAgo(post.created_at)}</div>
        </div>
        <CategoryChip cat={post.category} />
        {canDelete && (
          <button onClick={onDelete} title="Delete"
            className="rounded-full p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {/* title / body */}
      {(post.title || post.body) && (
        <div className="px-4 pt-2.5">
          {post.title && <div className="font-bold text-slate-900 dark:text-white">{post.title}</div>}
          {post.body && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{post.body}</p>}
        </div>
      )}

      {/* media */}
      <div className="mt-3">
        {post.type === 'reel' && post.media_url && (
          <AutoVideo src={post.media_url} reelMode={reelMode} />
        )}
        {post.type === 'post' && post.media_url && (
          <img src={post.media_url} alt={post.title || 'post image'} loading="lazy" className="w-full object-cover" />
        )}
        {post.type === 'instagram' && (
          igEmbed ? (
            <iframe src={igEmbed} title="Instagram" loading="lazy"
              allow="autoplay; encrypted-media; picture-in-picture"
              className="w-full" style={{ height: 560, border: 0 }} scrolling="no" allowTransparency />
          ) : <BrokenEmbed url={post.embed_url} kind="Instagram" />
        )}
        {post.type === 'linkedin' && (
          liEmbed ? (
            <iframe src={liEmbed} title="LinkedIn" loading="lazy"
              allow="autoplay; encrypted-media; picture-in-picture"
              className="w-full" style={{ height: 560, border: 0 }} allowFullScreen />
          ) : <BrokenEmbed url={post.embed_url} kind="LinkedIn" />
        )}
      </div>

      {/* tags */}
      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {post.tags.map((t) => <span key={t} className="text-xs font-semibold text-brand-500">#{t}</span>)}
        </div>
      )}

      {/* actions */}
      <div className="flex items-center gap-1 px-3 py-3">
        <button onClick={onLike}
          className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition',
            liked ? 'text-rose-500' : 'text-slate-500 hover:bg-slate-500/10 dark:text-slate-400')}>
          <Heart size={17} className={liked ? 'fill-rose-500' : ''} /> {likeCount > 0 ? likeCount : ''}
        </button>
        <button onClick={onComment}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-500/10 dark:text-slate-400">
          <MessageCircle size={17} /> {commentCount > 0 ? commentCount : ''}
        </button>
        <button onClick={onShare} title="Share"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-500/10 hover:text-brand-500 dark:text-slate-400">
          <Share2 size={16} /> Share
        </button>
        <span title="Views" className="ml-auto flex items-center gap-1 px-2 text-xs font-semibold text-slate-400">
          <Eye size={15} /> {post.views ?? 0}
        </span>
      </div>
    </GlassCard>
  )
}

function BrokenEmbed({ url, kind }: { url: string | null; kind: string }) {
  return (
    <div className="mx-4 mb-2 rounded-2xl bg-amber-400/10 px-4 py-6 text-center">
      <div className="text-3xl">🔗</div>
      <p className="mt-2 text-sm font-semibold text-amber-600 dark:text-amber-300">Couldn't read this {kind} link.</p>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-500 underline">
          Open on {kind} ↗
        </a>
      )}
    </div>
  )
}

// ================= composer =================
function Composer({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const { user, profile } = useAuth()
  const [type, setType] = useState<FeedType>('post')
  const [category, setCategory] = useState<FeedCategory>('Programming')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const authorName = profile?.full_name?.trim() || profile?.email?.split('@')[0] || 'Student'

  function reset() {
    setType('post'); setCategory('Programming'); setTitle(''); setBody('')
    setTags(''); setUrl(''); setFile(null); setError(null); setBusy(false)
  }

  // auto-suggest a category as the user types
  useEffect(() => {
    const guess = suggestCategory(`${title} ${body} ${tags}`)
    if (guess) setCategory(guess)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, tags])

  async function submit() {
    if (!user) return
    setError(null)

    if (type === 'post' && !body.trim() && !file) { setError('Write something or add an image.'); return }
    if (type === 'reel' && !file) { setError('Pick a video to upload for your reel.'); return }
    if (type === 'instagram' && !instagramEmbedUrl(url)) { setError('Paste a valid Instagram reel/post link.'); return }
    if (type === 'linkedin' && !linkedinEmbedUrl(url)) { setError('Paste a valid LinkedIn post link (or its embed link).'); return }

    // on-topic guard for written content
    const text = `${title} ${body} ${tags}`.trim()
    if ((type === 'post' || type === 'reel') && text && !looksOnTopic(text)) {
      setError('This feed is for technology, biology & medical topics — mention the subject (e.g. React, DNA, clinical trial) so it fits a category.')
      return
    }

    setBusy(true)
    let media_url: string | null = null
    if (file) {
      if (file.size > 50 * 1024 * 1024) { setError('File too big — 50 MB max.'); setBusy(false); return }
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
      const path = `${user.id}/${Date.now()}-${safe}`
      const { error: upErr } = await supabase.storage
        .from('feed-media').upload(path, file, { contentType: file.type || undefined })
      if (upErr) {
        setBusy(false)
        setError(/bucket.*not.*found/i.test(upErr.message)
          ? 'Media storage missing — run upgrade-9.sql in Supabase first.'
          : `Upload failed: ${upErr.message}`)
        return
      }
      media_url = supabase.storage.from('feed-media').getPublicUrl(path).data.publicUrl
    }

    const tagArr = tags.split(/[,#\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6)
    const { error: insErr } = await supabase.from('feed_posts').insert({
      user_id: user.id,
      author_name: authorName,
      author_avatar_url: profile?.avatar_url || '',
      type,
      category,
      title: title.trim(),
      body: body.trim(),
      media_url,
      embed_url: (type === 'instagram' || type === 'linkedin') ? url.trim() : null,
      tags: tagArr,
    })
    setBusy(false)
    if (insErr) { setError(insErr.message); return }
    reset()
    onClose()
    onPosted()
  }

  const TYPES: { key: FeedType; label: string; icon: typeof Film }[] = [
    { key: 'post', label: 'Post', icon: FileText },
    { key: 'reel', label: 'Reel', icon: Film },
    { key: 'instagram', label: 'Instagram', icon: Camera },
    { key: 'linkedin', label: 'LinkedIn', icon: Briefcase },
  ]

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="Share to the Feed" wide>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {TYPES.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setType(key); setFile(null); setError(null) }}
            className={cn('flex flex-col items-center gap-1 rounded-2xl py-3 text-xs font-bold transition',
              type === key ? 'bg-gradient-to-br from-brand-500 to-purple-500 text-white'
                : 'bg-slate-400/10 text-slate-600 dark:bg-white/5 dark:text-slate-300 hover:bg-slate-400/20')}>
            <Icon size={18} /> {label}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-400">Category</label>
      <select value={category} onChange={(e) => setCategory(e.target.value as FeedCategory)}
        className="mb-3 w-full rounded-2xl border border-slate-200/60 bg-white/70 px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-brand-400/60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:[&>option]:bg-slate-800">
        {FEED_CATEGORIES.map((c) => <option key={c} value={c}>{`${CAT_EMOJI[c] ?? ''} ${c}`}</option>)}
      </select>

      {(type === 'instagram' || type === 'linkedin') && (
        <div className="mb-3">
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-400">
            {type === 'instagram' ? 'Instagram reel / post link' : 'LinkedIn post link'}
          </label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder={type === 'instagram'
              ? 'https://www.instagram.com/reel/XXXXXXXXXXX/'
              : 'https://www.linkedin.com/posts/...activity-XXXXXXXXXXXXXXXXXX'} />
          <p className="mt-1 text-[11px] text-slate-400">
            {type === 'instagram'
              ? 'Paste the share link of any reel/post — it embeds with Instagram’s official player.'
              : 'Use the post’s “Copy link”, or its “Embed this post” link from LinkedIn.'}
          </p>
        </div>
      )}

      {type !== 'instagram' && type !== 'linkedin' && (
        <Input className="mb-3" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)" maxLength={120} />
      )}

      <TextArea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={type === 'reel' ? 'Caption your reel…'
          : (type === 'instagram' || type === 'linkedin') ? 'Add a note (optional)…'
          : 'Share a tip, news, or question about tech, biology or medicine…'} maxLength={1000} />

      {(type === 'post' || type === 'reel') && (
        <div className="mt-3">
          <input ref={fileRef} type="file" hidden
            accept={type === 'reel' ? 'video/*' : 'image/*'}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-3 text-sm font-semibold text-slate-500 hover:bg-slate-500/5 dark:border-white/15">
            {type === 'reel' ? <Play size={16} /> : <FileText size={16} />}
            {file ? file.name : (type === 'reel' ? 'Choose a video (max 50 MB)' : 'Add an image (optional)')}
          </button>
          {file && (
            <button onClick={() => setFile(null)} className="mt-1 flex items-center gap-1 text-xs text-rose-500">
              <X size={12} /> remove
            </button>
          )}
        </div>
      )}

      <Input className="mt-3" value={tags} onChange={(e) => setTags(e.target.value)}
        placeholder="Tags: react, dna, cardiology" />

      {error && (
        <div className="mt-3 rounded-2xl bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-500">{error}</div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Sharing…' : <><Send size={15} /> Share</>}
        </Button>
      </div>
    </Modal>
  )
}

// ================= comments =================
function CommentsModal({ post, onClose, onChanged, onAdded, onCountChange }: { post: FeedPost; onClose: () => void; onChanged: () => void; onAdded?: () => void; onCountChange?: (delta: number) => void }) {
  const { user, profile } = useAuth()
  const avatarFor = useAvatars()
  const [comments, setComments] = useState<FeedComment[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const authorName = profile?.full_name?.trim() || profile?.email?.split('@')[0] || 'Student'

  async function load() {
    const { data } = await supabase.from('feed_comments').select('*')
      .eq('post_id', post.id).order('created_at', { ascending: true })
    setComments((data as FeedComment[]) ?? [])
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [post.id])

  async function add() {
    const text = body.trim()
    if (!text || !user) return
    setBusy(true)
    const { error } = await supabase.from('feed_comments')
      .insert({ post_id: post.id, user_id: user.id, author_name: authorName, author_avatar_url: profile?.avatar_url || '', body: text })
    setBusy(false)
    if (!error) { setBody(''); onCountChange?.(1); load(); onChanged(); onAdded?.() }
  }
  async function remove(id: string) {
    setComments((c) => c.filter((x) => x.id !== id))
    onCountChange?.(-1)
    await supabase.from('feed_comments').delete().eq('id', id)
    onChanged()
  }

  return (
    <Modal open onClose={onClose} title="Comments">
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No comments yet — start the discussion!</p>
        ) : comments.map((c) => (
          <div key={c.id} className="group flex gap-2.5">
            <Avatar id={c.user_id} name={c.author_name} url={avatarFor(c.user_id) || c.author_avatar_url} size={8} />
            <div className="min-w-0 flex-1 rounded-2xl bg-white/60 px-3 py-2 dark:bg-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">{c.author_name}</span>
                <span className="text-[10px] text-slate-400">{timeAgo(c.created_at)}</span>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200">{c.body}</p>
            </div>
            {c.user_id === user?.id && (
              <button onClick={() => remove(c.id)} className="text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-rose-500">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a comment…" maxLength={400} />
        <Button onClick={add} disabled={busy || !body.trim()}><Send size={15} /></Button>
      </div>
    </Modal>
  )
}
