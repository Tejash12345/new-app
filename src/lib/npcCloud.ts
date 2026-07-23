/**
 * npcCloud — the optional GENIUS BRAIN for Lion City citizens.
 *
 * Everything else about an NPC is fully offline (rule engine + the on-device
 * neural net). This module adds a stronger, online layer: when the player turns
 * on "Genius brain", a citizen can think through the app's existing Lion AI
 * service (the `lion-ai` edge function → a real language model) and answer about
 * essentially anything — using the model's broad knowledge of the real world —
 * while STAYING IN CHARACTER as that citizen.
 *
 * It's registered as a `Responder` and preferred over the rule engine only when
 * the toggle is on AND the device is online; any failure (offline, rate limit,
 * timeout) falls straight back to the offline brain, so nothing ever breaks. The
 * rule engine still runs on every turn for its learning side-effects, so the
 * citizen keeps growing its own local memory + neural model either way.
 */
import {
  ruleRespond, registerResponder, moodLabel, friendTier, synthesize, expertiseOf,
  type NpcBrain, type Responder,
} from './npcMind'
import { neuralChain, neuralLearn, neuralTokens } from './npcNeural'
import { webLookup, type WebFact } from './npcOnline'
import { getPref } from './prefs'
import { askLion } from './ai'
import { supabase } from './supabase'

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** Is the online genius brain both enabled and reachable right now? */
export function cloudBrainOn(): boolean {
  return getPref('npcCloudBrain') === true && online()
}

/** Turn the personality traits into a few plain adjectives for the prompt. */
function traitWords(b: NpcBrain): string {
  const t = b.traits
  const w: string[] = []
  if (t.curiosity > 0.6) w.push('very curious')
  if (t.warmth > 0.6) w.push('warm and friendly'); else if (t.warmth < 0.35) w.push('a bit reserved')
  if (t.energy > 0.7) w.push('energetic'); else if (t.energy < 0.35) w.push('laid-back')
  if (t.discipline > 0.7) w.push('disciplined')
  if (t.humor > 0.7) w.push('playful and funny'); else if (t.humor < 0.3) w.push('serious')
  return w.length ? w.join(', ') : 'easygoing'
}

/** Build the in-character instruction sent to the model as the user turn.
 *  Grounded in the citizen's OWN knowledge, specialisation and neural reasoning
 *  chain, so the real-AI reply reflects what THIS citizen actually knows/thinks. */
function personaPrompt(b: NpcBrain, text: string): string {
  const interests = Object.entries(b.interests).sort((a, c) => c[1] - a[1]).slice(0, 4).map((e) => e[0])
  const mems = b.memories.filter((m) => m.salience >= 0.5).slice(-4).map((m) => m.text)
  const kw = neuralTokens(text)
  const grounded = kw.length ? synthesize(b, kw) : null // what it actually knows re: the question
  const chain = kw.length && b.net ? neuralChain(b.net, kw[0], 4) : []
  const exp = expertiseOf(b)
  return [
    `Role-play as a citizen of "Lion City", a friendly game world. Stay fully in character. Never say you are an AI, a model, an assistant, or mention any app or company.`,
    `You are ${b.name}, ${b.profession}. Personality: ${traitWords(b)}. Right now you feel ${moodLabel(b.mood)}.`,
    `The person talking to you is your ${friendTier(b.player.affinity).toLowerCase()}.`,
    exp ? `You specialise in ${exp.field}.` : '',
    interests.length ? `You care about: ${interests.join(', ')}.` : '',
    mems.length ? `Recently on your mind: ${mems.join(' ')}` : '',
    grounded ? `What you already know that's relevant: ${grounded}` : '',
    chain.length >= 2 ? `Your mind links these ideas: ${chain.join(' → ')}.` : '',
    `Answer helpfully and ACCURATELY using real-world knowledge, weaving in what you know above; think it through but keep your citizen voice. Reply in the SAME language the person used. 2-4 natural sentences. Plain text only — no markdown, no lists.`,
    `The person says: "${text}"`,
  ].filter(Boolean).join('\n')
}

/** Ask the online model for an in-character reply. Returns null on any failure OR
 *  if it takes too long — so the hybrid brain drops to the offline engine quickly
 *  instead of leaving the player waiting on a slow free-tier call. */
export async function cloudBrainReply(brain: NpcBrain, text: string): Promise<string | null> {
  try {
    const out = await Promise.race([
      askLion({ task: 'chat', input: personaPrompt(brain, text), fast: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 14000)),
    ])
    const clean = (out || '').trim()
    return clean ? clean.slice(0, 700) : null
  } catch {
    return null // offline / rate-limited / error — caller falls back to the offline brain
  }
}

/** Ask the online model for a concise, accurate fact about ANY topic. */
export async function cloudFact(topic: string): Promise<WebFact | null> {
  try {
    const out = await askLion({
      task: 'chat', fast: true,
      input: `In 2 short, accurate sentences, tell me something a curious learner would enjoy about "${topic}". Plain text only, no preamble, no markdown.`,
    })
    const summary = (out || '').trim()
    if (!summary || summary.length < 8) return null
    return {
      title: topic,
      summary: summary.slice(0, 320),
      url: `https://www.google.com/search?q=${encodeURIComponent(topic)}`,
      source: 'ai',
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- live web scraping (server-side)

type WebSearchResult = { title: string; snippet: string; url: string }

/** SEARCH the live web (server-side, via the npc-web function → DuckDuckGo HTML).
 *  Works where the browser can't (no CORS). Returns [] on any failure. */
export async function webSearch(query: string): Promise<WebSearchResult[]> {
  try {
    const { data, error } = await supabase.functions.invoke('npc-web', { body: { action: 'search', query } })
    const results = (data as { results?: WebSearchResult[] } | null)?.results
    if (error || !Array.isArray(results)) return []
    return results
  } catch { return [] }
}

/** Scrape a page's readable text (server-side). Returns null on any failure. */
export async function readPage(url: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('npc-web', { body: { action: 'read', url } })
    const text = (data as { text?: string } | null)?.text
    if (error || !text) return null
    return String(text)
  } catch { return null }
}

/**
 * SCRAPE the live internet for a topic → a compact, attributed fact. Searches
 * the open web server-side, takes the top result, and (if the snippet is thin)
 * reads the actual page for more. This is the citizens' real "scrape the web".
 */
export async function scrapeWeb(topic: string): Promise<WebFact | null> {
  const results = await webSearch(topic)
  if (!results.length) return null
  const top = results[0]
  let summary = (top.snippet || '').trim()
  if (summary.length < 80) {
    const page = await readPage(top.url)
    if (page) summary = page.trim().slice(0, 320)
  }
  if (!summary || summary.length < 8) return null
  return { title: top.title || topic, summary: summary.slice(0, 320), url: top.url, source: 'web' }
}

/**
 * Autonomous-learning lookup: free keyless sources, then a live server-side web
 * SCRAPE. No AI — keeps the player's daily AI allowance untouched. Gated on the
 * internet-learning toggle.
 */
export async function learnLookup(topic: string): Promise<WebFact | null> {
  if (!getPref('npcInternet') || !online()) return null
  return (await webLookup(topic)) || (await scrapeWeb(topic))
}

/**
 * Research any topic from the internet: free keyless web (Wikipedia/DuckDuckGo),
 * then a live server-side scrape, then the genius brain for anything still
 * uncovered. Respects both toggles.
 */
export async function researchTopic(query: string): Promise<WebFact | null> {
  const q = query.trim()
  if (!q) return null
  if (getPref('npcInternet') && online()) {
    const web = await webLookup(q) // keyless: Wikipedia + DuckDuckGo
    if (web) return web
    const scraped = await scrapeWeb(q) // live server-side scrape of the open web
    if (scraped) return scraped
  }
  if (cloudBrainOn()) return cloudFact(q) // internet-scale AI knowledge, in reserve
  return null
}

/**
 * The genius-brain responder. Preferred over the rule engine ONLY when the
 * toggle is on and online; otherwise reports unavailable and we fall back.
 */
export const cloudLlmResponder: Responder = {
  id: 'llm-cloud',
  label: 'genius brain',
  available: async () => cloudBrainOn(),
  respond: async (brain, text, ctx) => {
    const prose = await cloudBrainReply(brain, text)
    // Always run the offline engine for its learning side-effects (memory,
    // affinity, goals, neural wiring) — we just swap in the model's nicer prose.
    const sim = ruleRespond(brain, text, ctx)
    if (prose) {
      neuralLearn(brain.net, neuralTokens(text + ' ' + prose), 0.6)
      return { text: prose, tags: [...sim.tags, 'llm', 'cloud'], source: 'llm', lookup: undefined }
    }
    return sim
  },
}

// Register on import so `pickResponder()` can consider it. npcMind never imports
// this module, so there's no cycle — the app just imports npcCloud where NPCs
// are used (NpcChat, city autonomy) and the seam lights up.
registerResponder(cloudLlmResponder)
