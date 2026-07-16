/**
 * Lion skins — cosmetic recolors + a signature glowing trail for the runner.
 * Pure data (no three import) so both the 3D engine (lazy chunk) and the React
 * race UI (main bundle) can import it without pulling three.js into main.
 */
export type LionSkin = {
  id: string
  name: string
  emoji: string
  body: number // hex — recolors body/legs/head/tail (bodyMat)
  mane: number // hex — recolors the mane/tufts (maneMat)
  trail: string | null // rgba glow streamed behind the lion (null = none)
}

export const LION_SKINS: LionSkin[] = [
  { id: 'classic', name: 'Classic', emoji: '🦁', body: 0x8a5a24, mane: 0xffb454, trail: null },
  { id: 'fire', name: 'Fire', emoji: '🔥', body: 0x5a1a0a, mane: 0xff5a1e, trail: 'rgba(255,120,40,0.8)' },
  { id: 'ice', name: 'Ice', emoji: '❄️', body: 0x244a5a, mane: 0x8fe7ff, trail: 'rgba(150,230,255,0.8)' },
  { id: 'neon', name: 'Neon', emoji: '💜', body: 0x2a0a3a, mane: 0xff2fd6, trail: 'rgba(255,80,220,0.8)' },
  { id: 'gold', name: 'Gold', emoji: '👑', body: 0x6a4a10, mane: 0xffd24a, trail: 'rgba(255,214,74,0.85)' },
  { id: 'shadow', name: 'Shadow', emoji: '🌑', body: 0x14121e, mane: 0x6a55a0, trail: 'rgba(130,100,200,0.7)' },
]

export function skinById(id?: string | null): LionSkin {
  return LION_SKINS.find((s) => s.id === id) ?? LION_SKINS[0]
}
