/**
 * Lion Run meta-progression — coin bank, permanent power-up upgrades, and daily
 * missions.
 *
 * THREE-free + localStorage-backed (mirrors lionSkins/characters), so CityPage
 * imports it without pulling the game chunk. Coins are a SOFT in-game currency
 * collected from orbs + mission rewards, spent on upgrades — deliberately
 * SEPARATE from XP so the study-first XP balancing ([[focuslion-project]]) is
 * untouched (coins never grant XP or move the leaderboard).
 */

export type UpgradeKey = 'magnet' | 'shield' | 'boost' | 'head'

export type UpgradeDef = {
  key: UpgradeKey
  name: string
  emoji: string
  desc: string
  max: number
  costs: number[] // cost to reach level i+1 (length === max)
}

export const UPGRADES: UpgradeDef[] = [
  { key: 'magnet', name: 'Magnet', emoji: '🧲', desc: '+2s magnet duration per level', max: 3, costs: [80, 200, 450] },
  { key: 'boost', name: 'Boost', emoji: '⏩', desc: '+0.6s boost-pad duration per level', max: 3, costs: [60, 150, 350] },
  { key: 'head', name: 'Head start', emoji: '🚀', desc: 'Launch each run with a speed boost', max: 3, costs: [120, 300, 600] },
  { key: 'shield', name: 'Starting shield', emoji: '🛡️', desc: 'Begin every run already shielded', max: 1, costs: [300] },
]

type UpgradeState = Record<UpgradeKey, number>
const DEFAULT_UPGRADES: UpgradeState = { magnet: 0, shield: 0, boost: 0, head: 0 }

const COINS_KEY = 'fl-city-coins'
const UPG_KEY = 'fl-city-upgrades'

function readNum(k: string): number {
  const n = Number(localStorage.getItem(k) || '0')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// ---- coin bank ----
export function getCoins(): number {
  try { return readNum(COINS_KEY) } catch { return 0 }
}
export function addCoins(n: number): number {
  const total = getCoins() + Math.max(0, Math.floor(n))
  try { localStorage.setItem(COINS_KEY, String(total)) } catch { /* private mode */ }
  return total
}
function spendCoins(n: number): boolean {
  const have = getCoins()
  if (have < n) return false
  try { localStorage.setItem(COINS_KEY, String(have - n)) } catch { /* private mode */ }
  return true
}

// ---- upgrades ----
export function getUpgrades(): UpgradeState {
  try {
    const raw = localStorage.getItem(UPG_KEY)
    return raw ? { ...DEFAULT_UPGRADES, ...(JSON.parse(raw) as Partial<UpgradeState>) } : { ...DEFAULT_UPGRADES }
  } catch {
    return { ...DEFAULT_UPGRADES }
  }
}
export function upgradeDef(key: UpgradeKey): UpgradeDef {
  return UPGRADES.find((u) => u.key === key) || UPGRADES[0]
}
/** Cost of the NEXT level, or null if already maxed. */
export function nextCost(key: UpgradeKey): number | null {
  const def = upgradeDef(key)
  const lvl = getUpgrades()[key]
  return lvl >= def.max ? null : def.costs[lvl]
}
/** Buy the next level of an upgrade. Returns true on success. */
export function buyUpgrade(key: UpgradeKey): boolean {
  const cost = nextCost(key)
  if (cost == null) return false
  if (!spendCoins(cost)) return false
  const state = getUpgrades()
  state[key] = state[key] + 1
  try { localStorage.setItem(UPG_KEY, JSON.stringify(state)) } catch { /* private mode */ }
  return true
}

// ---- daily missions ----
export type MissionType = 'coins' | 'dist' | 'stage' | 'combo'
export type Mission = { id: string; emoji: string; label: string; type: MissionType; target: number; reward: number }
export type RunStats = { coins: number; dist: number; stage: number; combo: number }

const MISSION_POOL: Mission[] = [
  { id: 'coins30', emoji: '🪙', label: 'Collect 30 orbs', type: 'coins', target: 30, reward: 40 },
  { id: 'coins60', emoji: '🪙', label: 'Collect 60 orbs', type: 'coins', target: 60, reward: 80 },
  { id: 'dist600', emoji: '📏', label: 'Run 600m', type: 'dist', target: 600, reward: 60 },
  { id: 'dist1200', emoji: '📏', label: 'Run 1200m', type: 'dist', target: 1200, reward: 130 },
  { id: 'stage3', emoji: '🌆', label: 'Reach stage 3', type: 'stage', target: 3, reward: 70 },
  { id: 'stage4', emoji: '🌩️', label: 'Reach stage 4', type: 'stage', target: 4, reward: 120 },
  { id: 'combo12', emoji: '🔥', label: 'Hit a 12× combo', type: 'combo', target: 12, reward: 60 },
  { id: 'combo20', emoji: '🔥', label: 'Hit a 20× combo', type: 'combo', target: 20, reward: 110 },
]

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

type DailyState = { day: string; ids: string[]; done: string[] }

function loadDaily(): DailyState {
  const day = todayKey()
  try {
    const raw = localStorage.getItem('fl-city-missions')
    if (raw) {
      const s = JSON.parse(raw) as DailyState
      if (s.day === day && Array.isArray(s.ids) && s.ids.length === 3) return s
    }
  } catch { /* fall through */ }
  // pick 3 distinct missions deterministically for today (one per difficulty-ish)
  const seed = Number(day.replace(/-/g, '')) // e.g. 20260721
  const rnd = mulberry32(seed)
  const pool = [...MISSION_POOL]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  // avoid two of the same type where possible
  const picked: Mission[] = []
  const types = new Set<MissionType>()
  for (const m of pool) {
    if (picked.length >= 3) break
    if (types.has(m.type) && pool.length - picked.length > 3 - picked.length) continue
    picked.push(m); types.add(m.type)
  }
  while (picked.length < 3) picked.push(pool[picked.length])
  const s: DailyState = { day, ids: picked.map((m) => m.id), done: [] }
  try { localStorage.setItem('fl-city-missions', JSON.stringify(s)) } catch { /* private mode */ }
  return s
}

export function getDailyMissions(): (Mission & { done: boolean })[] {
  const s = loadDaily()
  return s.ids
    .map((id) => MISSION_POOL.find((m) => m.id === id))
    .filter((m): m is Mission => !!m)
    .map((m) => ({ ...m, done: s.done.includes(m.id) }))
}

function meets(m: Mission, st: RunStats): boolean {
  const v = m.type === 'coins' ? st.coins : m.type === 'dist' ? st.dist : m.type === 'stage' ? st.stage : st.combo
  return v >= m.target
}

/** After a run, mark any newly-completed missions done + bank their reward.
 *  Returns the missions completed this run and the coins awarded. */
export function tallyMissions(st: RunStats): { completed: Mission[]; coins: number } {
  const s = loadDaily()
  const completed: Mission[] = []
  for (const id of s.ids) {
    if (s.done.includes(id)) continue
    const m = MISSION_POOL.find((x) => x.id === id)
    if (m && meets(m, st)) { completed.push(m); s.done.push(id) }
  }
  let coins = 0
  if (completed.length) {
    try { localStorage.setItem('fl-city-missions', JSON.stringify(s)) } catch { /* private mode */ }
    coins = completed.reduce((a, m) => a + m.reward, 0)
    addCoins(coins)
  }
  return { completed, coins }
}
