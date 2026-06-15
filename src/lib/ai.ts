import { supabase } from './supabase'
import type { CareerReport, StartupPlan } from './types'

// ----------------------------------------------------------------------------
// Lion AI Assistant client. All calls go through the `lion-ai` Supabase Edge
// Function, which holds the Gemini key as a server secret — the key is never in
// this app. Every successful call is recorded for per-user usage statistics.
// ----------------------------------------------------------------------------

export type AiTask =
  | 'chat' | 'summarize' | 'hashtags' | 'caption'
  | 'startup' | 'explain' | 'medical' | 'tip' | 'mission'
  | 'briefing' | 'learnpath' | 'career'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export class AiError extends Error {}

/** Low-level call to the Gemini proxy. Returns the model's text. */
export async function askLion(
  opts: { task: AiTask; input?: string; messages?: ChatTurn[] },
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('lion-ai', {
    body: { task: opts.task, input: opts.input ?? '', messages: opts.messages ?? [] },
  })
  if (error) {
    // FunctionsHttpError carries the function's Response in `context` — read its
    // JSON body so we surface the REAL reason (e.g. bad Gemini key) not the
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
    throw new AiError(
      /Failed to fetch|FunctionsFetchError/i.test(detail)
        ? 'Could not reach the Lion AI service. Check your connection or deploy the lion-ai function.'
        : detail,
    )
  }
  if (data?.error) throw new AiError(String(data.error))
  const text = String(data?.text ?? '').trim()
  // best-effort usage stat — never block the user on this
  supabase.rpc('record_ai_usage', { p_task: opts.task }).then(() => {}, () => {})
  return text
}

// ---- feature helpers (the "AI-powered features") ----
export const summarizePost = (text: string) => askLion({ task: 'summarize', input: text })
export const generateHashtags = (text: string) => askLion({ task: 'hashtags', input: text })
export const improveCaption = (text: string) => askLion({ task: 'caption', input: text })
export const explainConcept = (concept: string) => askLion({ task: 'explain', input: concept })
export const dailyTip = () => askLion({ task: 'tip', input: 'Give me a productivity tip for today.' })
export const dailyBriefing = (context: string) => askLion({ task: 'briefing', input: context })

/** Generate an AI learning roadmap. Returns a summary + ordered steps. */
export async function generateLearningPath(
  topic: string, level: string,
): Promise<{ summary: string; steps: { title: string; detail: string }[] }> {
  const raw = await askLion({ task: 'learnpath', input: `Topic: ${topic}. Level: ${level}.` })
  try {
    const obj = JSON.parse(raw.replace(/```json|```/g, '').trim())
    const steps = Array.isArray(obj.steps) ? obj.steps : []
    return {
      summary: String(obj.summary ?? `Your ${topic} roadmap`).slice(0, 240),
      steps: steps.slice(0, 14).map((s: { title?: unknown; detail?: unknown }) => ({
        title: String(s.title ?? 'Step').slice(0, 120),
        detail: String(s.detail ?? '').slice(0, 280),
      })),
    }
  } catch {
    return { summary: `Your ${topic} roadmap`, steps: [] }
  }
}

function parseJson<T>(raw: string): T | null {
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()) as T }
  catch { return null }
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
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const obj = JSON.parse(cleaned)
    return {
      title: String(obj.title ?? 'Today’s Lion Mission').slice(0, 80),
      detail: String(obj.detail ?? '').slice(0, 240),
      xp: Math.max(10, Math.min(50, Math.round(Number(obj.xp) || 20))),
    }
  } catch {
    // model didn't return clean JSON — degrade gracefully
    return { title: 'Today’s Lion Mission', detail: raw.slice(0, 240) || 'Do one focused 25-minute session.', xp: 20 }
  }
}
