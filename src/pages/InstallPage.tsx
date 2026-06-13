import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download, Smartphone, Share, Plus, Shield, CheckCircle2 } from 'lucide-react'
import { GlassCard, Page, SectionTitle, Button } from '../components/ui'

export function InstallPage() {
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const origin = window.location.origin
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches

  useEffect(() => {
    QRCode.toDataURL(origin, { width: 240, margin: 1, color: { dark: '#1e2235', light: '#ffffff' } })
      .then(setQr)
      .catch(() => {})
  }, [origin])

  function share() {
    if (navigator.share) {
      navigator.share({ title: 'FocusLion 🦁', text: 'Study better with FocusLion!', url: origin }).catch(() => {})
    } else {
      navigator.clipboard.writeText(origin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <Page title="Get the App" subtitle="Install FocusLion on your phone — pick what suits you. 🦁">
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        {/* Option 1: Install as app (PWA) */}
        <GlassCard className="overflow-hidden">
          <SectionTitle>
            <span className="flex items-center gap-2"><Smartphone size={18} className="text-brand-500 shrink-0" /> Install as an app</span>
          </SectionTitle>
          {isStandalone ? (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 px-4 py-3 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={20} className="shrink-0" /> <span className="font-semibold">Already installed on this device. 🎉</span>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Scan with your phone camera, then add it to your home screen — installs like a real app and updates automatically.
              </p>
              <div className="my-4 flex justify-center">
                {qr
                  ? <img src={qr} alt="Scan to open FocusLion" className="h-44 w-44 rounded-2xl border border-slate-200/60 dark:border-white/10 sm:h-48 sm:w-48" />
                  : <div className="h-44 w-44 animate-pulse rounded-2xl bg-slate-500/10 sm:h-48 sm:w-48" />}
              </div>
              <div className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                <div className="rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-2.5">
                  <span className="font-bold text-brand-500">Android:</span> Chrome → <b>⋮</b> menu → <b>Install app</b>
                </div>
                <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-white/40 dark:bg-white/5 px-4 py-2.5">
                  <span className="font-bold text-brand-500">iPhone:</span> Safari → <Share size={13} className="inline shrink-0" /> Share → <Plus size={13} className="inline shrink-0" /> <b>Add to Home Screen</b>
                </div>
              </div>
            </>
          )}
        </GlassCard>

        {/* Option 2: Download APK */}
        <GlassCard className="overflow-hidden">
          <SectionTitle>
            <span className="flex items-center gap-2"><Download size={18} className="text-brand-500 shrink-0" /> Download Android app</span>
          </SectionTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            One app does it all — the full FocusLion experience <b>plus the built-in app blocker</b>. Download and open it on your phone.
          </p>
          <a href="/focuslion.apk" download className="mt-4 block">
            <Button size="lg" className="w-full">
              <Download size={18} className="shrink-0" /> <span className="truncate">Download FocusLion.apk</span>
            </Button>
          </a>
          <p className="mt-2 text-xs text-slate-400">
            Android asks to allow "Install unknown apps" the first time — tap Allow, then Install.
          </p>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-amber-400/10 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
            <Shield size={16} className="mt-0.5 shrink-0 text-amber-500" />
            <span>
              <b className="text-slate-900 dark:text-white">App blocker included.</b> Choose your apps and hours in <b>Wellbeing</b>, then tap the shield button inside the app to truly block them outside your allowed time.
            </span>
          </div>
        </GlassCard>

        {/* shareable link */}
        <GlassCard className="overflow-hidden lg:col-span-2">
          <SectionTitle>Share with friends</SectionTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">Send this link — anyone can open it and install the app:</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-2xl bg-slate-500/10 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200">{origin}</code>
            <Button onClick={share} className="shrink-0">
              <Share size={16} className="shrink-0" /> {copied ? 'Copied!' : 'Share'}
            </Button>
          </div>
        </GlassCard>
      </div>
    </Page>
  )
}
