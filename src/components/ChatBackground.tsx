import { useMemo, type CSSProperties } from 'react'
import { bgById, type ChatBgId } from '../lib/chatBg'

// deterministic pseudo-random (pure — safe to call during render, unlike
// Math.random which the react-compiler rule forbids)
const rand = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x) }

/**
 * Renders the selected animated background — floating emoji particles drifting
 * up or down, with size/opacity/blur variation for a 3D depth feel. Absolutely
 * fills its (relative) parent, behind the content, and ignores pointer events.
 */
export function ChatBackground({ bg }: { bg: ChatBgId }) {
  // value is "<id>" (animated) or "<id>:s" (static — particles freeze scattered
  // like a wallpaper, via animation-play-state: paused + the staggered delays)
  const [baseId, mode] = (bg ?? '').split(':')
  const isStatic = mode === 's'
  const cfg = bgById(baseId)
  const particles = useMemo(() => {
    if (!cfg.glyphs.length) return []
    const soft = cfg.soft
    const count = soft ? 14 : 22
    return Array.from({ length: count }, (_, i) => {
      const s = i + 1
      return {
        key: `${cfg.id}-${i}`,
        g: cfg.glyphs[i % cfg.glyphs.length],
        left: rand(s * 1.3) * 100,
        // soft styles = big dreamy blurred glows (bokeh/clouds)
        size: soft ? 2.5 + rand(s * 2.7) * 3.5 : 0.8 + rand(s * 2.7) * 1.5,
        dur: (soft ? 16 : 8) + rand(s * 3.9) * (soft ? 14 : 10),
        delay: -rand(s * 5.1) * 18,
        o: soft ? 0.16 + rand(s * 6.3) * 0.22 : 0.3 + rand(s * 6.3) * 0.5,
        blur: soft ? 6 + rand(s * 8.9) * 10 : (rand(s * 7.7) < 0.4 ? 1 + rand(s * 8.9) * 1.5 : 0),
      }
    })
  }, [cfg])

  if (!cfg.glyphs.length) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.key}
          className={cfg.dir === 'up' ? 'fl-bg-rise' : 'fl-bg-fall'}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            fontSize: `${p.size}rem`,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
            animationPlayState: isStatic ? 'paused' : 'running',
            filter: p.blur ? `blur(${p.blur}px)` : undefined,
            '--o': p.o,
            // static: hold at full opacity (the keyframe's fade is frozen mid-way)
            ...(isStatic ? { opacity: p.o } : {}),
          } as CSSProperties}
        >
          {p.g}
        </span>
      ))}
    </div>
  )
}
