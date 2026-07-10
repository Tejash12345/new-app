import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/app'
import { Button, MascotImg } from './ui'

/**
 * The app's own yes/no dialog, used instead of window.confirm() — the native
 * WebView dialog shows the raw site URL ("…vercel.app says") and looks nothing
 * like the app. Trigger it with confirmDialog('message') from store/app.ts.
 * Tapping the backdrop counts as "No" so a stray tap never confirms anything.
 */
export function ConfirmDialog() {
  const { confirm, answerConfirm } = useApp()

  return (
    <AnimatePresence>
      {confirm.open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-6 backdrop-blur-sm"
          onClick={() => answerConfirm(false)}
        >
          <motion.div
            initial={{ scale: 0.92, y: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            className="glass-strong w-full max-w-xs rounded-3xl p-6 text-center"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={confirm.message}
          >
            <MascotImg className="mx-auto w-24 drop-shadow-[0_6px_18px_rgba(255,170,60,0.4)]" />
            <p className="mt-3 text-[15px] font-semibold leading-relaxed text-slate-800 dark:text-slate-100">
              {confirm.message}
            </p>
            <div className="mt-5 flex gap-3">
              {/* an empty noLabel = notice mode (alert replacement): OK only */}
              {confirm.noLabel && (
                <Button variant="ghost" className="flex-1 !bg-slate-500/10" onClick={() => answerConfirm(false)}>
                  {confirm.noLabel}
                </Button>
              )}
              <Button
                className="flex-1 !border-transparent !bg-gradient-to-r !from-amber-400 !to-orange-400 !text-[#241a05] !shadow-lg !shadow-orange-500/30"
                onClick={() => answerConfirm(true)}
              >
                {confirm.yesLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
