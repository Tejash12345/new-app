/**
 * Animated chat backgrounds (Instagram-style, per-conversation & synced to both
 * friends — stored on dm_pairs.chat_bg). Used behind the chat thread and behind
 * the Watch Together player. Each option floats emoji particles up or down;
 * `soft` styles (bokeh, clouds) render big, blurred, dreamy glows instead.
 */
export type ChatBgId = string

export type ChatBg = { id: ChatBgId; name: string; emoji: string; dir: 'up' | 'down'; glyphs: string[]; soft?: boolean }

export const CHAT_BGS: ChatBg[] = [
  { id: '', name: 'None', emoji: '⊘', dir: 'up', glyphs: [] },
  { id: 'hearts', name: 'Hearts', emoji: '❤️', dir: 'up', glyphs: ['❤️', '💕', '💗', '💖', '💘'] },
  { id: 'kisses', name: 'Kisses', emoji: '💋', dir: 'up', glyphs: ['💋', '😘', '😙', '💌', '💕'] },
  { id: 'kissyface', name: 'Kissy Face', emoji: '😘', dir: 'up', glyphs: ['😘', '😗', '😙', '😚', '🥰', '💋', '💕'] },
  { id: 'love', name: 'In Love', emoji: '🥰', dir: 'up', glyphs: ['🥰', '😍', '💞', '💓', '❣️'] },
  { id: 'rain', name: 'Rain', emoji: '🌧️', dir: 'down', glyphs: ['💧', '🌧️', '☔'] },
  { id: 'autumn', name: 'Autumn', emoji: '🍂', dir: 'down', glyphs: ['🍂', '🍁', '🍃', '🌾'] },
  { id: 'leaves', name: 'Leaves', emoji: '🍃', dir: 'down', glyphs: ['🍃', '🌿', '☘️'] },
  { id: 'bokeh', name: 'Bokeh', emoji: '🔮', dir: 'up', glyphs: ['🔵', '🟣', '🟡', '🔴', '🟢', '⚪'], soft: true },
  { id: 'bubbles', name: 'Bubbles', emoji: '🫧', dir: 'up', glyphs: ['🫧', '⚪', '🔵'] },
  { id: 'stars', name: 'Stars', emoji: '✨', dir: 'up', glyphs: ['✨', '⭐', '💫', '🌟'] },
  { id: 'petals', name: 'Petals', emoji: '🌸', dir: 'down', glyphs: ['🌸', '🌷', '🏵️', '💮'] },
  { id: 'roses', name: 'Roses', emoji: '🌹', dir: 'up', glyphs: ['🌹', '🥀', '💐'] },
  { id: 'flowers', name: 'Flowers', emoji: '🌺', dir: 'up', glyphs: ['🌺', '🌼', '🌻', '🌸', '🌷'] },
  { id: 'sunflower', name: 'Sunflower', emoji: '🌻', dir: 'up', glyphs: ['🌻', '🌼', '🐝'] },
  { id: 'butterflies', name: 'Butterflies', emoji: '🦋', dir: 'up', glyphs: ['🦋', '🌸', '✨'] },
  { id: 'bees', name: 'Bees', emoji: '🐝', dir: 'up', glyphs: ['🐝', '🌼', '🍯'] },
  { id: 'snow', name: 'Snow', emoji: '❄️', dir: 'down', glyphs: ['❄️', '🌨️', '⛄', '✨'] },
  { id: 'clouds', name: 'Clouds', emoji: '☁️', dir: 'up', glyphs: ['☁️', '🌥️', '🌤️'], soft: true },
  { id: 'thunder', name: 'Thunder', emoji: '⚡', dir: 'down', glyphs: ['⚡', '🌩️', '💧'] },
  { id: 'rainbow', name: 'Rainbow', emoji: '🌈', dir: 'up', glyphs: ['🌈', '☁️', '✨', '⭐'] },
  { id: 'party', name: 'Party', emoji: '🎉', dir: 'down', glyphs: ['🎉', '🎊', '✨', '🎈'] },
  { id: 'balloons', name: 'Balloons', emoji: '🎈', dir: 'up', glyphs: ['🎈', '🎈', '🎀'] },
  { id: 'birthday', name: 'Birthday', emoji: '🎂', dir: 'up', glyphs: ['🎂', '🎈', '🎁', '🎉'] },
  { id: 'gifts', name: 'Gifts', emoji: '🎁', dir: 'down', glyphs: ['🎁', '🎀', '✨'] },
  { id: 'fireworks', name: 'Fireworks', emoji: '🎆', dir: 'up', glyphs: ['🎆', '🎇', '✨', '🌟'] },
  { id: 'fire', name: 'Fire', emoji: '🔥', dir: 'up', glyphs: ['🔥', '✨'] },
  { id: 'music', name: 'Music', emoji: '🎵', dir: 'up', glyphs: ['🎵', '🎶', '🎧'] },
  { id: 'sparkle', name: 'Sparkle', emoji: '💫', dir: 'up', glyphs: ['💫', '⚡', '✨', '🌟'] },
  { id: 'magic', name: 'Magic', emoji: '🪄', dir: 'up', glyphs: ['🪄', '🔮', '✨', '⭐'] },
  { id: 'diamonds', name: 'Diamonds', emoji: '💎', dir: 'down', glyphs: ['💎', '✨', '💍'] },
  { id: 'crowns', name: 'Royal', emoji: '👑', dir: 'up', glyphs: ['👑', '✨', '💛'] },
  { id: 'money', name: 'Money', emoji: '💰', dir: 'down', glyphs: ['💵', '💰', '🤑', '💸'] },
  { id: 'coffee', name: 'Coffee', emoji: '☕', dir: 'up', glyphs: ['☕', '🫖', '✨'] },
  { id: 'space', name: 'Space', emoji: '🪐', dir: 'up', glyphs: ['🪐', '🌙', '⭐', '🌟', '☄️'] },
  { id: 'ocean', name: 'Ocean', emoji: '🌊', dir: 'up', glyphs: ['🌊', '🐠', '🐚', '🫧'] },
  { id: 'cats', name: 'Cats', emoji: '🐱', dir: 'up', glyphs: ['🐱', '😺', '🐾', '🐈'] },
  { id: 'dogs', name: 'Dogs', emoji: '🐶', dir: 'up', glyphs: ['🐶', '🐾', '🦴'] },
  { id: 'halloween', name: 'Spooky', emoji: '🎃', dir: 'up', glyphs: ['🎃', '👻', '🦇', '🕸️'] },
  { id: 'christmas', name: 'Christmas', emoji: '🎄', dir: 'down', glyphs: ['🎄', '🎅', '🎁', '❄️', '⛄'] },
  { id: 'smileys', name: 'Smileys', emoji: '😍', dir: 'up', glyphs: ['😍', '🥰', '😎', '🤩', '😊'] },
  { id: 'peace', name: 'Peace', emoji: '☮️', dir: 'up', glyphs: ['☮️', '✌️', '💛'] },
  { id: 'feathers', name: 'Feathers', emoji: '🪶', dir: 'down', glyphs: ['🪶', '☁️', '✨'] },
]

export function bgById(id?: string | null): ChatBg {
  return CHAT_BGS.find((b) => b.id === (id ?? '')) ?? CHAT_BGS[0]
}
