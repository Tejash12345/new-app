import type { LeoAction, LeoReply } from './ai'

// ----------------------------------------------------------------------------
// Leo Live OFFLINE brain. With no internet the AI models are unreachable, so
// common commands are understood by simple rules instead: phone control,
// alarms/timers, focus sessions, time & date, battery. English plus key
// Hindi/Telugu words. Returns null when it can't help (caller explains).
// ----------------------------------------------------------------------------

const phoneA = (d: string, extra: Record<string, unknown> = {}): LeoAction =>
  ({ type: 'phone', do: d, ...extra }) as LeoAction
const reply = (say: string, actions: LeoAction[] = [], lang = 'en'): LeoReply => ({ say, lang, actions })

const has = (t: string, ...words: (string | RegExp)[]) =>
  words.some((w) => (typeof w === 'string' ? t.includes(w) : w.test(t)))

/** "6:30 pm", "6 30", "18:00", "saade chhe" is out of scope -> {h, m} */
function parseClock(t: string): { h: number; m: number } | null {
  const m = t.match(/(\d{1,2})(?:[:. ](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|baje)?/i)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ap = (m[3] ?? '').toLowerCase()
  if (ap.startsWith('p') && h < 12) h += 12
  if (ap.startsWith('a') && h === 12) h = 0
  // (Telugu/Hindi letters aren't "word" chars for \b, so match on spaces)
  if (!ap && /(?:^|\s)(evening|night|tonight|shaam|raat|సాయంత్రం|రాత్రి|शाम|रात)(?=\s|$)/.test(t) && h < 12) h += 12
  if (h > 23 || min > 59) return null
  return { h, m: min }
}

/** "20 minutes", "1 hour", "30 sec" -> seconds */
function parseDuration(t: string): number | null {
  const m = t.match(/(\d+)\s*(h|hr|hour|hours|ghante|గంట|m|min|mins|minute|minutes|minat|నిమిష|s|sec|secs|second|seconds)/i)
  if (!m) return null
  const n = Number(m[1])
  const u = m[2].toLowerCase()
  if (u.startsWith('h') || u.startsWith('g') || u.startsWith('గ')) return n * 3600
  if (u.startsWith('s')) return n
  return n * 60
}

export function offlineThink(raw: string): LeoReply | null {
  const t = raw.toLowerCase().trim().replace(/[?!.,]+$/g, '')
  if (!t) return null
  const off = has(t, /\boff\b/, /\bband\b/, /\bdisable\b/, 'बंद', 'ఆపు', 'ఆఫ్')
  const now = new Date()

  // ---- torch / flashlight ----
  if (has(t, /\btorch\b/, /\bflash ?light\b/, 'टॉर्च', 'టార్చ్', 'లైట్'))
    return reply(off ? 'Flashlight off.' : 'Flashlight on.', [phoneA('torch', { on: !off })])

  // ---- focus / dnd / sound ----
  if (has(t, 'do not disturb', 'dnd', 'disturb'))
    return reply(off ? 'Do Not Disturb is off.' : 'Do Not Disturb is on. Time to focus.', [phoneA('dnd', { on: !off })])
  if (has(t, 'silent', 'साइलेंट', 'సైలెంట్')) return reply('Phone on silent.', [phoneA('ringer', { mode: 'silent' })])
  if (has(t, 'vibrat')) return reply('Phone on vibrate.', [phoneA('ringer', { mode: 'vibrate' })])
  if (has(t, 'volume', 'आवाज़', 'आवाज', 'సౌండ్', 'వాల్యూమ్')) {
    const pct = t.match(/(\d{1,3})\s*(%|percent)/)
    const level = pct ? pct[1] : has(t, 'mute') ? 'mute' : has(t, 'max', 'full') ? 'max'
      : has(t, 'down', 'low', 'kam', 'కమ్', 'తగ్గించు') ? 'down' : 'up'
    return reply('Adjusting the volume.', [phoneA('volume', { level })])
  }
  if (has(t, 'brightness', 'bright', 'dim'))
    return reply('Adjusting brightness.', [phoneA('brightness', {
      level: t.match(/(\d{1,3})/)?.[1] ?? (has(t, 'down', 'dim', 'low') ? 'down' : has(t, 'max', 'full') ? 'max' : 'up'),
    })])

  // ---- clear memory / forget all ----
  if (has(t, /\b(clear|reset|forget|delete)\s*(all|everything|leo['’]?s?\s*memory|memory|skills)\b/)) {
    return reply("Memory cleared! I've forgotten all saved facts and custom skills.", [{ type: 'phone', do: 'clear_memory' } as LeoAction])
  }

  // ---- alarms off / messages ----
  if (has(t, /\b(turn|switch) off (the |my )?alarms?\b/, /\b(stop|dismiss|cancel) (the |my )?alarms?\b/, /^alarm off$/))
    return reply('Alarm off.', [phoneA('alarm_off', { label: has(t, /\ball alarms\b/) ? 'all' : '' })])
  if (has(t, /\b(stop|cancel|turn off) (the |my )?timer\b/)) return reply('Timer stopped.', [phoneA('timer_off')])
  if (has(t, /\b(any|new|my) (new )?messages?\b/, /\bwho (messaged|texted|sent)\b/))
    return reply('Checking your messages.', [phoneA('read_messages', { minutes: 0 })])

  // ---- control the screen underneath (accessibility) ----
  if (/^(scroll|swipe|page)( (down|up|more))?$|^next page$/.test(t))
    return reply('Scrolling.', [phoneA('scroll', { dir: /\bup\b/.test(t) ? 'up' : 'down' })])
  const tap = t.match(/^(?:tap|click|press)(?: on)? (.+)$/)
  if (tap) return reply(`Tapping ${tap[1]}.`, [phoneA('tap', { text: tap[1] })])
  const typ = raw.trim().match(/^type\s+(.+)$/i)
  if (typ) return reply('Typing it.', [phoneA('type', { text: typ[1] })])
  if (/^(go )?back$/.test(t)) return reply('Going back.', [phoneA('back')])
  if (/^(go )?(to )?home( screen)?$/.test(t)) return reply('Home.', [phoneA('home')])
  const setPage = t.match(/^open (.+?) settings?$/)
  if (setPage) return reply(`Opening ${setPage[1]} settings.`, [phoneA('settings', { panel: setPage[1] })])

  // ---- system (needs the FocusLion Leo accessibility switch) ----
  if (has(t, 'shut down', 'shutdown', 'power off', 'restart', 'reboot', /\b(switch|turn|power) off (the |my )?(phone|mobile)\b/))
    return reply("Here's the power menu. Tap Power off or Restart.", [phoneA('power_menu')])
  if (has(t, /\block (the |my )?(phone|screen)\b/, /^lock$/)) return reply('Locking the screen.', [phoneA('lock')])
  if (has(t, 'screenshot', 'screen shot')) return reply('Taking a screenshot.', [phoneA('screenshot')])

  // ---- music ----
  if (has(t, /\b(pause|stop) (the )?(music|song|songs)\b/, /^pause$/)) return reply('Paused.', [phoneA('media', { key: 'pause' })])
  if (has(t, /\b(next|skip) (song|track)\b/, /^next$/)) return reply('Next song.', [phoneA('media', { key: 'next' })])
  if (has(t, /\bprevious (song|track)\b/)) return reply('Previous song.', [phoneA('media', { key: 'previous' })])
  if (has(t, /\bresume\b/, /^play$/)) return reply('Playing.', [phoneA('media', { key: 'play' })])

  // ---- alarms, timers, reminders ----
  // "alarm in 10 minutes" / "remind me in 1 hour" is really a timer
  if (has(t, 'timer', 'टाइमर', 'టైమర్') || /\bin \d+\s*(h|m|s)/.test(t)) {
    const s = parseDuration(t)
    if (s) {
      const label = t.match(/\bto (.+)$/)?.[1] ?? ''
      return reply(`Timer set for ${s >= 60 ? `${Math.round(s / 60)} minutes` : `${s} seconds`}.`, [phoneA('timer', { seconds: s, label })])
    }
  }
  if (has(t, 'alarm', 'wake me', 'अलार्म', 'అలారం', 'remind me at')) {
    const c = parseClock(t)
    if (c) {
      const label = t.match(/\bto (.+)$/)?.[1] ?? (has(t, 'wake') ? 'Wake up' : '')
      return reply(`Alarm set for ${String(c.h).padStart(2, '0')}:${String(c.m).padStart(2, '0')}.`, [phoneA('alarm', { hour: c.h, minute: c.m, label })])
    }
  }

  // ---- info ----
  if (has(t, 'screen time', 'phone usage', 'wasted on my phone'))
    return reply('Checking your screen time.', [phoneA('screen_time')])
  if (has(t, /\btime\b/, 'टाइम', 'समय', 'టైం', 'సమయం') && !has(t, 'timer'))
    return reply(`It's ${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`)
  if (has(t, /\b(date|day)\b/, 'तारीख', 'తేదీ') && !has(t, 'update'))
    return reply(`Today is ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}.`)
  if (has(t, 'battery', 'बैटरी', 'బ్యాటరీ', 'storage', 'phone status', /\b(how s|hows|how is|check|find|where is) my phone\b/))
    return reply('Checking your phone.', [phoneA('info')])

  // ---- focus session in FocusLion ----
  if (has(t, 'focus', 'pomodoro', 'study session', 'पढ़ाई', 'చదువు')) {
    const s = parseDuration(t)
    const minutes = s ? Math.max(5, Math.min(120, Math.round(s / 60))) : 25
    return reply(`Starting a ${minutes} minute focus session. You've got this.`, [{ type: 'start_focus', minutes } as LeoAction])
  }

  // ---- people ----
  const callM = t.match(/^(?:call|phone|dial|ring)\s+(.+)$/) || t.match(/^(.+?)\s+ko\s+(?:call|phone)\s*(?:karo|kar|करो)?$/)
    || t.match(/^(.+?)\s+(?:call|phone)\s+(?:karo|kar|करो)$/)
    || t.match(/^(.+?)\s*(?:కి|కు)?\s*(?:ఫోన్|కాల్)\s*(?:చెయ్యి|చేయి|చేయండి)?$/)
  if (callM) {
    const who = callM[1].replace(/^(my|to)\s+/, '').trim()
    return reply(`Getting ${who} on the line. Tap call to confirm.`, [phoneA('call', { who: aliasName(who) })])
  }
  const wa = t.match(/^(?:whatsapp|message|text)\s+(\w[\w ]*?)(?:\s+(?:that|saying)\s+(.+))?$/)
  if (wa) return reply(`Opening WhatsApp for ${wa[1]}.`, [phoneA('whatsapp', { who: aliasName(wa[1]), text: wa[2] ?? '' })])

  // ---- apps, media, places ----
  const yt = t.match(/^(?:search |play )?(.+?) (?:on|in) youtube$/) || t.match(/^youtube (.+)$/)
  if (yt) return reply(`Searching YouTube for ${yt[1]}.`, [phoneA('youtube', { query: yt[1] })])
  const play = t.match(/^play (.+)$/)
  if (play) return reply(`Playing ${play[1]}.`, [phoneA('music', { query: play[1] })])
  const nav = t.match(/^(?:navigate|directions|take me) to (.+)$/)
  if (nav) return reply(`Starting directions to ${nav[1]}.`, [phoneA('maps', { query: nav[1], navigate: true })])
  if (has(t, 'selfie', 'camera', 'photo', 'కెమెరా', 'कैमरा')) return reply('Opening the camera.', [phoneA('camera')])
  if (has(t, 'wifi', 'wi-fi', 'bluetooth', 'hotspot', 'location'))
    return reply('Opening that setting.', [phoneA('settings', { panel: t.match(/wi-?fi|bluetooth|hotspot|location/)?.[0] ?? 'wifi' })])
  const close = t.match(/^(?:close|exit|quit|kill|band karo|बंद करो)\s+(.+?)(?:\s+app)?$/)
  if (close && !/^(leo|this chat)$/.test(close[1]))
    return reply(`Closing ${close[1]}.`, [phoneA('close_app', { name: /^(this|it|that)( app)?$/.test(close[1]) ? '' : close[1] })])
  const open = t.match(/^(?:open|launch|start|kholo|खोलो)\s+(.+)$/) || t.match(/^(.+?)\s+(?:open|kholo|खोलो|ఓపెన్)\s*(?:karo|చెయ్యి|చేయి)?$/)
  if (open) return reply(`Opening ${open[1]}.`, [phoneA('open_app', { name: open[1].replace(/\s+app$/, '') })])

  return null
}

/** Relations people say vs. how they're usually saved in contacts. */
function aliasName(who: string): string {
  const w = who.trim()
  const map: Record<string, string> = {
    'అమ్మ': 'Amma|Mom|Mother', 'నాన్న': 'Nanna|Dad|Father', 'अम्मी': 'Ammi|Mom', 'मम्मी': 'Mummy|Mom|Mother',
    'मां': 'Maa|Mom|Mother', 'पापा': 'Papa|Dad|Father', mom: 'Mom|Mummy|Amma|Mother', dad: 'Dad|Papa|Nanna|Father',
    mummy: 'Mummy|Mom|Amma', papa: 'Papa|Dad|Nanna', amma: 'Amma|Mom|Mummy', nanna: 'Nanna|Dad|Papa',
  }
  return map[w] ?? map[w.toLowerCase()] ?? w
}

export const OFFLINE_HELP =
  "I'm offline right now, so I can do phone commands — like open an app, call someone, set an alarm or timer, flashlight, volume, music, or start a focus session. Ask me again when you're back online for anything else."
