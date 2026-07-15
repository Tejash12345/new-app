/**
 * Animated chat backgrounds (Instagram-style, per-conversation & synced to both
 * friends — stored on dm_pairs.chat_bg). Used behind the chat thread and behind
 * the Watch Together player. Each option floats emoji particles up or down.
 */
export type ChatBgId =
  | '' | 'hearts' | 'bubbles' | 'stars' | 'petals' | 'roses'
  | 'snow' | 'confetti' | 'balloons' | 'fire' | 'music' | 'sparkle'

export type ChatBg = { id: ChatBgId; name: string; emoji: string; dir: 'up' | 'down'; glyphs: string[] }

export const CHAT_BGS: ChatBg[] = [
  { id: '', name: 'None', emoji: '⊘', dir: 'up', glyphs: [] },
  { id: 'hearts', name: 'Hearts', emoji: '❤️', dir: 'up', glyphs: ['❤️', '💕', '💗', '💖', '💘'] },
  { id: 'bubbles', name: 'Bubbles', emoji: '🫧', dir: 'up', glyphs: ['🫧', '⚪'] },
  { id: 'stars', name: 'Stars', emoji: '✨', dir: 'up', glyphs: ['✨', '⭐', '💫'] },
  { id: 'petals', name: 'Petals', emoji: '🌸', dir: 'down', glyphs: ['🌸', '🌷', '🏵️', '💮'] },
  { id: 'roses', name: 'Roses', emoji: '🌹', dir: 'up', glyphs: ['🌹', '🥀', '💐'] },
  { id: 'snow', name: 'Snow', emoji: '❄️', dir: 'down', glyphs: ['❄️', '🌨️', '⛄'] },
  { id: 'confetti', name: 'Party', emoji: '🎉', dir: 'down', glyphs: ['🎉', '🎊', '✨', '🎈'] },
  { id: 'balloons', name: 'Balloons', emoji: '🎈', dir: 'up', glyphs: ['🎈', '🎈', '🎀'] },
  { id: 'fire', name: 'Fire', emoji: '🔥', dir: 'up', glyphs: ['🔥', '✨'] },
  { id: 'music', name: 'Music', emoji: '🎵', dir: 'up', glyphs: ['🎵', '🎶', '🎧'] },
  { id: 'sparkle', name: 'Sparkle', emoji: '💫', dir: 'up', glyphs: ['💫', '⚡', '✨', '🌟'] },
]

export function bgById(id?: string | null): ChatBg {
  return CHAT_BGS.find((b) => b.id === (id ?? '')) ?? CHAT_BGS[0]
}
