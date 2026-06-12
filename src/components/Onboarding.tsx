import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Button } from './ui'
import { cn } from '../lib/utils'

const STEPS = [
  {
    emoji: '🦁',
    title: 'Welcome to FocusLion!',
    body: 'Your all-in-one study companion: planner, tasks, focus timer, habit & screen-time control — with a lion that grows as you study.',
  },
  {
    emoji: '⏱️',
    title: 'Earn XP by studying',
    body: 'Run Pomodoro or Deep Focus sessions, complete tasks and habits — every action feeds your lion XP. Level up from Cub to Lion King. 👑',
  },
  {
    emoji: '📱',
    title: 'The lion guards your scroll time',
    body: 'Set daily limits and allowed hours for Instagram, YouTube & co. on the Wellbeing page. Cross the line — and the lion ROARS. 🦁',
  },
  {
    emoji: '👨‍👩‍👧',
    title: 'Share progress with parents',
    body: 'The Report page builds an automatic weekly report card — copy it to WhatsApp or print it. Honest numbers, zero arguments.',
  },
]

export function Onboarding() {
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState(() => localStorage.getItem('fl-onboarded') !== '1')
  const navigate = useNavigate()

  function finish(goWellbeing: boolean) {
    localStorage.setItem('fl-onboarded', '1')
    setOpen(false)
    if (goWellbeing) navigate('/wellbeing')
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.94, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 22 }}
            className="glass-strong w-full max-w-md rounded-3xl p-8 text-center"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.25 }}
              >
                <div className="text-6xl">{STEPS[step].emoji}</div>
                <h2 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">{STEPS[step].title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{STEPS[step].body}</p>
              </motion.div>
            </AnimatePresence>

            <div className="mt-6 flex justify-center gap-1.5">
              {STEPS.map((_, i) => (
                <div key={i} className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-brand-500' : 'w-1.5 bg-slate-300 dark:bg-white/20')} />
              ))}
            </div>

            <div className="mt-6 flex gap-3">
              {step < STEPS.length - 1 ? (
                <>
                  <Button variant="ghost" className="flex-1" onClick={() => finish(false)}>Skip</Button>
                  <Button className="flex-1" onClick={() => setStep(step + 1)}>Next</Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" className="flex-1" onClick={() => finish(false)}>Explore myself</Button>
                  <Button className="flex-1" onClick={() => finish(true)}>Set my limits 🦁</Button>
                </>
              )}
            </div>
            <p className="mt-4 text-[11px] text-slate-400">Tip: press <kbd className="rounded bg-slate-500/10 px-1 font-bold">Ctrl K</kbd> anywhere to search and jump around fast.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
