import { useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { requestNotifPermission } from '../hooks/useNotifications'
import { Button, GlassCard, Input, Modal, Page, SectionTitle } from '../components/ui'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={cn('relative h-7 w-12 rounded-full transition-colors', on ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/15')}>
      <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')} />
    </button>
  )
}

export function SettingsPage() {
  const { profile, updateProfile, refreshProfile, user, signOut } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
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
        .from('avatars').upload(path, file, { contentType: file.type || undefined })
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
      <div className="grid gap-5 lg:grid-cols-2">
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
              <div className="truncate font-bold text-slate-900 dark:text-white">{profile?.full_name || 'Student'}</div>
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
        </GlassCard>

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
          <div className="grid gap-4 sm:grid-cols-2">
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
