import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Salad, Sparkles, RefreshCw } from 'lucide-react'
import { Page, GlassCard, Button, Empty, SectionTitle } from '../components/ui'
import { indianDietPlan, AiError, type DietPlan, type DietItem } from '../lib/ai'
import { cn } from '../lib/utils'

const GOALS = ['Stay fit', 'Lose weight', 'Build muscle', 'General health']
const DIETS = ['Vegetarian', 'Non-vegetarian', 'Eggetarian', 'Vegan']
const REGIONS = ['Any', 'South Indian', 'North Indian', 'Andhra Pradesh', 'Karnataka', 'Tamil Nadu', 'Kerala', 'Punjabi']
const STORE = 'diet-plan'

const MEALS: { key: keyof Pick<DietPlan, 'breakfast' | 'lunch' | 'dinner' | 'snacks'>; label: string; emoji: string }[] = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch', label: 'Lunch', emoji: '☀️' },
  { key: 'dinner', label: 'Dinner', emoji: '🌙' },
  { key: 'snacks', label: 'Snacks', emoji: '🍎' },
]

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
function save(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}

function MealCard({ emoji, label, items }: { emoji: string; label: string; items: DietItem[] }) {
  if (!items.length) return null
  const kcal = items.reduce((a, i) => a + i.kcal, 0)
  const protein = items.reduce((a, i) => a + i.protein, 0)
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <GlassCard float>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 font-bold text-slate-900 dark:text-white">
            <span className="text-lg">{emoji}</span> <span className="truncate">{label}</span>
          </h3>
          <span className="shrink-0 text-[11px] font-semibold text-slate-400">{kcal} kcal · {protein}g</span>
        </div>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="rounded-xl bg-slate-500/5 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-700 dark:text-slate-200">{it.name}</span>
                <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">{it.kcal} kcal</span>
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-300">{it.protein}g protein</span>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  )
}

export function DietPage() {
  const cached = load<{ goal?: string; diet?: string; region?: string; plan?: DietPlan } | null>(STORE, null)
  const [goal, setGoal] = useState(cached?.goal ?? 'Stay fit')
  const [diet, setDiet] = useState(cached?.diet ?? 'Vegetarian')
  const [region, setRegion] = useState(cached?.region ?? 'Any')
  const [plan, setPlan] = useState<DietPlan | null>(cached?.plan ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const p = await indianDietPlan({ goal, diet, region })
      const empty = !p.breakfast.length && !p.lunch.length && !p.dinner.length
      if (empty) { setError('Could not build a plan — please try again.'); return }
      setPlan(p)
      save(STORE, { goal, diet, region, plan: p })
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'Could not reach the AI service. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  // generate a first plan automatically if there's nothing cached
  useEffect(() => {
    if (!plan) void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalKcal = plan ? MEALS.reduce((a, m) => a + plan[m.key].reduce((s, i) => s + i.kcal, 0), 0) : 0
  const totalProtein = plan ? MEALS.reduce((a, m) => a + plan[m.key].reduce((s, i) => s + i.protein, 0), 0) : 0

  return (
    <Page title="Healthy Eating" subtitle="AI Indian diet plan — what to eat across the day, with calories & protein. 🦁">
      {/* controls */}
      <GlassCard className="mb-6 !border-emerald-400/30 bg-gradient-to-br from-emerald-400/10 to-transparent">
        <SectionTitle><span className="flex items-center gap-2"><Salad size={18} className="text-emerald-500" /> Build your day's plan</span></SectionTitle>

        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Goal</div>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <button key={g} onClick={() => setGoal(g)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition',
                goal === g ? 'bg-emerald-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
              {g}
            </button>
          ))}
        </div>

        <div className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Diet preference</div>
        <div className="flex flex-wrap gap-2">
          {DIETS.map((d) => (
            <button key={d} onClick={() => setDiet(d)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition',
                diet === d ? 'bg-emerald-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
              {d}
            </button>
          ))}
        </div>

        <div className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Regional style</div>
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((rg) => (
            <button key={rg} onClick={() => setRegion(rg)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition',
                region === rg ? 'bg-emerald-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
              {rg}
            </button>
          ))}
        </div>

        <Button onClick={generate} disabled={busy} className="mt-4 w-full sm:w-auto">
          {busy ? 'Building your plan…' : <>{plan ? <RefreshCw size={15} /> : <Sparkles size={15} />} {plan ? 'New plan' : 'Generate plan'}</>}
        </Button>
        {error && <p className="mt-2 text-sm font-semibold text-rose-500">{error}</p>}
      </GlassCard>

      {!plan ? (
        <GlassCard>
          <Empty emoji="🥗" text={busy ? 'Cooking up your plan…' : 'Pick a goal and diet, then generate your plan.'} />
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {/* daily targets */}
          <GlassCard className="!border-emerald-400/30">
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400/20 text-2xl">🔥</div>
                <div>
                  <div className="text-2xl font-extrabold leading-none text-slate-900 dark:text-white">
                    {plan.dailyCalories || totalKcal}<span className="ml-1 text-sm font-semibold text-slate-400">kcal/day</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Daily calorie target</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-2xl">💪</div>
                <div>
                  <div className="text-2xl font-extrabold leading-none text-slate-900 dark:text-white">
                    {plan.dailyProtein || totalProtein}<span className="ml-1 text-sm font-semibold text-slate-400">g/day</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Daily protein target</div>
                </div>
              </div>
            </div>
            {plan.summary && <p className="mt-3 break-words text-sm text-slate-600 dark:text-slate-300">{plan.summary}</p>}
            <p className="mt-1 text-[11px] text-slate-400">
              This plan totals ~{totalKcal} kcal and ~{totalProtein}g protein. General guidance for {region !== 'Any' ? `${region} ` : ''}{diet.toLowerCase()} eating — not medical advice.
            </p>
          </GlassCard>

          {/* meals */}
          <div className="grid gap-4 lg:grid-cols-2">
            {MEALS.map((m) => <MealCard key={m.key} emoji={m.emoji} label={m.label} items={plan[m.key]} />)}
          </div>
        </div>
      )}
    </Page>
  )
}
