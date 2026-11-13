import { useEffect, useState } from 'react'
import { hasPhonePowers, phone } from '../lib/device'
import { ESSENTIAL, PERMS, usePermStatus } from '../lib/leoPerms'
import { cn } from '../lib/utils'

// ----------------------------------------------------------------------------
// Making Leo easy for anyone:
//  • LeoSetupChecklist — every permission Leo needs, ✓ / one-tap "Allow".
//  • LeoGuide — "What can I say?": example commands by topic, tap to try.
// ----------------------------------------------------------------------------

export function LeoSetupChecklist({ dark, onDone }: { dark?: boolean; onDone?: () => void }) {
  const st = usePermStatus()
  if (!hasPhonePowers()) {
    return <p className={cn('px-3 py-2 text-xs', dark ? 'text-white/60' : 'text-slate-500')}>
      Phone powers (Hey Leo, calls, scrolling…) work in the FocusLion Android app.
    </p>
  }
  if (!st) return <p className={cn('px-3 py-2 text-xs', dark ? 'text-white/60' : 'text-slate-500')}>Checking…</p>
  const essentialsOk = ESSENTIAL.every((k) => st[k])
  const row = (p: (typeof PERMS)[number]) => (
    <div key={p.key} className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className={cn('text-sm font-semibold', dark ? 'text-white' : 'text-slate-900 dark:text-white')}>{p.label}</div>
        <div className={cn('text-xs', dark ? 'text-white/50' : 'text-slate-500')}>{p.why}</div>
      </div>
      {st[p.key]
        ? <span className="shrink-0 text-sm font-bold text-emerald-400">✓</span>
        : <button onClick={() => void phone('open_perm', { which: p.key })}
            className="shrink-0 rounded-full bg-sky-500 px-3 py-1 text-xs font-bold text-white active:scale-95">Allow</button>}
    </div>
  )
  return (
    <div className={cn('rounded-2xl', dark ? 'bg-white/5' : '')}>
      <div className={cn('px-3 pt-2 text-xs font-bold uppercase tracking-wide', essentialsOk ? 'text-emerald-400' : 'text-amber-500')}>
        {essentialsOk ? '✓ Leo is ready' : 'Needed for Leo'}
      </div>
      {PERMS.filter((p) => p.essential).map(row)}
      <div className={cn('px-3 pt-2 text-xs font-bold uppercase tracking-wide', dark ? 'text-white/40' : 'text-slate-400')}>Optional</div>
      {PERMS.filter((p) => !p.essential).map(row)}
      {onDone && (
        <button onClick={onDone} className={cn('w-full rounded-xl px-3 py-2 text-sm font-semibold', dark ? 'text-sky-300' : 'text-sky-600')}>
          {essentialsOk ? 'Done' : 'Later'}
        </button>
      )}
    </div>
  )
}

type VoiceSt = { ok: boolean; msg: string; lock?: boolean; enrolled?: boolean; strict?: number; state?: string; score?: number }

const SAMPLE = 'Hey Leo, open YouTube and play some music. Hey Leo, scroll down slowly. Hey Leo, call my friend and tell him I am on my way home.'

/** Voice Lock: record your voice once — then Leo reacts ONLY to you (not TV, videos, other people). */
export function VoiceLockPanel({ dark }: { dark?: boolean }) {
  const [st, setSt] = useState<VoiceSt | null>(null)
  const [busy, setBusy] = useState(false)
  const recording = st?.state === 'preparing' || st?.state === 'recording'
  useEffect(() => {
    let alive = true
    const check = () => { void phone('voice_status', {}, 3000).then((r) => { if (alive) setSt(r as VoiceSt) }) }
    check()
    const t = setInterval(check, recording ? 1000 : 4000)
    return () => { alive = false; clearInterval(t) }
  }, [recording])
  const run = async (a: string, args: Record<string, unknown> = {}) => {
    setBusy(true)
    const r = await phone(a, args, 5000)
    setBusy(false)
    if (!r.ok) setSt((s) => ({ ...(s ?? { ok: false }), msg: r.msg }))
    else void phone('voice_status', {}, 3000).then((x) => setSt(x as VoiceSt))
  }
  const btn = cn('rounded-full px-3 py-1.5 text-xs font-bold active:scale-95 disabled:opacity-50')
  return (
    <div className={cn('mx-3 space-y-2 rounded-xl p-3', dark ? 'bg-white/5' : 'bg-slate-500/5')}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={cn('text-sm font-semibold', dark ? 'text-white' : 'text-slate-900 dark:text-white')}>🔒 Voice Lock</div>
          <div className={cn('text-xs', dark ? 'text-white/50' : 'text-slate-500')}>
            Leo answers only YOUR voice — videos, TV and other people are ignored. Your voice stays on this phone.
          </div>
        </div>
        {st?.enrolled && (
          <button disabled={busy} onClick={() => void run('voice_lock', { on: !st.lock })}
            className={cn('relative h-6 w-11 shrink-0 rounded-full transition', st.lock ? 'bg-sky-500' : dark ? 'bg-white/15' : 'bg-slate-300 dark:bg-white/15')}>
            <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', st.lock ? 'left-[22px]' : 'left-0.5')} />
          </button>
        )}
      </div>
      {st && (
        <div className={cn('text-xs font-semibold', st.lock ? 'text-emerald-400' : recording ? 'text-rose-400' : 'text-amber-500')}>
          {recording && '🎙 '}{st.msg}
        </div>
      )}
      {recording && (
        <div className={cn('rounded-lg p-2 text-xs', dark ? 'bg-white/10 text-white' : 'bg-white text-slate-700 dark:bg-white/10 dark:text-white')}>
          Read this aloud in your normal voice:<br /><b>“{SAMPLE}”</b>
        </div>
      )}
      {!recording && (
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => void run('voice_enroll')} className={cn(btn, 'bg-sky-500 text-white')}>
            {st?.enrolled ? 'Record my voice again' : 'Record my voice (12 s)'}
          </button>
          {st?.enrolled && st.lock && (['Relaxed', 'Normal', 'Strict'] as const).map((l, i) => (
            <button key={l} disabled={busy} onClick={() => void run('voice_lock', { on: true, strict: i })}
              className={cn(btn, st.strict === i ? 'bg-emerald-500 text-white' : dark ? 'bg-white/10 text-white' : 'bg-slate-500/10 text-slate-700 dark:text-slate-200')}>
              {l}
            </button>
          ))}
          {st?.enrolled && (
            <button disabled={busy} onClick={() => void run('voice_forget')} className={cn(btn, 'text-rose-400')}>Delete my voice</button>
          )}
        </div>
      )}
      {st?.lock && (
        <div className={cn('text-[11px]', dark ? 'text-white/40' : 'text-slate-400')}>
          Works for “Hey Leo” and follow-up commands over other apps. If Leo ignores you, choose Relaxed or record again in a quiet room.
        </div>
      )}
    </div>
  )
}

const GUIDE:{ title: string; emoji: string; examples: string[] }[] = [
  { title: 'Control any app', emoji: '📱', examples: ['scroll down', 'slowly scroll', 'stop', 'next', 'go back', 'tap Storage', 'type I am on my way', 'louder'] },
  { title: 'YouTube & music', emoji: '🎵', examples: ['play Tum Hi Ho', 'play lofi study music', 'pause', 'skip ad', 'like'] },
  { title: 'Call & message', emoji: '📞', examples: ['call Amma', 'send hi to Ravi on WhatsApp', 'SMS Mom that I reached home', 'any new messages?'] },
  { title: 'Phone', emoji: '⚙️', examples: ['open YouTube', 'open storage settings', 'turn on the flashlight', 'set an alarm for 6:30', 'turn off the alarm', 'how much battery do I have?'] },
  { title: 'Study', emoji: '📚', examples: ['study mode', 'start a 25 minute focus', 'make 5 flashcards on photosynthesis', 'add a task to revise physics tomorrow at 6 PM'] },
  { title: 'Ask anything', emoji: '💡', examples: ['brief me on my day', "what's the weather tomorrow?", "today's news", 'explain photosynthesis simply'] },
]

export function LeoGuide({ onTry, dark }: { onTry: (text: string) => void; dark?: boolean }) {
  return (
    <div className="space-y-3">
      <p className={cn('text-xs', dark ? 'text-white/60' : 'text-slate-500')}>
        Say <b>“Hey Leo”</b> and the command in one breath — or tap an example to try it.
      </p>
      {GUIDE.map((g) => (
        <div key={g.title}>
          <div className={cn('mb-1 text-xs font-bold uppercase tracking-wide', dark ? 'text-sky-200' : 'text-slate-600')}>{g.emoji} {g.title}</div>
          <div className="flex flex-wrap gap-1.5">
            {g.examples.map((e) => (
              <button key={e} onClick={() => onTry(e)}
                className={cn('rounded-full px-3 py-1.5 text-xs', dark ? 'border border-sky-300/20 bg-white/5 text-sky-100 active:bg-white/15' : 'bg-slate-500/10 text-slate-700 dark:text-slate-200')}>
                “{e}”
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
