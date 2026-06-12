import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { requestNotifPermission } from '../hooks/useNotifications'
import { Button, GlassCard, Input, Page, SectionTitle } from '../components/ui'
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
  const { profile, updateProfile, user } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [saved, setSaved] = useState(false)

  const settings = profile?.settings ?? {}
  const notif = settings.notifications ?? {}

  async function patchSettings(patch: Partial<typeof settings>) {
    await updateProfile({ settings: { ...settings, ...patch } })
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
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-400 to-brand-600 text-2xl font-bold text-white">
              {(profile?.full_name || user?.email || '?').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-slate-900 dark:text-white">{profile?.full_name || 'Student'}</div>
              <div className="text-sm text-slate-500">{user?.email}</div>
            </div>
          </div>
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
                className="rounded-xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-3 py-1.5 text-sm"
              >
                {[20, 21, 22, 23].map((h) => <option key={h} value={h}>{h}:00</option>)}
              </select>
            </div>
          </div>
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
      </div>
    </Page>
  )
}
