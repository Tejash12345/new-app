import { supabase } from './supabase'
import type { CareerReport, StartupPlan } from './types'

// ----------------------------------------------------------------------------
// Lion AI Assistant client. All calls go through the `lion-ai` Supabase Edge
// Function, which holds the AI provider key as a server secret — the key is never in
// this app. Every successful call is recorded for per-user usage statistics.
// ----------------------------------------------------------------------------

export type AiTask =
  | 'chat' | 'summarize' | 'hashtags' | 'caption'
  | 'startup' | 'explain' | 'medical' | 'tip' | 'mission'
  | 'briefing' | 'learnpath' | 'career'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export class AiError extends Error {}

/** Low-level call to the Lion AI proxy. Returns the model's text. */
export async function askLion(
  opts: { task: AiTask; input?: string; messages?: ChatTurn[] },
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('lion-ai', {
    body: { task: opts.task, input: opts.input ?? '', messages: opts.messages ?? [] },
  })
  if (error) {
    // FunctionsHttpError carries the function's Response in `context` — read its
    // JSON body so we surface the REAL reason (e.g. bad API key) not the
    // generic "non-2xx status code".
    let detail = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      try {
        const body = await ctx.text()
        const j = JSON.parse(body)
        detail = j.detail ? `${j.error}: ${j.detail}` : (j.error || body || detail)
      } catch { /* keep detail */ }
    }
    // friendly message for the free-tier daily quota / rate-limit case
    if (/RESOURCE_EXHAUSTED|exceeded your current quota|"code":\s*429|rate.?limit/i.test(detail)) {
      throw new AiError("Lion AI has hit today's usage limit 🦁 — it resets daily. Please try again later.")
    }
    throw new AiError(
      /Failed to fetch|FunctionsFetchError/i.test(detail)
        ? 'Could not reach the Lion AI service. Check your connection or deploy the lion-ai function.'
        : detail,
    )
  }
  if (data?.error) throw new AiError(String(data.error))
  // usage is now counted server-side in the Edge Function (only real model
  // calls, not cache hits), so there's nothing to record here.
  return String(data?.text ?? '').trim()
}

// ---- feature helpers (the "AI-powered features") ----
export const summarizePost = (text: string) => askLion({ task: 'summarize', input: text })
export const generateHashtags = (text: string) => askLion({ task: 'hashtags', input: text })
export const improveCaption = (text: string) => askLion({ task: 'caption', input: text })
export const explainConcept = (concept: string) => askLion({ task: 'explain', input: concept })
export const dailyTip = () => askLion({ task: 'tip', input: 'Give me a productivity tip for today.' })
export const dailyBriefing = (context: string) => askLion({ task: 'briefing', input: context })

/**
 * Generate an AI learning roadmap. Returns a summary, ordered steps and a set
 * of reference links (official docs, courses, videos…) the learner can open to
 * actually study each part of the topic.
 */
export async function generateLearningPath(
  topic: string, level: string,
): Promise<{
  summary: string
  steps: { title: string; detail: string }[]
  resources: { title: string; url: string; kind: string }[]
}> {
  const raw = await askLion({ task: 'learnpath', input: `Topic: ${topic}. Level: ${level}.` })
  const obj = parseJson<{
    summary?: unknown
    steps?: { title?: unknown; detail?: unknown }[]
    resources?: { title?: unknown; url?: unknown; kind?: unknown }[]
  }>(raw)
  const steps = Array.isArray(obj?.steps) ? obj!.steps : []
  const resources = Array.isArray(obj?.resources) ? obj!.resources : []
  return {
    summary: String(obj?.summary ?? `Your ${topic} roadmap`).slice(0, 240),
    steps: steps.slice(0, 14).map((s) => ({
      title: String(s?.title ?? 'Step').slice(0, 120),
      detail: String(s?.detail ?? '').slice(0, 280),
    })),
    // only keep links with a safe http(s) URL — never render javascript:/data:
    // links the model might emit, and cap the list so the card stays tidy
    resources: resources
      .map((r) => ({
        title: String(r?.title ?? '').slice(0, 120).trim(),
        url: String(r?.url ?? '').slice(0, 400).trim(),
        kind: String(r?.kind ?? '').slice(0, 24).trim(),
      }))
      .filter((r) => r.title && /^https?:\/\/\S+$/i.test(r.url))
      .slice(0, 8),
  }
}

export type VocabWord = {
  word: string
  phonetic: string
  partOfSpeech: string
  meaning: string
  examples: string[]
  synonyms: string[]
}

/**
 * AI "Word of the Day" — returns one useful vocabulary word with its meaning,
 * example sentences and synonyms. Pass already-seen words to avoid repeats.
 */
export async function wordOfTheDay(avoid: string[] = []): Promise<VocabWord> {
  const avoidLine = avoid.length
    ? ` Do NOT choose any of these already-shown words: ${avoid.slice(0, 40).join(', ')}.`
    : ''
  const prompt =
    'Teach me ONE genuinely useful English vocabulary word (intermediate level — useful in everyday or academic writing, not too obscure).' +
    avoidLine +
    ' Respond with ONLY a JSON object, no extra prose, in exactly this shape: ' +
    '{"word":"","phonetic":"","part_of_speech":"","meaning":"","examples":["",""],"synonyms":["",""]}. ' +
    'Keep "meaning" to one clear sentence, give 2 natural example sentences that actually use the word, and 3 synonyms.'
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<{
    word?: unknown; phonetic?: unknown; part_of_speech?: unknown
    meaning?: unknown; examples?: unknown; synonyms?: unknown
  }>(raw)
  return {
    word: String(o?.word ?? '').trim(),
    phonetic: String(o?.phonetic ?? '').trim(),
    partOfSpeech: String(o?.part_of_speech ?? '').trim(),
    meaning: String(o?.meaning ?? '').trim(),
    examples: arr(o?.examples).map((s) => s.trim()).filter(Boolean).slice(0, 3),
    synonyms: arr(o?.synonyms).map((s) => s.trim()).filter(Boolean).slice(0, 6),
  }
}

export type DietItem = { name: string; kcal: number; protein: number }
export type DietPlan = {
  dailyCalories: number
  dailyProtein: number
  summary: string
  breakfast: DietItem[]
  lunch: DietItem[]
  dinner: DietItem[]
  snacks: DietItem[]
}

/**
 * AI Indian healthy-diet planner — a one-day meal plan (breakfast/lunch/dinner
 * + snacks) of everyday Indian foods, with calories & protein per dish and the
 * recommended daily calorie/protein targets, tailored to a goal + diet type.
 */
export async function indianDietPlan(
  opts: { goal: string; diet: string; region: string; age?: string; gender?: string; mode?: string },
): Promise<DietPlan> {
  const regionLine =
    opts.region && opts.region !== 'Any'
      ? `Use authentic dishes typical of ${opts.region} cuisine. `
      : 'Use everyday Indian dishes from across India. '
  const who = [
    opts.age ? `${opts.age}-year-old` : '',
    opts.gender && opts.gender !== 'Other' ? opts.gender.toLowerCase() : '',
  ].filter(Boolean).join(' ')
  const whoLine = who ? `Calibrate the daily calorie and protein targets for a typical ${who}. ` : ''
  const modeLine =
    opts.mode === 'Easy'
      ? 'Plan mode: EASY — simple, easy-to-cook, flexible everyday meals and comfortable portions. '
      : opts.mode === 'Hard'
        ? 'Plan mode: HARD — strict, high-protein, clean eating with minimal fried/sugary food and disciplined portions for serious fitness. '
        : 'Plan mode: MEDIUM — balanced and moderately disciplined with solid protein. '
  const prompt =
    `Create a realistic ONE-DAY healthy INDIAN diet plan for one person. Goal: ${opts.goal}. Diet preference: ${opts.diet}. Regional style: ${opts.region}. ` +
    (opts.age ? `Age: ${opts.age}. ` : '') +
    (opts.gender ? `Gender: ${opts.gender}. ` : '') +
    whoLine + modeLine +
    regionLine +
    'Examples by region — South: idli, dosa, upma, pongal, sambar, rasam, pesarattu, ragi mudde, bisi bele bath, avial, curd rice; North: roti, paratha, dal, rajma, chana masala, paneer, chole. Match dishes to the requested regional style; eggs/chicken/fish only if the diet preference allows. ' +
    'Respond with ONLY a JSON object, no prose, in exactly this shape: ' +
    '{"daily_calories":0,"daily_protein":0,"summary":"","breakfast":[{"name":"","kcal":0,"protein":0}],"lunch":[],"dinner":[],"snacks":[]}. ' +
    'kcal = calories per serving, protein = grams of protein per serving (numbers only, realistic single-person portions). ' +
    'Give 2-4 items per meal and 1-2 snacks. "summary" = one short sentence on the daily calorie & protein target and the approach.'
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<Record<string, unknown>>(raw)
  const items = (v: unknown): DietItem[] =>
    Array.isArray(v)
      ? v
          .map((x) => {
            const r = (x ?? {}) as Record<string, unknown>
            return {
              name: String(r.name ?? '').trim(),
              kcal: Math.max(0, Math.round(Number(r.kcal) || 0)),
              protein: Math.max(0, Math.round(Number(r.protein) || 0)),
            }
          })
          .filter((it) => it.name)
          .slice(0, 6)
      : []
  return {
    dailyCalories: Math.max(0, Math.round(Number(o?.daily_calories) || 0)),
    dailyProtein: Math.max(0, Math.round(Number(o?.daily_protein) || 0)),
    summary: String(o?.summary ?? '').trim(),
    breakfast: items(o?.breakfast),
    lunch: items(o?.lunch),
    dinner: items(o?.dinner),
    snacks: items(o?.snacks),
  }
}

export type Recipe = {
  time: string
  servings: string
  ingredients: string[]
  steps: string[]
  tip: string
}

/** AI recipe — how to prepare a given dish, Indian home-cooking style. */
export async function recipeFor(dish: string, ctx?: { diet?: string; region?: string; language?: string }): Promise<Recipe> {
  const extra = [
    ctx?.region && ctx.region !== 'Any' ? `${ctx.region} style` : '',
    ctx?.diet && ctx.diet !== 'Non-vegetarian' ? ctx.diet.toLowerCase() : '',
  ].filter(Boolean).join(', ')
  const lang = (ctx?.language ?? 'English').trim()
  // Read easily on a phone AND sound natural when spoken aloud by the voice
  // reader: use simple, modern, everyday words — not old/bookish/literary ones.
  const simpleLine =
    'Use very simple, modern, everyday language a school student or first-time cook understands. ' +
    'Short, clear sentences and common words. '
  const langLine =
    lang && lang.toLowerCase() !== 'english'
      ? `Write ALL values — time, servings, ingredients, steps and the tip — in ${lang} using its native script, ` +
        `in the simple, casual, spoken style people actually use today — NOT old-fashioned, literary or heavily ` +
        `Sanskritised ${lang}. Prefer the common everyday word over the formal/pure one, and it's fine to keep ` +
        `widely-used English kitchen words (oil, pan, mix, stove, minutes) as people normally say them. ` +
        `Keep the JSON keys in English. `
      : ''
  const prompt =
    `Give a simple home recipe to prepare "${dish}"${extra ? ` (${extra})` : ''}, Indian home-cooking style. ` +
    simpleLine + langLine +
    'Respond with ONLY a JSON object, no prose: {"time":"","servings":"","ingredients":["",""],"steps":["",""],"tip":""}. ' +
    'time = total time like "20 min"; servings like "1 serving"; 5-12 ingredients with simple quantities; ' +
    '4-9 clear steps (each step plain text, no leading numbers); tip = one short helpful tip. Keep it beginner-friendly.'
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<Record<string, unknown>>(raw)
  return {
    time: String(o?.time ?? '').trim(),
    servings: String(o?.servings ?? '').trim(),
    ingredients: arr(o?.ingredients).map((s) => s.trim()).filter(Boolean).slice(0, 16),
    steps: arr(o?.steps).map((s) => s.trim()).filter(Boolean).slice(0, 12),
    tip: String(o?.tip ?? '').trim(),
  }
}

// Robust JSON extraction: handles ```json fences and stray prose around the
// object, so a slightly messy model response still parses.
function parseJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) as T } catch { /* try to extract */ }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) as T } catch { /* give up */ } }
  return null
}
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/** AI Career Coach: target role + resume/skills -> structured readiness report. */
export async function careerReport(role: string, resume: string): Promise<CareerReport> {
  const raw = await askLion({ task: 'career', input: `Target role: ${role}\n\nResume / skills:\n${resume}` })
  const o = parseJson<Partial<CareerReport>>(raw)
  return {
    readiness: Math.max(0, Math.min(100, Math.round(Number(o?.readiness) || 0))),
    verdict: String(o?.verdict ?? 'Here is your readiness report.'),
    strengths: arr(o?.strengths),
    gaps: arr(o?.gaps),
    improvements: arr(o?.improvements),
    skillsToLearn: arr(o?.skillsToLearn),
    interviewQuestions: arr(o?.interviewQuestions),
  }
}

/** AI Startup Co-Founder: idea -> structured business plan. */
export async function startupPlan(idea: string): Promise<StartupPlan> {
  const raw = await askLion({ task: 'startup', input: idea })
  const o = parseJson<Partial<StartupPlan>>(raw)
  const roadmap = Array.isArray(o?.roadmap)
    ? o!.roadmap.map((r) => ({ phase: String(r?.phase ?? 'Phase'), detail: String(r?.detail ?? '') }))
    : []
  return {
    summary: String(o?.summary ?? idea),
    market: String(o?.market ?? ''),
    revenueModel: arr(o?.revenueModel),
    competitors: arr(o?.competitors),
    mvpFeatures: arr(o?.mvpFeatures),
    team: arr(o?.team),
    roadmap,
  }
}

/** Generate today's personalized mission. Returns parsed {title, detail, xp}. */
export async function generateMission(context: string): Promise<{ title: string; detail: string; xp: number }> {
  const raw = await askLion({ task: 'mission', input: context })
  const o = parseJson<{ title?: unknown; detail?: unknown; xp?: unknown }>(raw)
  if (o && (o.title || o.detail)) {
    return {
      title: String(o.title ?? 'Today’s Lion Mission').slice(0, 80),
      detail: String(o.detail ?? '').slice(0, 240),
      xp: Math.max(10, Math.min(50, Math.round(Number(o.xp) || 20))),
    }
  }
  // unparseable / truncated — clean fallback, never echo raw JSON
  return { title: 'Today’s Lion Mission', detail: 'Tackle one focused 25-minute study session today. 🦁', xp: 20 }
}
