import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

// ---------- GlassCard ----------
export function GlassCard({
  children, className, float, onClick, ref,
}: { children: ReactNode; className?: string; float?: boolean; onClick?: () => void; ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={cn(
        'glass rounded-3xl p-5',
        float && 'float-card',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ---------- Button ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}
export function Button({ variant = 'primary', size = 'md', className, ...rest }: BtnProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2.5 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'primary' &&
          'bg-slate-400/15 dark:bg-white/15 text-slate-800 dark:text-white border border-white/60 dark:border-white/20 backdrop-blur-xl shadow-sm hover:bg-slate-400/25 dark:hover:bg-white/25',
        variant === 'soft' &&
          'bg-brand-500/10 text-brand-600 dark:text-brand-300 hover:bg-brand-500/20',
        variant === 'ghost' &&
          'text-slate-600 dark:text-slate-300 hover:bg-slate-500/10',
        variant === 'danger' &&
          'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20',
        className,
      )}
      {...rest}
    />
  )
}

// ---------- Input ----------
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-2.5 text-sm text-slate-900 dark:text-white outline-none transition focus:ring-2 focus:ring-brand-400/60 placeholder:text-slate-400',
        props.className,
      )}
    />
  )
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 px-4 py-2.5 text-sm text-slate-900 dark:text-white outline-none transition focus:ring-2 focus:ring-brand-400/60 placeholder:text-slate-400',
        props.className,
      )}
    />
  )
}

// ---------- Modal ----------
export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className={cn(
              'glass-strong relative w-full rounded-t-3xl sm:rounded-3xl p-6 max-h-[90vh] overflow-y-auto',
              wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
              <button onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-500/10">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ---------- ProgressRing ----------
export function ProgressRing({
  progress, size = 80, stroke = 8, color = '#4f6bfa', label, sub,
}: { progress: number; size?: number; stroke?: number; color?: string; label?: string; sub?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(1, Math.max(0, progress))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-white/10" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - p) }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute text-center">
        {label && <div className="text-sm font-bold text-slate-900 dark:text-white">{label}</div>}
        {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400">{sub}</div>}
      </div>
    </div>
  )
}

// ---------- Stat chip ----------
export function Stat({
  icon, label, value, tint,
}: { icon: ReactNode; label: string; value: string; tint: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: `${tint}22`, color: tint }}>
        {icon}
      </div>
      <div>
        <div className="text-base font-bold leading-tight text-slate-900 dark:text-white">{value}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </div>
  )
}

// ---------- Empty state ----------
export function Empty({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="text-5xl">{emoji}</div>
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 whitespace-pre-line">{text}</p>
    </div>
  )
}

// ---------- Section title ----------
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{children}</h2>
      {right}
    </div>
  )
}

// ---------- Page wrapper with transition ----------
export function Page({ children, title, subtitle, actions }: {
  children: ReactNode; title: string; subtitle?: string; actions?: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8"
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </motion.div>
  )
}
