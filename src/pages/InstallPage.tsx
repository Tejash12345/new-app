import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download, Smartphone, Share, Plus, Shield, CheckCircle2 } from 'lucide-react'
import { GlassCard, Page, SectionTitle, Button } from '../components/ui'

export function InstallPage() {
  const [qr, setQr] = useState('')
  const origin = window.location.origin
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches

  useEffect(() => {
    QRCode.toDataURL(origin, { width: 240, margin: 1, color: { dark: '#1e2235', light: '#ffffff' } })
      .then(setQr)
      .catch(() => {})
  }, [origin])

  return (
    <Page title="Get the App" subtitle="Install FocusLion on your phone — choose the way that suits you. 🦁">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Option 1: Install as app (PWA) */}
        <GlassCard>
          <SectionTitle><span className="flex items-center gap-2"><Smartphone size={18} className="text-brand-500" /> Install as an app (easiest)</span></SectionTitle>
          {isStandalone ? (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 px-4 py-3 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={20} /> <span className="font-semibold">FocusLion is already installed on this device. 🎉</span>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Scan this with your phone camera to open FocusLion, then add it to your home screen — it installs like a real app, full-screen, and updates automatically.
              </p>
              <div className="my-4 flex justify-center">
                {qr
                  ? <img src={qr} alt="Scan to open FocusLion" className="rounded-2xl border border-slate-200/60 dark:border-white/10" width={200} height={200} />
                  : <div className="h-[200px] w-[200px] animate-pulse rounded-2xl bg-slate-500/10" />}
              </div>
              <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex gap-3">
                  <span className="font-bold text-brand-500">Android</span>
                  <span>Open in Chrome → tap <b>⋮ menu</b> → <b>Install app</b> / Add to Home screen.</span>
                </div>
                <div className="flex gap-3">
                  <span className="font-bold text-brand-500">iPhone</span>
                  <span className="flex items-center gap-1">Open in Safari → tap <Share size={14} className="inline" /> <b>Share</b> → <Plus size={14} className="inline" /> <b>Add to Home Screen</b>.</span>
                </div>
              </div>
            </>
          )}
        </GlassCard>

        {/* Option 2: Download APK */}
        <GlassCard>
          <SectionTitle><span className="flex items-center gap-2"><Download size={18} className="text-brand-500" /> Download the Android app (APK)</span></SectionTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Prefer a real installable file? Download the FocusLion Android app and open it on your phone to install.
          </p>
          <a href="/focuslion.apk" download className="mt-4 block">
            <Button size="lg" className="w-full"><Download size={18} /> Download FocusLion.apk</Button>
          </a>
          <p className="mt-2 text-xs text-slate-400">
            On first install Android asks to allow "Install unknown apps" for your browser — tap Allow, then Install. The app loads FocusLion full-screen and updates with the website.
          </p>

          <div className="my-5 h-px bg-slate-200/60 dark:bg-white/10" />

          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400/15 text-xl">🦁</div>
            <div>
              <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white"><Shield size={15} /> FocusLion Guard</div>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                The companion blocker app — truly blocks Instagram, YouTube & co. outside your allowed hours. Runs in the background.
              </p>
              <a href="/focuslion-guard.apk" download className="mt-3 inline-block">
                <Button variant="soft"><Download size={16} /> Download Guard.apk</Button>
              </a>
            </div>
          </div>
        </GlassCard>

        {/* shareable link */}
        <GlassCard className="lg:col-span-2">
          <SectionTitle>Share FocusLion with friends</SectionTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">Send this link — anyone can open it and install the app on their phone:</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 truncate rounded-2xl bg-slate-500/10 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200">{origin}</code>
            <Button onClick={() => {
              if (navigator.share) navigator.share({ title: 'FocusLion 🦁', text: 'Study better with FocusLion!', url: origin })
              else navigator.clipboard.writeText(origin)
            }}>
              <Share size={16} /> Share
            </Button>
          </div>
        </GlassCard>
      </div>
    </Page>
  )
}
