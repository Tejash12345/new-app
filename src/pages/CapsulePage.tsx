import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Lock, Sparkles, Mic, Square, Trash2, Share2, Target, Check,
  Image as ImageIcon, Film, CalendarClock, Globe, Users, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useInvalidateTable, useTable } from '../hooks/db'
import { supabase } from '../lib/supabase'
import type {
  Capsule, CapsuleGoal, CapsuleMedia, CapsuleVisibility, FeedPost, GrowthReport,
  Habit, StudySession, Task,
} from '../lib/types'
import {
  Button, Empty, GlassCard, Input, Modal, Page, ProgressRing, SectionTitle, TextArea,
} from '../components/ui'
import { LionGuardian } from '../components/LionGuardian'
import {
  addMonths, buildGrowthReport, captureSnapshot, countdownLabel, guardianStage,
  isSealed, isUnlockable, lionGrowthScore, UNLOCK_PRESETS,
} from '../lib/capsule'
import { cn, minutesToLabel } from '../lib/utils'
import { confirmDialog, noticeDialog } from '../store/app'

const VIS: { key: CapsuleVisibility; label: string; icon: typeof Globe }[] = [
  { key: 'private', label: 'Private', icon: Lock },
  { key: 'friends', label: 'Friends', icon: Users },
  { key: 'feed', label: 'Feed', icon: Globe },
]

const newId = () =>
  (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`)

export function CapsulePage() {
  const { user, profile } = useAuth()
  // read AND write through useTable so every change invalidates the cached
  // list — direct supabase writes left the page stale until you re-entered it
  const { rows: capsules, update: updateCapsule, remove: deleteCapsuleRow } = useTable<Capsule>('capsules', { orderBy: 'unlock_at', ascending: true })
  const { rows: media } = useTable<CapsuleMedia>('capsule_media')
  const { rows: tasks } = useTable<Task>('tasks')
  const { rows: sessions } = useTable<StudySession>('study_sessions')
  const { rows: habits } = useTable<Habit>('habits')
  const { rows: myPosts } = useTable<FeedPost>('feed_posts')

  const [showCreate, setShowCreate] = useState(false)
  const [celebrate, setCelebrate] = useState<{ capsule: Capsule; report: GrowthReport } | null>(null)
  const [, forceTick] = useState(0)

  // refresh countdowns every minute
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const snapshot = useMemo(
    () => captureSnapshot({ profile, tasks, sessions, habits, feedPosts: myPosts }),
    [profile, tasks, sessions, habits, myPosts],
  )
  const allGoals = capsules.flatMap((c) => (Array.isArray(c.goals) ? c.goals : []))
  const goalsRatio = allGoals.length ? allGoals.filter((g) => g.done).length / allGoals.length : undefined
  const liveScore = lionGrowthScore(snapshot, goalsRatio)
  const stage = guardianStage(liveScore)

  const mediaFor = (id: string) => media.filter((m) => m.capsule_id === id)
  const sealedCount = capsules.filter(isSealed).length
  const openedCount = capsules.filter((c) => !!c.opened_at).length

  async function openCapsule(c: Capsule) {
    const report = buildGrowthReport(c, snapshot)
    setCelebrate({ capsule: c, report })
    await updateCapsule({ id: c.id, opened_at: new Date().toISOString(), growth: report } as Partial<Capsule> & { id: string })
  }

  async function toggleGoal(c: Capsule, goalId: string) {
    const goals = (c.goals ?? []).map((g) => (g.id === goalId ? { ...g, done: !g.done } : g))
    await updateCapsule({ id: c.id, goals } as Partial<Capsule> & { id: string })
  }

  async function removeCapsule(c: Capsule) {
    if (!(await confirmDialog('Delete this capsule and everything inside it? This cannot be undone.', { yesLabel: 'Delete' }))) return
    await deleteCapsuleRow(c.id)
  }

  const myName = profile?.full_name?.trim() || profile?.email?.split('@')[0] || 'Student'

  async function shareToFeed(c: Capsule, report: GrowthReport) {
    const firstImage = mediaFor(c.id).find((m) => m.kind === 'image')?.url ?? null
    const body =
      `My Future Me Capsule just opened after ${report.days} day(s). 🦁\n` +
      `Lion Growth Score: ${report.score}/100 · Goals kept: ${report.goalsAchieved}/${report.goalsTotal}.\n` +
      (report.insights[0] ?? '')
    const { data, error } = await supabase.from('feed_posts').insert({
      user_id: user!.id,
      author_name: myName,
      author_avatar_url: profile?.avatar_url || '',
      type: 'post',
      category: 'Startups',
      title: `🦁 ${c.title} — opened!`,
      body,
      media_url: firstImage,
      embed_url: null,
      tags: ['futureme', 'growth'],
    }).select('id').single()
    if (!error && data) {
      await updateCapsule({ id: c.id, shared_post_id: data.id } as Partial<Capsule> & { id: string })
      void noticeDialog('Shared to your FocusLion feed 🎉')
    } else if (error) {
      void noticeDialog(`Could not share: ${error.message}`)
    }
  }

  return (
    <Page
      title="Future Me Capsule"
      subtitle="Seal a message to your future self. When it opens, the Lion Growth Coach shows how far you've come. 🦁"
      actions={<Button onClick={() => setShowCreate(true)}><Plus size={16} /> New capsule</Button>}
    >
      {/* ---- Lion Guardian hero ---- */}
      <GlassCard className="mb-6 overflow-hidden !border-amber-400/30 bg-gradient-to-br from-amber-400/15 via-transparent to-orange-500/10">
        <div className="flex flex-wrap items-center gap-6">
          <LionGuardian score={liveScore} size={120} />
          <div className="min-w-[12rem] flex-1">
            <div className="text-xs font-bold uppercase tracking-widest text-amber-500">Your Lion Guardian</div>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white">{stage.name}</div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{stage.blurb}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>📚 {minutesToLabel(snapshot.studyMin)} focused</span>
              <span>🔥 {snapshot.streak}-day streak</span>
              <span>✅ {snapshot.tasksDone} tasks done</span>
              <span>🤝 {snapshot.feedPosts} posts</span>
              <span>🔒 {sealedCount} sealed · 📂 {openedCount} opened</span>
            </div>
          </div>
          <ProgressRing
            progress={liveScore / 100} size={104} stroke={10} color={stage.aura}
            label={`${liveScore}`} sub="Growth Score"
          />
        </div>
      </GlassCard>

      {/* ---- Memory Timeline ---- */}
      <SectionTitle>Memory timeline</SectionTitle>
      {capsules.length === 0 ? (
        <GlassCard>
          <Empty emoji="⏳" text={'No capsules yet.\nSeal a message, goals, photos or a voice note to your future self — and let the lion guard it until it\'s time.'} />
        </GlassCard>
      ) : (
        <div className="relative space-y-4 pl-6 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gradient-to-b before:from-amber-400/60 before:to-transparent">
          {capsules.map((c) => (
            <CapsuleCard
              key={c.id}
              capsule={c}
              media={mediaFor(c.id)}
              onOpen={() => openCapsule(c)}
              onToggleGoal={(gid) => toggleGoal(c, gid)}
              onDelete={() => removeCapsule(c)}
              onShare={(r) => shareToFeed(c, r)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCapsuleModal
          onClose={() => setShowCreate(false)}
          snapshot={snapshot}
          userId={user!.id}
          authorName={myName}
          authorAvatar={profile?.avatar_url || ''}
        />
      )}

      {celebrate && (
        <Modal open onClose={() => setCelebrate(null)} title="Capsule opened 🎉" wide>
          <div className="mb-4 flex flex-col items-center text-center">
            <LionGuardian score={celebrate.report.score} size={120} roaring />
            <h3 className="mt-3 text-xl font-extrabold text-slate-900 dark:text-white">{celebrate.capsule.title}</h3>
            <p className="text-sm text-slate-500">Sealed {celebrate.report.days} day(s) ago — here's your growth.</p>
          </div>
          <GrowthReportView report={celebrate.report} />
          <div className="mt-5 flex gap-2">
            {celebrate.capsule.visibility !== 'private' && (
              <Button variant="soft" className="flex-1" onClick={() => shareToFeed(celebrate.capsule, celebrate.report)}>
                <Share2 size={15} /> Share to feed
              </Button>
            )}
            <Button className="flex-1" onClick={() => setCelebrate(null)}>Keep growing 🦁</Button>
          </div>
        </Modal>
      )}
    </Page>
  )
}

// ============================================================ Capsule card
function CapsuleCard({
  capsule, media, onOpen, onToggleGoal, onDelete, onShare,
}: {
  capsule: Capsule
  media: CapsuleMedia[]
  onOpen: () => void
  onToggleGoal: (goalId: string) => void
  onDelete: () => void
  onShare: (report: GrowthReport) => void
}) {
  const sealed = isSealed(capsule)
  const unlockable = isUnlockable(capsule)
  const opened = !!capsule.opened_at
  const goals = Array.isArray(capsule.goals) ? capsule.goals : []
  const unlockDate = new Date(capsule.unlock_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  const dotColor = opened ? 'bg-emerald-500' : unlockable ? 'bg-amber-500' : 'bg-slate-400'

  return (
    <div className="relative">
      <span className={cn('absolute -left-[1.35rem] top-5 h-3 w-3 rounded-full ring-4 ring-white dark:ring-slate-900', dotColor)} />
      <GlassCard float className={cn(unlockable && '!border-amber-400/50 shadow-amber-400/20')}>
        <div className="flex items-start gap-3">
          {sealed && <LionGuardian score={capsule.snapshot?.xp ? 40 : 20} size={48} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-bold text-slate-900 dark:text-white">{capsule.title}</h3>
              <VisibilityChip v={capsule.visibility} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> Unlocks {unlockDate}</span>
              {media.length > 0 && <span>{media.length} memory{media.length === 1 ? '' : 'ies'}</span>}
              {goals.length > 0 && <span>{goals.filter((g) => g.done).length}/{goals.length} goals</span>}
            </div>
          </div>
          <button onClick={onDelete} className="rounded-full p-1.5 text-slate-300 transition hover:bg-rose-500/10 hover:text-rose-500">
            <Trash2 size={15} />
          </button>
        </div>

        {/* goals are visible even while sealed — they're promises you tick as you achieve them */}
        {goals.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} onToggle={() => onToggleGoal(g.id)} />
            ))}
          </div>
        )}

        {/* sealed: hide the message + media behind a lock */}
        {sealed && (
          <div className="mt-3 rounded-2xl border border-dashed border-amber-400/40 bg-amber-400/5 p-4 text-center">
            <Lock size={20} className="mx-auto text-amber-500" />
            <p className="mt-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">Sealed by your Lion Guardian</p>
            <p className="text-xs text-slate-500">Opens in <b className="text-amber-500">{countdownLabel(capsule.unlock_at)}</b></p>
          </div>
        )}

        {/* ready to open */}
        {unlockable && (
          <Button className="mt-3 w-full !bg-gradient-to-r !from-amber-400 !to-orange-500 !text-amber-950 !border-amber-300" onClick={onOpen}>
            <Sparkles size={16} /> Open your capsule — see how you've grown
          </Button>
        )}

        {/* opened: reveal everything */}
        {opened && (
          <div className="mt-3 space-y-3">
            {capsule.message && (
              <div className="whitespace-pre-line rounded-2xl bg-white/50 px-4 py-3 text-sm text-slate-700 dark:bg-white/5 dark:text-slate-200">
                {capsule.message}
              </div>
            )}
            {media.length > 0 && <MediaGallery media={media} />}
            {capsule.growth && <GrowthReportView report={capsule.growth} compact />}
            {capsule.visibility !== 'private' && !capsule.shared_post_id && capsule.growth && (
              <Button variant="soft" size="sm" onClick={() => onShare(capsule.growth!)}>
                <Share2 size={14} /> Share to feed
              </Button>
            )}
            {capsule.shared_post_id && (
              <p className="text-xs font-semibold text-emerald-500">✓ Shared to your feed</p>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  )
}

function VisibilityChip({ v }: { v: CapsuleVisibility }) {
  const map = { private: ['Private', Lock], friends: ['Friends', Users], feed: ['Feed', Globe] } as const
  const [label, Icon] = map[v]
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
      <Icon size={10} /> {label}
    </span>
  )
}

function GoalRow({ goal, onToggle }: { goal: CapsuleGoal; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex w-full items-center gap-2 text-left">
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
        goal.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-white/20')}>
        {goal.done && <Check size={13} />}
      </span>
      <span className={cn('text-sm', goal.done ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200')}>
        {goal.text}
      </span>
    </button>
  )
}

// ============================================================ Growth report
function GrowthReportView({ report, compact }: { report: GrowthReport; compact?: boolean }) {
  const stage = guardianStage(report.score)
  const delta = report.score - report.pastScore
  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-400/10 to-transparent p-4">
      <div className="flex items-center gap-4">
        <ProgressRing progress={report.score / 100} size={compact ? 76 : 92} stroke={9} color={stage.aura}
          label={`${report.score}`} sub="score" />
        <div className="flex-1">
          <div className="text-sm font-bold text-slate-900 dark:text-white">Lion Growth Coach</div>
          <p className="text-xs text-slate-500">
            {delta >= 0 ? `▲ +${delta}` : `▼ ${delta}`} since sealed · {report.goalsAchieved}/{report.goalsTotal} goals kept
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DeltaStat label="Study" value={`${report.deltas.studyMin >= 0 ? '+' : ''}${minutesToLabel(Math.abs(report.deltas.studyMin))}`} up={report.deltas.studyMin >= 0} />
        <DeltaStat label="Streak" value={`${report.deltas.streak >= 0 ? '+' : ''}${report.deltas.streak}d`} up={report.deltas.streak >= 0} />
        <DeltaStat label="Tasks" value={`${report.deltas.tasksDone >= 0 ? '+' : ''}${report.deltas.tasksDone}`} up={report.deltas.tasksDone >= 0} />
        <DeltaStat label="XP" value={`${report.deltas.xp >= 0 ? '+' : ''}${report.deltas.xp}`} up={report.deltas.xp >= 0} />
      </div>
      <div className="mt-3 space-y-2">
        {report.insights.map((ins, i) => (
          <p key={i} className="rounded-xl bg-white/50 px-3 py-2 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-200">{ins}</p>
        ))}
      </div>
    </div>
  )
}

function DeltaStat({ label, value, up }: { label: string; value: string; up: boolean }) {
  return (
    <div className="rounded-xl bg-white/40 px-2 py-2 text-center dark:bg-white/5">
      <div className={cn('text-sm font-extrabold', up ? 'text-emerald-500' : 'text-rose-500')}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  )
}

function MediaGallery({ media }: { media: CapsuleMedia[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {media.map((m) => (
        <div key={m.id} className="overflow-hidden rounded-xl bg-black/5 dark:bg-white/5">
          {m.kind === 'image' && <img src={m.url} alt="" className="h-32 w-full object-cover" />}
          {m.kind === 'video' && <video src={m.url} controls preload="metadata" className="h-32 w-full object-cover" />}
          {m.kind === 'voice' && (
            <div className="flex h-32 flex-col items-center justify-center gap-2 p-2">
              <Mic size={20} className="text-brand-500" />
              <audio src={m.url} controls preload="metadata" className="w-full" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ============================================================ Create modal
type Pending = { id: string; kind: 'image' | 'video' | 'voice'; file: File; preview: string }

function CreateCapsuleModal({
  onClose, snapshot, userId, authorName, authorAvatar,
}: {
  onClose: () => void
  snapshot: Capsule['snapshot']
  userId: string
  authorName: string
  authorAvatar: string
}) {
  // the insert here is direct (it needs .select() for the new id), so the
  // cached lists must be invalidated by hand or the sealed capsule only
  // appears after leaving and re-entering the page
  const invalidate = useInvalidateTable()
  const [title, setTitle] = useState('Letter to future me')
  const [message, setMessage] = useState('')
  const [goals, setGoals] = useState<CapsuleGoal[]>([])
  const [goalText, setGoalText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [preset, setPreset] = useState('1m')
  const [customDate, setCustomDate] = useState('')
  const [visibility, setVisibility] = useState<CapsuleVisibility>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  function addGoal() {
    const t = goalText.trim()
    if (!t) return
    setGoals((g) => [...g, { id: newId(), text: t, done: false }])
    setGoalText('')
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) { setError(`"${f.name}" is over 50 MB.`); continue }
      const kind = f.type.startsWith('video') ? 'video' : 'image'
      setPending((p) => [...p, { id: newId(), kind, file: f, preview: URL.createObjectURL(f) }])
    }
  }

  async function startRecording() {
    if (recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        if (blob.size < 200) return
        const ext = (mr.mimeType || '').includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type })
        setPending((p) => [...p, { id: newId(), kind: 'voice', file, preview: URL.createObjectURL(blob) }])
      }
      mr.start()
      recRef.current = mr
      setRecording(true)
      setRecSecs(0)
      recTimer.current = setInterval(() => setRecSecs((s) => s + 1), 1000)
    } catch {
      setError('Microphone permission is needed for a voice note.')
    }
  }

  function stopRecording() {
    recRef.current?.stop()
    if (recTimer.current) clearInterval(recTimer.current)
    setRecording(false)
  }

  function removePending(id: string) {
    setPending((p) => p.filter((x) => x.id !== id))
  }

  function unlockISO(): string {
    if (preset === 'custom') {
      if (!customDate) return ''
      return new Date(`${customDate}T12:00:00`).toISOString()
    }
    const months = UNLOCK_PRESETS.find((u) => u.key === preset)?.months ?? 1
    return addMonths(new Date(), months).toISOString()
  }

  async function uploadOne(file: File, kind: Pending['kind']): Promise<string> {
    const ext = file.name.split('.').pop() || (kind === 'voice' ? 'webm' : 'bin')
    const path = `${userId}/${newId()}.${ext}`
    const { error: upErr } = await supabase.storage.from('capsules')
      .upload(path, file, { contentType: file.type || undefined })
    if (upErr) throw upErr
    return supabase.storage.from('capsules').getPublicUrl(path).data.publicUrl
  }

  async function save() {
    setError('')
    const unlock = unlockISO()
    if (!unlock) { setError('Pick an unlock date.'); return }
    if (Date.parse(unlock) <= Date.now()) { setError('The unlock date must be in the future.'); return }
    if (!message.trim() && goals.length === 0 && pending.length === 0) {
      setError('Add a message, a goal, or a memory to seal.')
      return
    }
    setBusy(true)
    try {
      const { data: cap, error: insErr } = await supabase.from('capsules').insert({
        user_id: userId,
        author_name: authorName,
        author_avatar_url: authorAvatar,
        title: title.trim() || 'Letter to future me',
        message: message.trim(),
        goals,
        unlock_at: unlock,
        visibility,
        snapshot,
      }).select('id').single()
      if (insErr || !cap) throw insErr ?? new Error('Could not create capsule')

      for (const m of pending) {
        try {
          const url = await uploadOne(m.file, m.kind)
          await supabase.from('capsule_media').insert({
            capsule_id: cap.id, user_id: userId, kind: m.kind, url,
          })
        } catch (e) {
          // one bad upload shouldn't lose the whole capsule
          console.error('capsule media upload failed', e)
        }
      }
      invalidate('capsules')
      invalidate('capsule_media')
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.'
      setError(/bucket.*not.*found/i.test(msg) ? 'Capsule storage missing — run upgrade-18.sql in Supabase first.' : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Seal a new capsule" wide>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Message to future you</label>
          <TextArea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000}
            placeholder="Dear future me… what are you hoping for? What are you working on right now?" />
        </div>

        {/* goals */}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
            <span className="inline-flex items-center gap-1"><Target size={12} /> Goals (promises to tick off)</span>
          </label>
          <div className="flex gap-2">
            <Input value={goalText} onChange={(e) => setGoalText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addGoal())}
              placeholder="e.g. Finish my portfolio site" />
            <Button variant="soft" onClick={addGoal}><Plus size={15} /></Button>
          </div>
          {goals.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {goals.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-xl bg-white/50 px-3 py-1.5 text-sm dark:bg-white/5">
                  <span className="text-slate-700 dark:text-slate-200">🎯 {g.text}</span>
                  <button onClick={() => setGoals((gs) => gs.filter((x) => x.id !== g.id))} className="text-slate-300 hover:text-rose-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* media */}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Memories</label>
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" size="sm" onClick={() => fileRef.current?.click()}>
              <ImageIcon size={14} /> Photo / video
            </Button>
            {recording ? (
              <Button variant="danger" size="sm" onClick={stopRecording}>
                <Square size={14} /> Stop ({recSecs}s)
              </Button>
            ) : (
              <Button variant="soft" size="sm" onClick={startRecording}>
                <Mic size={14} /> Voice note
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={onPickFiles} />
          </div>
          {pending.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {pending.map((m) => (
                <div key={m.id} className="relative overflow-hidden rounded-xl bg-black/5 dark:bg-white/5">
                  {m.kind === 'image' && <img src={m.preview} alt="" className="h-20 w-full object-cover" />}
                  {m.kind === 'video' && <div className="flex h-20 items-center justify-center"><Film size={20} className="text-slate-400" /></div>}
                  {m.kind === 'voice' && <div className="flex h-20 items-center justify-center"><Mic size={20} className="text-brand-500" /></div>}
                  <button onClick={() => removePending(m.id)} className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* unlock date */}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Open in…</label>
          <div className="flex flex-wrap gap-2">
            {UNLOCK_PRESETS.map((u) => (
              <button key={u.key} onClick={() => setPreset(u.key)}
                className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition',
                  preset === u.key ? 'bg-brand-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
                {u.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <Input type="date" className="mt-2" value={customDate}
              min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
              onChange={(e) => setCustomDate(e.target.value)} />
          )}
        </div>

        {/* visibility */}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">When it opens…</label>
          <div className="flex gap-2">
            {VIS.map((v) => (
              <button key={v.key} onClick={() => setVisibility(v.key)}
                className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition',
                  visibility === v.key ? 'bg-brand-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
                <v.icon size={13} /> {v.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
            <ShieldCheck size={12} /> Capsules stay private until you open them. Friends/Feed just let you share the growth report afterward.
          </p>
        </div>

        {error && <p className="text-sm font-semibold text-rose-500">{error}</p>}

        <Button className="w-full" onClick={save} disabled={busy}>
          {busy ? 'Sealing…' : <><Lock size={15} /> Seal capsule</>}
        </Button>
      </div>
    </Modal>
  )
}
