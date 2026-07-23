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
  ruleRespond, registerResponder, moodLabel, friendTier,
  type NpcBrain, type Responder,
} from './npcMind'
import { neuralLearn, neuralTokens } from './npcNeural'
import { fetchPublicKnowledge, type WebFact } from './npcOnline'
import { getPref } from './prefs'
import { askLion } from './ai'

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

/** Build the in-character instruction sent to the model as the user turn. */
function personaPrompt(b: NpcBrain, text: string): string {
  const interests = Object.entries(b.interests).sort((a, c) => c[1] - a[1]).slice(0, 4).map((e) => e[0])
  const mems = b.memories.filter((m) => m.salience >= 0.5).slice(-4).map((m) => m.text)
  const facts = b.knowledge.slice(-4).map((k) => k.text)
  return [
    `Role-play as a citizen of "Lion City", a friendly game world. Stay fully in character. Never say you are an AI, a model, an assistant, or mention any app or company.`,
    `You are ${b.name}, ${b.profession}. Personality: ${traitWords(b)}. Right now you feel ${moodLabel(b.mood)}.`,
    `The person talking to you is your ${friendTier(b.player.affinity).toLowerCase()}.`,
    interests.length ? `You care about: ${interests.join(', ')}.` : '',
    mems.length ? `Recently on your mind: ${mems.join(' ')}` : '',
    facts.length ? `Some things you know: ${facts.join(' ')}` : '',
    `Answer helpfully and ACCURATELY using real-world knowledge, but keep your citizen voice. Reply in the SAME language the person used. 1-3 short, natural sentences. Plain text only — no markdown, no lists.`,
    `The person says: "${text}"`,
  ].filter(Boolean).join('\n')
}

/** Ask the online model for an in-character reply. Returns null on any failure. */
export async function cloudBrainReply(brain: NpcBrain, text: string): Promise<string | null> {
  try {
    const out = await askLion({ task: 'chat', input: personaPrompt(brain, text), fast: true })
    const clean = (out || '').trim()
    return clean ? clean.slice(0, 700) : null
  } catch {
    return null // offline / rate-limited / timeout — caller falls back to the offline brain
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

/**
 * Research any topic from the internet: Wikipedia first (free, keyless), then
 * the genius brain for anything Wikipedia doesn't cover. Respects both toggles.
 */
export async function researchTopic(query: string): Promise<WebFact | null> {
  const q = query.trim()
  if (!q) return null
  if (getPref('npcInternet') && online()) {
    const wiki = await fetchPublicKnowledge(q)
    if (wiki) return wiki
  }
  if (cloudBrainOn()) return cloudFact(q)
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
