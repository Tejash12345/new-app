/**
 * npcNeural — the NEURAL SCHEMA every Lion City citizen grows on its own.
 *
 * This is a real (if small) associative neural network, not a metaphor. Each
 * distinct concept a citizen meets becomes a NEURON; concepts that show up
 * together get joined by a weighted SYNAPSE. Learning follows a Hebbian rule —
 * "neurons that fire together wire together" — so repetition strengthens a link.
 * THINKING is spreading activation: charge a few neurons, let it flow across the
 * synapses, and read out which other neurons light up — those are the
 * associations the citizen just "thought of". From those, it forms its own
 * insights and decides what it's curious to learn next.
 *
 * Pure arithmetic over numbers persisted in localStorage — no cloud, no
 * libraries, no API keys. It runs offline on any phone, and it's each citizen's
 * OWN model: two citizens who learned different things end up wired differently.
 */

// ---------------------------------------------------------------- types

export type Neuron = {
  act: number // resting activation ≈ how important/reinforced this concept is (0..~6)
  fires: number // how many times it has been activated
  t: number // last time it fired
}
export type Synapse = { w: number } // connection weight (0..~6)

export type NeuralNet = {
  neurons: Record<string, Neuron>
  /** undirected edges, keyed `ab` with a < b lexically */
  syn: Record<string, Synapse>
  gen: number // total learning events — a simple "age" of the mind
}

// Phone-safe caps: a mind this size still thinks in well under a millisecond.
const NEURON_CAP = 220
const SYN_CAP = 900
const ACT_CAP = 6
const W_CAP = 6

const SEP = String.fromCharCode(1) // SOH — never appears in [a-z0-9-] tokens

// ---------------------------------------------------------------- construction

export function freshNet(): NeuralNet {
  return { neurons: {}, syn: {}, gen: 0 }
}

/** Repair a possibly-old/missing net so the rest of the module can trust it. */
export function ensureNet(net: NeuralNet | undefined | null): NeuralNet {
  if (!net || typeof net !== 'object') return freshNet()
  if (!net.neurons || typeof net.neurons !== 'object') net.neurons = {}
  if (!net.syn || typeof net.syn !== 'object') net.syn = {}
  if (typeof net.gen !== 'number') net.gen = 0
  return net
}

// ---------------------------------------------------------------- tokenising

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'is', 'are', 'was', 'were', 'be', 'been',
  'do', 'does', 'did', 'you', 'your', 'me', 'my', 'i', 'we', 'us', 'it', 'its', 'that',
  'this', 'these', 'those', 'what', 'who', 'whom', 'where', 'when', 'why', 'how', 'about',
  'tell', 'like', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'have', 'has', 'had',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'not', 'no', 'yes', 'but', 'if',
  'so', 'than', 'then', 'them', 'they', 'their', 'there', 'here', 'also', 'into', 'out',
  'up', 'down', 'over', 'under', 'more', 'most', 'some', 'any', 'all', 'one', 'two', 'get',
  'got', 'just', 'very', 'much', 'many', 'such', 'own', 'other', 'which', 'while', 'because',
])

/** Turn free text into a short list of clean concept tokens (deduped, capped). */
export function neuralTokens(text: string, cap = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    const t = w.replace(/^-+|-+$/g, '')
    if (t.length < 3 || t.length > 22 || STOP.has(t) || /^\d+$/.test(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= cap) break
  }
  return out
}

// ---------------------------------------------------------------- learning (Hebbian)

const key2 = (a: string, b: string) => (a < b ? a + SEP + b : b + SEP + a)

/**
 * Strengthen this set of concepts and the connections between them. New neurons
 * and synapses are created as needed; existing ones are reinforced. `strength`
 * scales how strongly this exposure counts (a taught fact > overheard gossip).
 */
export function neuralLearn(net: NeuralNet, tokens: string[], strength = 1): void {
  ensureNet(net)
  const toks = tokens.filter((t) => t && t.length >= 3).slice(0, 8)
  if (!toks.length) return
  const now = Date.now()
  for (const t of toks) {
    const n = net.neurons[t] || { act: 0, fires: 0, t: now }
    n.act = Math.min(ACT_CAP, n.act + 0.25 * strength)
    n.fires += 1
    n.t = now
    net.neurons[t] = n
  }
  // wire every pair that fired together (Hebbian co-activation)
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      const k = key2(toks[i], toks[j])
      const s = net.syn[k] || { w: 0 }
      s.w = Math.min(W_CAP, s.w + 0.34 * strength)
      net.syn[k] = s
    }
  }
  net.gen += 1
  prune(net)
}

/** Keep the mind within phone-safe bounds by forgetting the weakest bits. */
function prune(net: NeuralNet): void {
  const synKeys = Object.keys(net.syn)
  if (synKeys.length > SYN_CAP) {
    synKeys
      .sort((a, b) => net.syn[a].w - net.syn[b].w)
      .slice(0, synKeys.length - SYN_CAP)
      .forEach((k) => delete net.syn[k])
  }
  const nKeys = Object.keys(net.neurons)
  if (nKeys.length > NEURON_CAP) {
    // score by reinforcement + recency; drop the dullest
    const score = (id: string) => net.neurons[id].act + net.neurons[id].fires * 0.2 + net.neurons[id].t / 1e13
    const drop = nKeys.sort((a, b) => score(a) - score(b)).slice(0, nKeys.length - NEURON_CAP)
    const dead = new Set(drop)
    drop.forEach((id) => delete net.neurons[id])
    for (const k of Object.keys(net.syn)) {
      const [a, b] = k.split(SEP)
      if (dead.has(a) || dead.has(b)) delete net.syn[k]
    }
  }
}

// ---------------------------------------------------------------- thinking (spreading activation)

/** Adjacency list built on demand from the synapse map. */
function adjacency(net: NeuralNet): Map<string, Array<[string, number]>> {
  const adj = new Map<string, Array<[string, number]>>()
  for (const k of Object.keys(net.syn)) {
    const [a, b] = k.split(SEP)
    const w = net.syn[k].w
    ;(adj.get(a) || adj.set(a, []).get(a)!).push([b, w])
    ;(adj.get(b) || adj.set(b, []).get(b)!).push([a, w])
  }
  return adj
}

/**
 * Spread activation from the seed concepts and return the neurons that lit up
 * most (excluding the seeds) — the citizen's associations for that thought.
 */
export function neuralThink(net: NeuralNet, seeds: string[], steps = 2, top = 6): string[] {
  ensureNet(net)
  const present = seeds.filter((s) => net.neurons[s])
  if (!present.length) return []
  const adj = adjacency(net)
  const total: Record<string, number> = {}
  let frontier: Record<string, number> = {}
  present.forEach((s) => (frontier[s] = 1))
  const decay = 0.55
  for (let step = 0; step < steps; step++) {
    const next: Record<string, number> = {}
    for (const n of Object.keys(frontier)) {
      const edges = adj.get(n)
      if (!edges) continue
      for (const [m, w] of edges) {
        const inc = frontier[n] * (w / (w + 1)) * decay
        if (inc < 0.01) continue
        next[m] = (next[m] || 0) + inc
        total[m] = (total[m] || 0) + inc
      }
    }
    frontier = next
  }
  const seedSet = new Set(present)
  return Object.keys(total)
    .filter((n) => !seedSet.has(n))
    .sort((a, b) => total[b] - total[a])
    .slice(0, top)
}

/** The concepts most strongly associated with one concept (for curiosity + replies). */
export function neuralAssociate(net: NeuralNet, concept: string, top = 4): string[] {
  return neuralThink(net, [concept], 2, top)
}

/**
 * Pick a strongly-wired pair of concepts the citizen can form an insight from.
 * Chooses among the strongest synapses (a little randomly, so insights vary).
 * Returns null if the mind is still too small to reason.
 */
export function neuralInsight(net: NeuralNet): { a: string; b: string; w: number } | null {
  ensureNet(net)
  const keys = Object.keys(net.syn)
  if (keys.length < 3) return null
  const strong = keys.sort((x, y) => net.syn[y].w - net.syn[x].w).slice(0, Math.min(10, keys.length))
  const k = strong[Math.floor(Math.random() * strong.length)]
  const [a, b] = k.split(SEP)
  return { a, b, w: net.syn[k].w }
}

// ---------------------------------------------------------------- stats / "IQ"

export type NeuralStats = {
  neurons: number
  synapses: number
  avgWeight: number
  density: number // 0..1 how connected the mind is
  iq: number // a single "neural power" score
  level: number // iq bucketed into a level
  label: string
}

const IQ_LABELS = ['Waking up', 'Curious', 'Learning', 'Bright', 'Sharp', 'Clever', 'Brilliant', 'Genius']

export function neuralStats(net: NeuralNet): NeuralStats {
  ensureNet(net)
  const neurons = Object.keys(net.neurons).length
  const synKeys = Object.keys(net.syn)
  const synapses = synKeys.length
  const totalW = synKeys.reduce((a, k) => a + net.syn[k].w, 0)
  const avgWeight = synapses ? totalW / synapses : 0
  const maxEdges = neurons > 1 ? (neurons * (neurons - 1)) / 2 : 1
  const density = Math.min(1, synapses / maxEdges)
  const iq = Math.round(neurons + synapses * 0.5 + totalW * 0.4)
  const level = Math.max(1, Math.floor(Math.sqrt(iq) / 1.6))
  const label = IQ_LABELS[Math.min(IQ_LABELS.length - 1, Math.floor(level / 2))]
  return { neurons, synapses, avgWeight, density, iq, level, label }
}

/** The citizen's strongest concepts, for display / self-description. */
export function topConcepts(net: NeuralNet, n = 8): Array<{ concept: string; act: number }> {
  ensureNet(net)
  return Object.keys(net.neurons)
    .map((c) => ({ concept: c, act: net.neurons[c].act }))
    .sort((a, b) => b.act - a.act)
    .slice(0, n)
}

/** The synapses that connect a given set of concepts — for drawing the neural map. */
export function edgesAmong(net: NeuralNet, concepts: string[]): Array<{ a: string; b: string; w: number }> {
  ensureNet(net)
  const set = new Set(concepts)
  const out: Array<{ a: string; b: string; w: number }> = []
  for (const k of Object.keys(net.syn)) {
    const [a, b] = k.split(SEP)
    if (set.has(a) && set.has(b)) out.push({ a, b, w: net.syn[k].w })
  }
  return out
}

// ---------------------------------------------------------------- advanced dynamics

/**
 * Memory consolidation — the "sleep" of the neural model. Weakly-used synapses
 * fade a little and the faintest are forgotten, while strong, reinforced links
 * survive; neuron activation relaxes toward rest, and orphaned, rarely-fired
 * neurons drop out. Run over elapsed offline time so a mind naturally sharpens
 * around what it uses and lets go of noise. `amount` 0..0.5 scales the fade.
 */
export function consolidate(net: NeuralNet, amount = 0.1): void {
  ensureNet(net)
  const a = Math.min(0.5, Math.max(0, amount))
  const decay = 1 - a
  for (const k of Object.keys(net.syn)) {
    net.syn[k].w *= decay
    if (net.syn[k].w < 0.12) delete net.syn[k] // forget the faintest links
  }
  for (const id of Object.keys(net.neurons)) {
    net.neurons[id].act = Math.max(0.05, net.neurons[id].act * (1 - a * 0.5))
  }
  // prune orphaned, weak, rarely-fired neurons (nothing connects to them now)
  const connected = new Set<string>()
  for (const k of Object.keys(net.syn)) { const [x, y] = k.split(SEP); connected.add(x); connected.add(y) }
  for (const id of Object.keys(net.neurons)) {
    const n = net.neurons[id]
    if (!connected.has(id) && n.fires <= 1 && n.act < 0.2) delete net.neurons[id]
  }
}

/**
 * Chain of thought: start at `seed` and hop along the strongest fresh link,
 * `depth` times, to build a reasoning chain [seed, a, b, …]. This is how the
 * citizen follows one idea to the next.
 */
export function neuralChain(net: NeuralNet, seed: string, depth = 4): string[] {
  ensureNet(net)
  if (!net.neurons[seed]) return []
  const adj = adjacency(net)
  const chain = [seed]
  const used = new Set([seed])
  let cur = seed
  for (let i = 0; i < depth; i++) {
    const edges = (adj.get(cur) || []).filter(([m]) => !used.has(m)).sort((x, y) => y[1] - x[1])
    if (!edges.length) break
    cur = edges[0][0]
    used.add(cur)
    chain.push(cur)
  }
  return chain
}

/**
 * A creative leap: wire together two strong but currently-UNconnected concepts,
 * forming a brand-new association in the model — the citizen building a new
 * piece of its own mental model. Returns the newly-linked pair, or null.
 */
export function neuralDream(net: NeuralNet): { a: string; b: string } | null {
  ensureNet(net)
  const strong = topConcepts(net, 12).map((c) => c.concept)
  if (strong.length < 2) return null
  for (let tries = 0; tries < 14; tries++) {
    const a = strong[Math.floor(Math.random() * strong.length)]
    const b = strong[Math.floor(Math.random() * strong.length)]
    if (a === b || net.syn[key2(a, b)]) continue
    net.syn[key2(a, b)] = { w: 0.45 } // the creative new connection
    net.gen += 1
    return { a, b }
  }
  return null
}

/** The citizen's area of specialisation: its strongest concept plus the cluster
 *  wired most tightly around it. */
export function expertise(net: NeuralNet): { field: string; concepts: string[] } | null {
  ensureNet(net)
  const top = topConcepts(net, 1)[0]
  if (!top) return null
  return { field: top.concept, concepts: [top.concept, ...neuralThink(net, [top.concept], 1, 4)] }
}

/** A concept the mind cares about but has barely connected — something it would
 *  be curious to explore further (drives self-directed learning). */
export function curiosityGap(net: NeuralNet): string | null {
  ensureNet(net)
  const deg: Record<string, number> = {}
  for (const k of Object.keys(net.syn)) { const [a, b] = k.split(SEP); deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1 }
  const cands = topConcepts(net, 14).filter((c) => (deg[c.concept] || 0) <= 2)
  if (!cands.length) return null
  return cands[Math.floor(Math.random() * cands.length)].concept
}
