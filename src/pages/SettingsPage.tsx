import { useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { requestNotifPermission } from '../hooks/useNotifications'
import { Button, GlassCard, Input, MascotImg, Modal, Page, SectionTitle } from '../components/ui'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { prepareMascotImage, setMascotLocal, useMascot, type MascotKind } from '../lib/mascot'
import { THEMES, getStoredTheme, setTheme as applyAccentTheme, type ThemeId } from '../lib/theme'
import { usePrefs, setPref, DEFAULT_PREFS, type Prefs } from '../lib/prefs'

function MascotRow({ kind, title, desc, busy, onPick, onReset }: {
  kind: MascotKind; title: string; desc: string
  busy: boolean; onPick: (kind: MascotKind) => void; onReset: (kind: MascotKind) => void
}) {
  const { isCustom } = useMascot(kind)
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
      <button
        type="button"
        onClick={() => onPick(kind)}
        disabled={busy}
        className="flex h-14 w-14 shrink-0 items-center justify-center"
        aria-label={`Change ${title} image`}
      >
        <MascotImg kind={kind} className="max-h-14 w-14" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
        <div className="text-xs text-slate-500">{desc}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => onPick(kind)}
          disabled={busy}
          className="text-xs font-semibold text-brand-500 disabled:opacity-50"
        >
          {busy ? 'Uploading…' : isCustom ? 'Change' : 'Use my image'}
        </button>
        {isCustom && !busy && (
          <button
            type="button"
            onClick={() => onReset(kind)}
            className="text-xs font-semibold text-slate-400 transition hover:text-rose-500"
          >
            Back to lion
          </button>
        )}
      </div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/15')}>
      <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')} />
    </button>
  )
}

/** A labelled row that reveals its control on the right (toggle or segmented). */
function PrefRow({ icon, title, desc, children }: { icon: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-semibold text-slate-900 dark:text-white">{icon} {title}</div>
        <div className="text-xs text-slate-500">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** A compact segmented control for a few string choices. */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full bg-slate-500/10 p-0.5 dark:bg-white/10">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={cn('rounded-full px-2.5 py-1 text-xs font-bold transition', value === o.v ? 'bg-brand-500 text-white shadow' : 'text-slate-500 dark:text-slate-300')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The full "Chat & appearance" preferences card — many small user-friendly options. */
function ChatPrefsCard() {
  const p = usePrefs()
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPref(k, v)
  return (
    <GlassCard>
      <SectionTitle>💬 Chat & appearance</SectionTitle>
      <div className="space-y-4">
        <PrefRow icon="🔡" title="Chat text size" desc="Make messages easier to read">
          <Seg value={p.chatTextSize} onChange={(v) => set('chatTextSize', v)}
            options={[{ v: 'sm', label: 'A-' }, { v: 'md', label: 'A' }, { v: 'lg', label: 'A+' }, { v: 'xl', label: 'A++' }]} />
        </PrefRow>
        <PrefRow icon="📐" title="Message density" desc="Cozy spacing or fit more on screen">
          <Seg value={p.density} onChange={(v) => set('density', v)}
            options={[{ v: 'cozy', label: 'Cozy' }, { v: 'compact', label: 'Compact' }]} />
        </PrefRow>
        <PrefRow icon="🫧" title="Bubble corners" desc="Rounded or crisp message bubbles">
          <Seg value={p.bubbleCorners} onChange={(v) => set('bubbleCorners', v)}
            options={[{ v: 'round', label: 'Round' }, { v: 'sharp', label: 'Sharp' }]} />
        </PrefRow>
        <PrefRow icon="🕒" title="24-hour clock" desc="Show 14:30 instead of 2:30 PM">
          <Toggle on={p.clock24} onChange={(v) => set('clock24', v)} />
        </PrefRow>
        <PrefRow icon="⏎" title="Enter to send" desc="Off = Enter makes a new line">
          <Toggle on={p.enterToSend} onChange={(v) => set('enterToSend', v)} />
        </PrefRow>
        <PrefRow icon="😄" title="Big emoji" desc="Emoji-only messages appear large">
          <Toggle on={p.bigEmoji} onChange={(v) => set('bigEmoji', v)} />
        </PrefRow>
        <PrefRow icon="👤" title="Show avatars in chat" desc="Friend's photo beside their messages">
          <Toggle on={p.showAvatars} onChange={(v) => set('showAvatars', v)} />
        </PrefRow>
        <PrefRow icon="⬇️" title="Auto-scroll to newest" desc="Jump to the latest message automatically">
          <Toggle on={p.autoScroll} onChange={(v) => set('autoScroll', v)} />
        </PrefRow>
        <PrefRow icon="🌓" title="Wallpaper dim" desc="Darken the chat background for readability">
          <input type="range" min={0} max={0.6} step={0.1} value={p.wallpaperDim}
            onChange={(e) => set('wallpaperDim', Number(e.target.value))} className="w-24 accent-brand-500" />
        </PrefRow>
        <div className="my-1 border-t border-slate-200/60 dark:border-white/10" />
        <PrefRow icon="✓✓" title="Send read receipts" desc="Let friends see when you've read their messages">
          <Toggle on={p.readReceipts} onChange={(v) => set('readReceipts', v)} />
        </PrefRow>
        <PrefRow icon="✍️" title="Share typing status" desc="Show “typing…” to your friend">
          <Toggle on={p.sendTyping} onChange={(v) => set('sendTyping', v)} />
        </PrefRow>
        <PrefRow icon="🕵️" title="Hide last-seen" desc="Don't show the last-seen line in chats you open">
          <Toggle on={p.hideLastSeen} onChange={(v) => set('hideLastSeen', v)} />
        </PrefRow>
        <PrefRow icon="🗑️" title="Confirm before deleting" desc="Ask before removing a message">
          <Toggle on={p.confirmDelete} onChange={(v) => set('confirmDelete', v)} />
        </PrefRow>
        <div className="my-1 border-t border-slate-200/60 dark:border-white/10" />
        <PrefRow icon="📳" title="Haptic feedback" desc="Little vibrations on taps & reactions">
          <Toggle on={p.haptics} onChange={(v) => set('haptics', v)} />
        </PrefRow>
        <PrefRow icon="🔊" title="Sound effects" desc="Game sounds in Lion Run (jumps, coins, engines)">
          <Toggle on={p.sounds} onChange={(v) => set('sounds', v)} />
        </PrefRow>
        <PrefRow icon="🎵" title="Music" desc="Adaptive soundtrack that swells with the action in Lion Run">
          <Toggle on={p.music} onChange={(v) => set('music', v)} />
        </PrefRow>
        <PrefRow icon="🌐" title="NPC internet learning" desc="Citizens automatically read public info (Wikipedia) in the background to grow their knowledge, and look things up when you ask. Off = fully offline. Web facts are labelled 🌐 and clearable; personal memories always stay on-device.">
          <Toggle on={p.npcInternet} onChange={(v) => set('npcInternet', v)} />
        </PrefRow>
        <PrefRow icon="🧠" title="NPC genius brain (online AI)" desc="Let citizens think through Lion AI so they can answer about almost anything — in character. Needs internet + sign-in and uses your daily AI allowance. Off = citizens use their fast, fully-offline brain (neural model + memory). Their personality and memories stay on-device either way.">
          <Toggle on={p.npcCloudBrain} onChange={(v) => set('npcCloudBrain', v)} />
        </PrefRow>
        <PrefRow icon="🗣️" title="NPC voice (read aloud)" desc="Citizens speak their chat replies using your device's text-to-speech. You can also toggle it inside any chat.">
          <Toggle on={p.npcVoice} onChange={(v) => set('npcVoice', v)} />
        </PrefRow>
        <PrefRow icon="🎞️" title="Reduce motion" desc="Calmer animations across the app">
          <Toggle on={p.reduceMotion} onChange={(v) => set('reduceMotion', v)} />
        </PrefRow>
        <PrefRow icon="📥" title="Auto-download media" desc="Save incoming photos to your device vault">
          <Toggle on={p.autoDownloadMedia} onChange={(v) => set('autoDownloadMedia', v)} />
        </PrefRow>
        <button onClick={() => (Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]).forEach((k) => set(k, DEFAULT_PREFS[k]))}
          className="mt-1 text-xs font-semibold text-slate-400 transition hover:text-rose-500">
          Reset to defaults
        </button>
      </div>
    </GlassCard>
  )
}

export function SettingsPage() {
  const { profile, updateProfile, refreshProfile, user, signOut } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [role, setRole] = useState(profile?.settings?.role ?? '')
  const [roleSaved, setRoleSaved] = useState(false)
  const [saved, setSaved] = useState(false)
  const [privacyErr, setPrivacyErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [avatarErr, setAvatarErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [delOpen, setDelOpen] = useState(false)
  const [delText, setDelText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [delErr, setDelErr] = useState<string | null>(null)

  async function deleteAccount() {
    setDeleting(true)
    setDelErr(null)
    try {
      const { error } = await supabase.rpc('delete_my_account')
      if (error) {
        setDelErr(/function .*delete_my_account.* does not exist/i.test(error.message)
          ? 'Account deletion isn’t enabled yet — run upgrade-15.sql in Supabase first.'
          : `Could not delete account: ${error.message}`)
        return
      }
      // account is gone — sign out and return to the login screen
      await signOut()
    } catch {
      setDelErr('Could not delete account. Check your connection and try again.')
    } finally {
      setDeleting(false)
    }
  }

  const settings = profile?.settings ?? {}
  const notif = settings.notifications ?? {}
  const initial = (profile?.full_name || user?.email || '?').slice(0, 1).toUpperCase()

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the user re-pick the same file later
    if (!file || !user) return
    if (!file.type.startsWith('image/')) { setAvatarErr('Please choose an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { setAvatarErr('Image too big — 5 MB max.'); return }
    setAvatarErr(null)
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').replace(/[^\w]+/g, '').slice(0, 5) || 'jpg'
      const path = `${user.id}/avatar-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(path, file, { contentType: file.type || undefined, cacheControl: '31536000' })
      if (upErr) {
        setAvatarErr(/bucket.*not.*found/i.test(upErr.message)
          ? 'Avatar storage missing — run upgrade-11.sql in Supabase first.'
          : `Upload failed: ${upErr.message}`)
        return
      }
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      await updateProfile({ avatar_url: url })
    } catch {
      setAvatarErr('Upload failed. Check your connection and try again.')
    } finally {
      setUploading(false)
    }
  }

  async function patchSettings(patch: Partial<typeof settings>) {
    await updateProfile({ settings: { ...settings, ...patch } })
  }

  const [mascotBusy, setMascotBusy] = useState<MascotKind | null>(null)
  const [mascotErr, setMascotErr] = useState<string | null>(null)
  const [accent, setAccent] = useState<ThemeId>(getStoredTheme())
  const mascotFileRef = useRef<HTMLInputElement>(null)
  const mascotPickKind = useRef<MascotKind>('lion')

  function pickMascot(kind: MascotKind) {
    mascotPickKind.current = kind
    mascotFileRef.current?.click()
  }

  async function onPickMascot(e: React.ChangeEvent<HTMLInputElement>) {
    const kind = mascotPickKind.current
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    if (!file.type.startsWith('image/')) { setMascotErr('Please choose an image file.'); return }
    if (file.size > 8 * 1024 * 1024) { setMascotErr('Image too big — 8 MB max.'); return }
    setMascotErr(null)
    setMascotBusy(kind)
    try {
      // downscaled client-side, so uploads are tiny and render instantly
      const blob = await prepareMascotImage(file)
      const ext = blob.type.includes('webp') ? 'webp' : 'png'
      const path = `${user.id}/mascot-${kind}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
      if (upErr) {
        setMascotErr(/bucket.*not.*found/i.test(upErr.message)
          ? 'Image storage missing — run upgrade-11.sql in Supabase first.'
          : `Upload failed: ${upErr.message}`)
        return
      }
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      setMascotLocal(kind, url) // instant everywhere in the UI
      await patchSettings(kind === 'lion' ? { mascotLion: url } : { mascotAi: url }) // follows the account
    } catch {
      setMascotErr('Upload failed. Check your connection and try again.')
    } finally {
      setMascotBusy(null)
    }
  }

  async function resetMascot(kind: MascotKind) {
    setMascotErr(null)
    setMascotLocal(kind, null)
    const next = { ...settings }
    if (kind === 'lion') delete next.mascotLion
    else delete next.mascotAi
    await updateProfile({ settings: next })
  }

  async function setPrivate(v: boolean) {
    if (!user) return
    setPrivacyErr(null)
    const { error } = await supabase.from('profiles').update({ is_private: v }).eq('id', user.id)
    if (error) {
      setPrivacyErr(/is_private|column .* does not exist/i.test(error.message)
        ? 'Private accounts aren’t enabled yet — run upgrade-16.sql in Supabase first.'
        : `Could not update: ${error.message}`)
      return
    }
    await refreshProfile()
  }
  async function patchNotif(key: string, val: boolean) {
    requestNotifPermission()
    await patchSettings({ notifications: { ...notif, [key]: val } })
  }

  const notifRows: { key: keyof typeof notif; label: string; desc: string }[] = [
    { key: 'study', label: '📚 Study reminders', desc: 'Before timetable blocks start' },
    { key: 'deadlines', label: '⏰ Deadlines', desc: 'Assignments & exams due within 24h' },
    { key: 'breaks', label: '🧘 Break reminders', desc: 'Every 50 minutes' },
    { key: 'hydration', label: '💧 Hydration', desc: 'Every 90 minutes (10:00–22:00)' },
    { key: 'sleep', label: '🌙 Sleep reminder', desc: 'Wind-down nudge at night' },
  ]

  return (
    <Page title="Settings" subtitle="Profile, notifications and preferences.">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GlassCard>
          <SectionTitle>Profile</SectionTitle>
          <div className="mb-4 flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-brand-400 to-brand-600 text-2xl font-bold text-white"
              aria-label="Change profile photo"
            >
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                : initial}
              <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[11px] font-semibold group-hover:flex">
                {uploading ? '…' : 'Change'}
              </span>
            </button>
            <div className="min-w-0">
              <div className="truncate font-bold text-slate-900 dark:text-white">{profile?.full_name || 'Friend'}</div>
              {settings.role && <div className="truncate text-xs font-semibold text-brand-500">{settings.role}</div>}
              <div className="truncate text-sm text-slate-500">{user?.email}</div>
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="text-xs font-semibold text-brand-500 disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : profile?.avatar_url ? 'Change photo' : 'Upload photo'}
                </button>
                {profile?.avatar_url && !uploading && (
                  <button
                    type="button"
                    onClick={() => updateProfile({ avatar_url: '' })}
                    className="text-xs font-semibold text-slate-400 transition hover:text-rose-500"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
          </div>
          {avatarErr && <p className="mb-3 text-xs font-semibold text-rose-500">{avatarErr}</p>}
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Display name</label>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            <Button onClick={async () => {
              await updateProfile({ full_name: name.trim() })
              setSaved(true); setTimeout(() => setSaved(false), 1500)
            }}>{saved ? '✓' : 'Save'}</Button>
          </div>

          {/* Your role — the app used to assume everyone's a student; now you
              choose what shows on your profile (or type your own). */}
          <label className="mb-1 mt-4 block text-xs font-bold uppercase tracking-wide text-slate-400">I am a…</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {['Student', 'Professional', 'Parent', 'Teacher', 'Creator', 'Entrepreneur', 'Learner'].map((r) => (
              <button key={r} type="button"
                onClick={async () => { setRole(r); await updateProfile({ settings: { ...settings, role: r } }); setRoleSaved(true); setTimeout(() => setRoleSaved(false), 1500) }}
                className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95',
                  (role || 'Student') === r ? 'bg-brand-500 text-white' : 'bg-slate-500/10 text-slate-600 dark:bg-white/10 dark:text-slate-300')}>
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Or type your own (e.g. Doctor, Founder)" maxLength={40} />
            <Button onClick={async () => {
              await updateProfile({ settings: { ...settings, role: role.trim() } })
              setRoleSaved(true); setTimeout(() => setRoleSaved(false), 1500)
            }}>{roleSaved ? '✓' : 'Save'}</Button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Shown on your profile instead of “Student”. Leave blank to hide it.</p>
        </GlassCard>

        <GlassCard>
          <SectionTitle>🦁 Customize your lion</SectionTitle>
          <p className="mb-4 text-xs leading-relaxed text-slate-500">
            Make FocusLion yours — replace the lion mascot or Leo the AI with any picture you love
            (your pet, your idol, anything that motivates you). It appears everywhere the lions do,
            on all your devices.
          </p>
          <div className="space-y-3">
            <MascotRow
              kind="lion" title="Lion mascot" busy={mascotBusy === 'lion'}
              desc="Splash screen, focus mode, level-ups & celebrations"
              onPick={pickMascot} onReset={resetMascot}
            />
            <MascotRow
              kind="ai" title="Leo — AI assistant" busy={mascotBusy === 'ai'}
              desc="AI chat button, daily missions, briefings & AI loaders"
              onPick={pickMascot} onReset={resetMascot}
            />
          </div>
          {mascotErr && <p className="mt-3 text-xs font-semibold text-rose-500">{mascotErr}</p>}
          <input ref={mascotFileRef} type="file" accept="image/*" className="hidden" onChange={onPickMascot} />
        </GlassCard>

        <GlassCard>
          <SectionTitle><span className="fl-float-tilt inline-block">🎨</span> Accent theme</SectionTitle>
          <p className="mb-4 text-xs leading-relaxed text-slate-500">
            {THEMES.length} professional colours — pick one and the whole app (buttons, nav, gradients, the
            aurora background) re-skins instantly, on all your devices.
          </p>
          <div className="grid max-h-[260px] grid-cols-4 gap-2 overflow-y-auto rounded-xl p-0.5 sm:grid-cols-6">
            {THEMES.map((t) => {
              const active = accent === t.id
              return (
                <button key={t.id}
                  onClick={() => { setAccent(t.id); applyAccentTheme(t.id) }}
                  aria-label={`${t.name} theme`}
                  className={cn('fl-lift group flex flex-col items-center gap-1.5 rounded-xl p-2',
                    active ? 'bg-slate-500/15 ring-2 ring-inset ring-brand-500' : 'hover:bg-slate-500/10')}>
                  <span className="flex h-8 w-full items-center justify-center gap-0.5 overflow-hidden rounded-md shadow-sm">
                    <span className="h-full flex-1" style={{ background: t.ramp[300] }} />
                    <span className="h-full flex-1" style={{ background: t.ramp[500] }} />
                    <span className="h-full flex-1" style={{ background: t.ramp[700] }} />
                  </span>
                  <span className="w-full truncate text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300">{t.name}</span>
                </button>
              )
            })}
          </div>

          {/* live preview — a mini chat that reflects the chosen accent */}
          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-widest text-slate-400">Preview</p>
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
            <div className="flex justify-start">
              <span className="max-w-[80%] rounded-2xl rounded-bl-md bg-slate-500/10 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200">Hey! Love the new look 😍</span>
            </div>
            <div className="flex justify-end">
              <span className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-r from-brand-500 to-brand-600 px-3 py-1.5 text-sm text-white shadow-lg shadow-brand-500/30">Right? This accent is 🔥</span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <div className="flex-1 rounded-full bg-slate-500/10 px-3 py-2 text-xs text-slate-400">Message…</div>
              <span className="fl-float flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-500/40">➤</span>
            </div>
          </div>
        </GlassCard>

        <ChatPrefsCard />

        <GlassCard>
          <SectionTitle>Preferences</SectionTitle>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">🔊 Lion roar sound</div>
                <div className="text-xs text-slate-500">Motivational sound effects when the lion appears</div>
              </div>
              <Toggle on={settings.sound !== false} onChange={(v) => patchSettings({ sound: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">🏆 Show me on the leaderboard</div>
                <div className="text-xs text-slate-500">Your name and XP are visible to other users</div>
              </div>
              <Toggle on={settings.leaderboard !== false} onChange={(v) => patchSettings({ leaderboard: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900 dark:text-white">🌙 Sleep reminder time</div>
                <div className="text-xs text-slate-500">When to send the wind-down nudge</div>
              </div>
              <select
                value={settings.sleepReminderHour ?? 22}
                onChange={(e) => patchSettings({ sleepReminderHour: Number(e.target.value) })}
                className="rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-1.5 text-sm text-slate-900 dark:text-white dark:[&>option]:bg-slate-800"
              >
                {[20, 21, 22, 23].map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <SectionTitle>Privacy</SectionTitle>
          <div className="flex items-center justify-between">
            <div className="pr-3">
              <div className="font-semibold text-slate-900 dark:text-white">🔒 Private account</div>
              <div className="text-xs text-slate-500">
                When on, only your accepted friends can see your feed posts. New people must send a
                friend request and be accepted before they can see your posts or message you.
              </div>
            </div>
            <Toggle on={profile?.is_private === true} onChange={setPrivate} />
          </div>
          {privacyErr && <p className="mt-3 text-xs font-semibold text-rose-500">{privacyErr}</p>}
          <p className="mt-3 text-[11px] text-slate-400">
            {profile?.is_private
              ? 'Your account is private — your posts are hidden from everyone except your friends.'
              : 'Your account is public — anyone on FocusLion can see your posts in the feed.'}
          </p>
        </GlassCard>

        <GlassCard className="lg:col-span-2">
          <SectionTitle>Notifications</SectionTitle>
          {'Notification' in window && Notification.permission === 'denied' && (
            <p className="mb-3 rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-500">
              Notifications are blocked in your browser. Click the lock icon in the address bar to allow them.
            </p>
          )}
          {'Notification' in window && Notification.permission === 'default' && (
            <Button variant="soft" className="mb-4" onClick={requestNotifPermission}>Enable browser notifications</Button>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {notifRows.map((r) => (
              <div key={r.key} className="flex items-center justify-between rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{r.label}</div>
                  <div className="text-xs text-slate-500">{r.desc}</div>
                </div>
                <Toggle on={notif[r.key] !== false} onChange={(v) => patchNotif(r.key as string, v)} />
              </div>
            ))}
          </div>
        </GlassCard>

        {/* danger zone */}
        <GlassCard className="lg:col-span-2 !border-rose-400/40">
          <SectionTitle>Danger zone</SectionTitle>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 font-semibold text-rose-500">
                <AlertTriangle size={16} /> Delete account
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Permanently removes your account and all your data — posts, messages, friends, stories and stats.
                Other users will no longer see your account. This can’t be undone.
              </div>
            </div>
            <Button variant="danger" className="shrink-0" onClick={() => { setDelText(''); setDelErr(null); setDelOpen(true) }}>
              Delete account
            </Button>
          </div>
        </GlassCard>
      </div>

      <Modal open={delOpen} onClose={() => !deleting && setDelOpen(false)} title="Delete your account?">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This permanently deletes your account and <b>everything</b> tied to it — your profile, posts, comments,
          chats, friends, stories and progress. Other people will no longer be able to find or see you. <b>This cannot be undone.</b>
        </p>
        <label className="mt-4 mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
          Type <span className="text-rose-500">DELETE</span> to confirm
        </label>
        <Input value={delText} onChange={(e) => setDelText(e.target.value)} placeholder="DELETE" />
        {delErr && <p className="mt-2 text-xs font-semibold text-rose-500">{delErr}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="soft" onClick={() => setDelOpen(false)} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={deleteAccount} disabled={deleting || delText.trim() !== 'DELETE'}>
            {deleting ? 'Deleting…' : 'Delete forever'}
          </Button>
        </div>
      </Modal>

      <p className="mt-6 text-center text-xs text-slate-400">
        Lion roar recording by Growcott et&nbsp;al.,{' '}
        <a className="underline" href="https://commons.wikimedia.org/wiki/File:Lionroar.wav" target="_blank" rel="noreferrer">
          CC BY 4.0 via Wikimedia Commons
        </a>
      </p>
    </Page>
  )
}
