import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Salad, Sparkles, RefreshCw } from 'lucide-react'
import { Page, GlassCard, Button, Empty, SectionTitle, Input, Modal } from '../components/ui'
import { indianDietPlan, recipeFor, AiError, type DietPlan, type DietItem, type Recipe } from '../lib/ai'
import { cn } from '../lib/utils'

const GOALS = ['Stay fit', 'Lose weight', 'Build muscle', 'General health']
const DIETS = ['Vegetarian', 'Non-vegetarian', 'Eggetarian', 'Vegan']
const REGIONS = ['Any', 'South Indian', 'North Indian', 'Andhra Pradesh', 'Karnataka', 'Tamil Nadu', 'Kerala', 'Punjabi']
const GENDERS = ['Male', 'Female', 'Other']
const MODES = ['Easy', 'Medium', 'Hard']
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

function MealCard({ emoji, label, items, onSelect }: { emoji: string; label: string; items: DietItem[]; onSelect: (dish: string) => void }) {
  if (!items.length) return null
  const kcal = items.reduce((a, i) => a + i.kcal, 0)
  const protein = items.reduce((a, i) => a + i.protein, 0)
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <GlassCard float className="!p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-slate-500/10 text-base">{emoji}</span>
          <h3 className="min-w-0 flex-1 truncate font-bold text-slate-900 dark:text-white">{label}</h3>
          <span className="shrink-0 rounded-full bg-slate-500/10 px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">{kcal} kcal · {protein}g</span>
        </div>
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i}>
              <button type="button" onClick={() => onSelect(it.name)}
                className="flex w-full items-center gap-3 rounded-2xl bg-slate-500/[0.06] px-3.5 py-2.5 text-left transition hover:bg-emerald-500/10 active:scale-[0.99]">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-slate-700 dark:text-slate-100">{it.name}</span>
                  <span className="mt-0.5 block text-[10px] font-bold text-emerald-600/80 dark:text-emerald-400/80">Tap for recipe →</span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <span className="block text-sm font-extrabold text-amber-500">{it.kcal}<span className="text-[10px] font-bold text-slate-400"> kcal</span></span>
                  <span className="block text-[11px] font-bold text-emerald-500">{it.protein}g protein</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </GlassCard>
    </motion.div>
  )
}

export function DietPage() {
  const cached = load<{ goal?: string; diet?: string; region?: string; age?: string; gender?: string; mode?: string; plan?: DietPlan } | null>(STORE, null)
  const [goal, setGoal] = useState(cached?.goal ?? 'Stay fit')
  const [diet, setDiet] = useState(cached?.diet ?? 'Vegetarian')
  const [region, setRegion] = useState(cached?.region ?? 'Any')
  const [age, setAge] = useState(cached?.age ?? '')
  const [gender, setGender] = useState(cached?.gender ?? 'Male')
  const [mode, setMode] = useState(cached?.mode ?? 'Medium')
  const [plan, setPlan] = useState<DietPlan | null>(cached?.plan ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // recipe modal — opens when a dish is tapped
  const [recipeDish, setRecipeDish] = useState<string | null>(null)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [recipeBusy, setRecipeBusy] = useState(false)
  const [recipeErr, setRecipeErr] = useState('')

  async function openRecipe(dish: string) {
    setRecipeDish(dish); setRecipeErr('')
    const key = 'recipe-' + dish.toLowerCase().trim()
    const cached = load<Recipe | null>(key, null)
    if (cached?.steps?.length) { setRecipe(cached); setRecipeBusy(false); return }
    setRecipe(null); setRecipeBusy(true)
    try {
      const r = await recipeFor(dish, { diet, region })
      if (!r.steps.length) { setRecipeErr('Could not load the recipe — please try again.'); return }
      setRecipe(r)
      save(key, r)
    } catch (e) {
      setRecipeErr(e instanceof AiError ? e.message : 'Could not reach the AI service. Check your connection.')
    } finally {
      setRecipeBusy(false)
    }
  }

  async function generate() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const p = await indianDietPlan({ goal, diet, region, age: age.trim(), gender, mode })
      const empty = !p.breakfast.length && !p.lunch.length && !p.dinner.length
      if (empty) { setError('Could not build a plan — please try again.'); return }
      setPlan(p)
      save(STORE, { goal, diet, region, age: age.trim(), gender, mode, plan: p })
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

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Age</div>
            <Input type="number" inputMode="numeric" min={5} max={100} value={age}
              onChange={(e) => setAge(e.target.value)} placeholder="e.g. 21" />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Gender</div>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map((g) => (
                <button key={g} onClick={() => setGender(g)}
                  className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    gender === g ? 'bg-emerald-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Plan mode</div>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button key={m} onClick={() => setMode(m)}
              title={m === 'Easy' ? 'Simple, flexible everyday meals' : m === 'Hard' ? 'Strict, high-protein, clean eating' : 'Balanced & moderately disciplined'}
              className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition',
                mode === m ? 'bg-emerald-500 text-white' : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20')}>
              {m}
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
          <GlassCard className="!border-emerald-400/30 bg-gradient-to-br from-emerald-400/[0.07] to-transparent">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-3xl bg-gradient-to-br from-amber-400/20 to-amber-400/5 p-4 ring-1 ring-inset ring-amber-400/20">
                <div className="text-2xl">🔥</div>
                <div className="mt-1.5 text-2xl font-extrabold leading-none text-slate-900 dark:text-white sm:text-3xl">
                  {plan.dailyCalories || totalKcal}<span className="ml-0.5 text-xs font-semibold text-slate-400">kcal</span>
                </div>
                <div className="mt-1 text-[11px] font-semibold text-slate-500">Daily calories</div>
              </div>
              <div className="rounded-3xl bg-gradient-to-br from-emerald-400/20 to-emerald-400/5 p-4 ring-1 ring-inset ring-emerald-400/20">
                <div className="text-2xl">💪</div>
                <div className="mt-1.5 text-2xl font-extrabold leading-none text-slate-900 dark:text-white sm:text-3xl">
                  {plan.dailyProtein || totalProtein}<span className="ml-0.5 text-xs font-semibold text-slate-400">g</span>
                </div>
                <div className="mt-1 text-[11px] font-semibold text-slate-500">Daily protein</div>
              </div>
            </div>
            {plan.summary && <p className="mt-3 break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300">{plan.summary}</p>}
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              This plan totals ~{totalKcal} kcal · ~{totalProtein}g protein. General guidance for {region !== 'Any' ? `${region} ` : ''}{diet.toLowerCase()} eating — not medical advice.
            </p>
          </GlassCard>

          {/* meals */}
          <div className="grid gap-4 lg:grid-cols-2">
            {MEALS.map((m) => <MealCard key={m.key} emoji={m.emoji} label={m.label} items={plan[m.key]} onSelect={openRecipe} />)}
          </div>
        </div>
      )}

      {/* recipe / preparation sheet — opens when a dish is tapped */}
      <Modal open={!!recipeDish} onClose={() => setRecipeDish(null)} title={recipeDish ?? 'Recipe'}>
        {recipeBusy ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-24 rounded bg-slate-500/15" />
            <div className="h-3 w-full rounded bg-slate-500/10" />
            <div className="h-3 w-5/6 rounded bg-slate-500/10" />
            <div className="h-3 w-2/3 rounded bg-slate-500/10" />
            <div className="h-3 w-4/5 rounded bg-slate-500/10" />
          </div>
        ) : recipeErr ? (
          <div className="py-4 text-center">
            <p className="text-sm font-semibold text-rose-500">{recipeErr}</p>
            <Button onClick={() => recipeDish && openRecipe(recipeDish)} className="mt-3"><RefreshCw size={15} /> Try again</Button>
          </div>
        ) : recipe ? (
          <div className="space-y-4">
            {(recipe.time || recipe.servings) && (
              <div className="flex flex-wrap gap-2">
                {recipe.time && <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-300">⏱ {recipe.time}</span>}
                {recipe.servings && <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-300">🍽 {recipe.servings}</span>}
              </div>
            )}
            {recipe.ingredients.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Ingredients</div>
                <ul className="space-y-1.5">
                  {recipe.ingredients.map((ing, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span className="break-words text-sm text-slate-700 dark:text-slate-200">{ing}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {recipe.steps.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">How to prepare</div>
                <ol className="space-y-2.5">
                  {recipe.steps.map((st, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">{i + 1}</span>
                      <span className="break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200">{st}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {recipe.tip && (
              <div className="rounded-2xl bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-700 dark:text-amber-300">💡 {recipe.tip}</div>
            )}
          </div>
        ) : null}
      </Modal>
    </Page>
  )
}
