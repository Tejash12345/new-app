import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'
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

/** Low-level call to the Lion AI proxy. Returns the model's text.
 *  `fast: true` routes to the lighter fast model — for interactive helpers
 *  (smart replies) where a snappy answer beats maximum quality. */
export async function askLion(
  opts: { task: AiTask; input?: string; messages?: ChatTurn[]; fast?: boolean },
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('lion-ai', {
    body: { task: opts.task, input: opts.input ?? '', messages: opts.messages ?? [], fast: opts.fast === true },
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

/**
 * Streaming variant of askLion for the interactive chat. Calls the lion-ai
 * function with stream:true and fires onChunk(delta) as tokens arrive, so Leo's
 * reply shows up immediately instead of after the whole answer is generated.
 *
 * Fully backward compatible: if the deployed function doesn't stream (it returns
 * application/json instead of a text stream), we read its full {text} response
 * and deliver it in one onChunk call — so this works whether or not the new
 * edge function is deployed yet. Returns the complete reply text.
 */
export async function askLionStream(
  opts: { task: AiTask; input?: string; messages?: ChatTurn[] },
  onChunk: (delta: string) => void,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new AiError('Please sign in to chat with Leo. 🦁')

  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/lion-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ task: opts.task, input: opts.input ?? '', messages: opts.messages ?? [], stream: true, fast: true }),
    })
  } catch {
    throw new AiError('Could not reach the Lion AI service. Check your connection.')
  }

  const contentType = res.headers.get('content-type') ?? ''
  // Not a text stream — an error, or an older (non-streaming) function build.
  if (!res.body || !contentType.includes('text/plain')) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>))
    if (!res.ok || body.error) {
      const detail = String(body.error ?? `AI request failed (${res.status})`)
      if (/limit|quota|RESOURCE_EXHAUSTED|429|rate.?limit/i.test(detail)) {
        throw new AiError("Lion AI has hit today's usage limit 🦁 — it resets daily. Please try again later.")
      }
      throw new AiError(detail)
    }
    const text = String(body.text ?? '').trim()
    if (text) onChunk(text) // no stream available — deliver the whole reply at once
    return text
  }

  // Streamed plain-text body: forward each delta as it arrives.
  // Some NIM endpoints hold a short-reply connection open (no prompt terminal
  // frame), so we guard each read with an idle timeout: wait patiently for the
  // FIRST token (a cold model can take ~1min), but once tokens are flowing a
  // multi-second gap means the reply is complete — stop and cancel.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const FIRST_TOKEN_MS = 60_000 // give up (with a friendly error) if the busy free tier hasn't started in 60s
  const IDLE_MS = 5_000         // once tokens flow, a 5s gap means the reply is done
  let full = ''
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const idle = new Promise<'IDLE'>((resolve) => {
      timer = setTimeout(() => resolve('IDLE'), full ? IDLE_MS : FIRST_TOKEN_MS)
    })
    let result: ReadableStreamReadResult<Uint8Array> | 'IDLE'
    try {
      result = await Promise.race([reader.read(), idle])
    } finally {
      clearTimeout(timer)
    }
    if (result === 'IDLE') {
      try { await reader.cancel() } catch { /* already closed */ }
      // timed out before ANY token → the service is busy; surface it instead of hanging
      if (!full) throw new AiError('Leo is busy right now and took too long to respond. Please try again in a moment. 🦁')
      break
    }
    if (result.done) {
      try { await reader.cancel() } catch { /* already closed */ }
      break
    }
    const chunk = decoder.decode(result.value, { stream: true })
    if (chunk) { full += chunk; onChunk(chunk) }
  }
  return full.trim()
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
  const isEnglish = lang.toLowerCase() === 'english'

  const parse = (raw: string): Recipe => {
    const o = parseJson<Record<string, unknown>>(raw)
    return {
      time: String(o?.time ?? '').trim(),
      servings: String(o?.servings ?? '').trim(),
      ingredients: arr(o?.ingredients).map((s) => s.trim()).filter(Boolean).slice(0, 16),
      steps: arr(o?.steps).map((s) => s.trim()).filter(Boolean).slice(0, 12),
      tip: String(o?.tip ?? '').trim(),
    }
  }
  const ask = async (content: string): Promise<Recipe> => {
    let r = parse(await askLion({ task: 'chat', messages: [{ role: 'user', content }] }))
    if (!r.steps.length) r = parse(await askLion({ task: 'chat', messages: [{ role: 'user', content }] })) // one retry
    return r
  }

  // Step 1 — get the AUTHENTIC recipe in English. The model knows dishes
  // correctly in English but drifts to a similar dish (e.g. Pesarattu → urad
  // instead of green gram) when writing straight into an Indian language.
  const enPrompt =
    `Give the AUTHENTIC, traditional home recipe for exactly "${dish}"${extra ? ` (${extra})` : ''}, Indian home-cooking style — ` +
    `use its real main ingredient(s) and method; do not confuse it with a similar dish. Use simple, everyday words. ` +
    'Respond with ONLY a JSON object, no prose, no markdown: {"time":"","servings":"","ingredients":["",""],"steps":["",""],"tip":""}. ' +
    'Keep it SHORT: time like "20 min"; servings like "1 serving"; 5-8 ingredients (a few words each); ' +
    '4-6 short steps (ONE short sentence each, no leading numbers); tip = one short line.'
  const recipe = await ask(enPrompt)
  if (isEnglish || !recipe.steps.length) return recipe

  // Step 2 — translate into the chosen language WITHOUT changing the recipe, so
  // the (now-correct) ingredients survive; only the wording changes. Much more
  // reliable than generating directly in a low-resource language.
  const trPrompt =
    `Translate this recipe into ${lang}, written in ${lang}'s native script, in simple modern spoken ${lang}. ` +
    `Keep the SAME ingredients, quantities and steps — do NOT change the recipe, only the language. ` +
    `Keep the JSON keys in English. Write the native script directly; do NOT use \\u escape codes. ` +
    `Recipe: ${JSON.stringify({ time: recipe.time, servings: recipe.servings, ingredients: recipe.ingredients, steps: recipe.steps, tip: recipe.tip })}. ` +
    `Respond with ONLY the translated JSON object, same shape.`
  const translated = await ask(trPrompt)
  // if translation fails, fall back to the correct English recipe rather than nothing
  return translated.steps.length ? translated : recipe
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

// ---------- AI Quiz Arena ----------
export type QuizQuestion = { q: string; options: string[]; answer: number; explain: string; asked: string }

/**
 * AI quiz generator — multiple-choice questions on any topic, or on the
 * user's own study material when `source` is given. `style` (optional)
 * makes questions match a real exam's pattern (NEET, JEE, NORCET…).
 * `mode`: 'pyq' = real previous-year questions tagged in `asked` with the
 * session they appeared in (e.g. "NEET 2022"); 'repeated' = the most
 * frequently repeated questions across years; 'fresh' (default) = new ones.
 */
export async function generateQuiz(
  opts: {
    topic: string; difficulty: string; count: number
    source?: string; style?: string; mode?: 'fresh' | 'pyq' | 'repeated'
    /** question texts already shown — batching (20-Q quizzes) passes the first batch here to avoid duplicates */
    avoid?: string[]
  },
): Promise<QuizQuestion[]> {
  const src = opts.source?.trim()
    ? ` Base every question ONLY on this study material:\n"""${opts.source.slice(0, 4000)}"""`
    : ''
  const avoid = opts.avoid?.length
    ? ` Do NOT repeat any of these already-asked questions: ${opts.avoid.map((a) => `"${a.slice(0, 60)}"`).join('; ')}.`
    : ''
  const style = opts.style?.trim() ? ` Question style: ${opts.style.trim()}.` : ''
  const pyq =
    opts.mode === 'pyq'
      ? ' Use REAL previous-year questions (PYQs) from actual past papers of this exam, reproduced as accurately as you remember them. ' +
        'Fill "asked" with the exam name and session each question appeared in — as specific as you genuinely know it, e.g. "NEET 2022", "JEE Main Jan 2023", "NORCET Nov 2023" (month + year when you know it, otherwise the year alone). ' +
        'If you are NOT certain a question is a real PYQ, write "PYQ-style" in "asked" instead of inventing a year — never guess dates.'
      : opts.mode === 'repeated'
        ? ' Choose the MOST REPEATED questions — the high-frequency questions that have been asked again and again across different years of this exam (the ones toppers prioritize). ' +
          'Every question MUST list in "asked" the exam name and the years it was asked, e.g. "NEET 2019, 2021, 2023" or "SSC CGL 2018 & 2022" — list ALL the years you know of. ' +
          'If you only remember roughly, give your best estimate marked with ~, e.g. "RRB NTPC ~2016, 2019". ' +
          'Write "Frequently asked" alone ONLY if you genuinely cannot recall even an approximate year.'
        : ' Set "asked" to an empty string "" for every question.'
  const prompt =
    `Create a ${opts.count}-question multiple-choice quiz about "${opts.topic}" for a student. Difficulty: ${opts.difficulty}.` +
    style + pyq + src + avoid +
    ' Respond with ONLY a JSON object, no prose, no markdown: ' +
    '{"questions":[{"q":"","options":["","","",""],"answer":0,"explain":"","asked":""}]}. ' +
    'Rules: exactly 4 plausible options per question; "answer" = the index (0-3) of the correct option — vary its position across questions; ' +
    '"explain" = one short sentence on why that answer is correct — include the relevant date, month or year when the fact is time-based. ' +
    'Questions must be clear, factual and unambiguous.'
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<{ questions?: unknown }>(raw)
  return (Array.isArray(o?.questions) ? o!.questions : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>
      const options = arr(r.options).map((s) => s.trim()).filter(Boolean).slice(0, 4)
      return {
        q: String(r.q ?? '').trim(),
        options,
        answer: Math.max(0, Math.min(options.length - 1, Math.round(Number(r.answer) || 0))),
        explain: String(r.explain ?? '').trim(),
        // only trust the year tag in PYQ/repeated modes — otherwise force it empty
        asked: opts.mode === 'pyq' || opts.mode === 'repeated' ? String(r.asked ?? '').trim().slice(0, 60) : '',
      }
    })
    .filter((q) => q.q && q.options.length === 4)
    .slice(0, opts.count)
}

/**
 * Deep-dive tutor explanation for one quiz question — the underlying
 * concept, why the right option wins and the others fail, a memory trick,
 * and what to revise. Plain text (not JSON), called on demand.
 */
export async function explainQuizQuestion(
  opts: { q: string; options: string[]; answer: number; topic: string },
): Promise<string> {
  const prompt =
    `You are Leo, a friendly exam tutor. A student preparing for ${opts.topic} wants a DETAILED explanation of this question:\n\n` +
    `Question: ${opts.q}\n` +
    opts.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n') +
    `\nCorrect answer: ${String.fromCharCode(65 + opts.answer)}. ${opts.options[opts.answer] ?? ''}\n\n` +
    'Explain in this order, with these exact section headers on their own lines:\n' +
    '📖 Concept — the core concept behind this question in 2-3 simple sentences (include key dates/years if the fact is time-based).\n' +
    '✅ Why this answer — why the correct option is right.\n' +
    '❌ Why not the others — one short line each on why the other options are wrong.\n' +
    '💎 Clinical pearl — one high-yield clinical/practical point examiners love (skip this line for non-clinical topics).\n' +
    '🧠 Memory trick — one mnemonic or quick way to remember it.\n' +
    '📚 Reference & revise — the standard textbook/reference for this fact plus 2-3 related sub-topics to study, and how frequently this concept appears in the exam (e.g. "asked almost every year").\n' +
    'Plain text only (no markdown symbols like ** or #), under 230 words, simple words a student understands.'
  return askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
}

/**
 * Mini-lesson on the concept behind a question — a structured teach-me
 * card (definition, key points, management, nursing role, mnemonic).
 * Plain text, on demand.
 */
export async function teachTopic(concept: string, examName: string): Promise<string> {
  const prompt =
    `You are Leo, a friendly ${examName} faculty tutor. Teach the topic behind this, from scratch, to a student who got it wrong: "${concept.slice(0, 400)}".\n` +
    'Use these exact section headers on their own lines (skip any that do not apply):\n' +
    '📖 What it is — simple definition, 2-3 sentences.\n' +
    '🔑 Key points — 3-5 must-know facts (values, classifications, criteria).\n' +
    '⚠️ Signs & red flags — what presentation/findings to recognise.\n' +
    '💊 Management — first-line treatment/action in exam terms.\n' +
    '🩺 Nursing role — what the nurse assesses/does first (if a nursing exam).\n' +
    '🧠 Mnemonic — one memory aid.\n' +
    '⭐ High-yield — 2-3 points this exam repeatedly asks about this topic.\n' +
    'Plain text only (no ** or #), under 260 words, simple language.'
  return askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
}

// ---------- AI Exam Study Planner ----------
export type ExamStudyPlan = {
  summary: string
  phases: { title: string; detail: string }[]
  dailyRoutine: string[]
  mockSchedule: string
  tips: string[]
}

/**
 * Personalized exam study plan — days left + hours/day + level in,
 * phased syllabus coverage, a daily routine, a mock-test calendar and
 * exam-specific tips out.
 */
export async function examStudyPlan(
  opts: { exam: string; daysLeft: number; hoursPerDay: number; level: string },
): Promise<ExamStudyPlan> {
  const prompt =
    `You are an expert ${opts.exam} coach. Create a personalized study plan. ` +
    `Days until the exam: ${opts.daysLeft}. Study hours available per day: ${opts.hoursPerDay}. Current preparation level: ${opts.level}. ` +
    'Respond with ONLY a JSON object, no prose: ' +
    '{"summary":"","phases":[{"title":"","detail":""}],"daily_routine":["",""],"mock_schedule":"","tips":["",""]}. ' +
    `"summary" = one motivating sentence sizing up the runway; ` +
    `"phases" = 3-5 study phases dividing the ${opts.daysLeft} days (title like "Days 1-20: Foundations", detail = which subjects/topics + strategy, weighted toward high-yield areas for this exam and the student's level); ` +
    `"daily_routine" = 4-6 short bullets filling ${opts.hoursPerDay} hours (new topics, revision, MCQ practice, flashcards, breaks); ` +
    '"mock_schedule" = one line on when and how often to take mock tests as the exam nears; ' +
    '"tips" = 3 sharp, exam-specific tips. Keep every string short and concrete.'
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<Record<string, unknown>>(raw)
  const phases = (Array.isArray(o?.phases) ? o!.phases : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>
      return { title: String(r.title ?? '').trim().slice(0, 80), detail: String(r.detail ?? '').trim().slice(0, 400) }
    })
    .filter((p) => p.title)
    .slice(0, 6)
  return {
    summary: String(o?.summary ?? '').trim(),
    phases,
    dailyRoutine: arr(o?.daily_routine).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    mockSchedule: String(o?.mock_schedule ?? '').trim(),
    tips: arr(o?.tips).map((s) => s.trim()).filter(Boolean).slice(0, 5),
  }
}

// ---------- AI Day Planner ----------
export type DayPlanBlock = { start: string; end: string; title: string; subject: string; emoji: string }
export type DayPlan = { summary: string; blocks: DayPlanBlock[] }

/** AI day planner — turns tasks/exams/timetable + the current time into an hour-by-hour plan for the rest of today. */
export async function planMyDay(context: string): Promise<DayPlan> {
  const prompt =
    'You are a study planner. Build a realistic, motivating schedule for the REST of today from the student context below. ' +
    'Respond with ONLY a JSON object, no prose: {"summary":"","blocks":[{"start":"HH:MM","end":"HH:MM","title":"","subject":"","emoji":""}]}. ' +
    'Rules: 4-8 blocks; 24-hour times; start at or after the current time and end by 22:30; 25-90 minute work blocks with a short break after long stretches; ' +
    'do NOT overlap the fixed timetable blocks; prioritize urgent/overdue tasks and upcoming exams; include one short wellbeing block (walk, water, stretch). ' +
    '"summary" = one energetic sentence about the plan.\n\n' + context
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<{ summary?: unknown; blocks?: unknown }>(raw)
  // "9:5" → "09:05"; anything that isn't a valid time drops the block
  const hhmm = (s: unknown): string | null => {
    const m = String(s ?? '').trim().match(/^(\d{1,2}):(\d{2})/)
    if (!m) return null
    return `${String(Math.min(23, Number(m[1]))).padStart(2, '0')}:${String(Math.min(59, Number(m[2]))).padStart(2, '0')}`
  }
  const blocks = (Array.isArray(o?.blocks) ? o!.blocks : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>
      const start = hhmm(r.start)
      const end = hhmm(r.end)
      if (!start || !end || end <= start) return null
      return {
        start, end,
        title: String(r.title ?? '').trim().slice(0, 80),
        subject: String(r.subject ?? '').trim().slice(0, 40),
        emoji: String(r.emoji ?? '📚').trim().slice(0, 4) || '📚',
      }
    })
    .filter((b): b is DayPlanBlock => !!b && !!b.title)
    .slice(0, 10)
  return { summary: String(o?.summary ?? '').trim(), blocks }
}

// ---------- Weekly AI Insights ----------
export type WeeklyInsights = {
  headline: string
  weekScore: number
  patterns: string[]
  recommendations: string[]
  kudos: string
}

/** AI weekly insights — finds real patterns in the week's study/task/mood data. */
export async function weeklyInsights(context: string): Promise<WeeklyInsights> {
  const prompt =
    "You are a data-savvy study coach. Analyze this student's week and find REAL patterns in the numbers. " +
    'Respond with ONLY a JSON object, no prose: ' +
    '{"headline":"","week_score":0,"patterns":["",""],"recommendations":["",""],"kudos":""}. ' +
    '"headline" = one punchy sentence summarizing the week; "week_score" = 0-100 overall productivity score; ' +
    '"patterns" = 2-4 specific observations grounded in the data (mention actual numbers, days or hours); ' +
    '"recommendations" = exactly 3 concrete, doable actions for next week; "kudos" = one line celebrating their best win.\n\n' + context
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<Record<string, unknown>>(raw)
  return {
    headline: String(o?.headline ?? '').trim(),
    weekScore: Math.max(0, Math.min(100, Math.round(Number(o?.week_score) || 0))),
    patterns: arr(o?.patterns).map((s) => s.trim()).filter(Boolean).slice(0, 5),
    recommendations: arr(o?.recommendations).map((s) => s.trim()).filter(Boolean).slice(0, 4),
    kudos: String(o?.kudos ?? '').trim(),
  }
}

/** AI flashcard maker — turns study material into question/answer cards. */
export async function flashcardsFrom(text: string, count: number): Promise<{ front: string; back: string }[]> {
  const prompt =
    `Create ${count} flashcards from this study material. ` +
    'Respond with ONLY a JSON object, no prose: {"cards":[{"front":"","back":""}]}. ' +
    '"front" = a short question, term or fill-in-the-blank; "back" = the concise answer (max 2 sentences). ' +
    'Cover the MOST important facts; no duplicate cards; keep both sides short.\n\nMaterial:\n"""' +
    text.slice(0, 4000) + '"""'
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }] })
  const o = parseJson<{ cards?: unknown }>(raw)
  return (Array.isArray(o?.cards) ? o!.cards : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>
      return { front: String(r.front ?? '').trim().slice(0, 300), back: String(r.back ?? '').trim().slice(0, 400) }
    })
    .filter((c) => c.front && c.back)
    .slice(0, Math.max(count, 20))
}

/**
 * AI smart replies for the chat — three short, natural suggestions for what
 * to send next, based on the recent conversation. Uses the fast model so the
 * chips appear in a couple of seconds.
 */
export async function smartReplies(conversation: string): Promise<string[]> {
  const prompt =
    'You are suggesting quick replies for "Me" in a chat between two student friends. ' +
    'Read the conversation and suggest 3 different short replies "Me" could send next — ' +
    'natural, casual and friendly (an emoji is fine), each under 12 words, in the same language the friends are using. ' +
    'Respond with ONLY a JSON object, no prose: {"replies":["","",""]}.\n\nConversation:\n' +
    conversation.slice(0, 2000)
  const raw = await askLion({ task: 'chat', messages: [{ role: 'user', content: prompt }], fast: true })
  const o = parseJson<{ replies?: unknown }>(raw)
  return arr(o?.replies)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .slice(0, 3)
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
