import { useMemo, type CSSProperties } from 'react'
import { bgById, isCustomBg, customBgUrl, type ChatBgId } from '../lib/chatBg'

// deterministic pseudo-random (pure — safe to call during render, unlike
// Math.random which the react-compiler rule forbids)
const rand = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x) }

/** Layout for both emoji and photo particles. */
function makeParticles(seed: string, count: number, sizeBase: number, sizeVar: number, durBase: number, durVar: number, oBase: number, oVar: number, softBlur: boolean) {
  return Array.from({ length: count }, (_, i) => {
    const s = i + 1
    return {
      key: `${seed}-${i}`,
      i,
      left: rand(s * 1.3) * 100,
      size: sizeBase + rand(s * 2.7) * sizeVar,
      dur: durBase + rand(s * 3.9) * durVar,
      delay: -rand(s * 5.1) * 18,
      o: oBase + rand(s * 6.3) * oVar,
      blur: softBlur ? 6 + rand(s * 8.9) * 10 : (rand(s * 7.7) < 0.4 ? 1 + rand(s * 8.9) * 1.5 : 0),
    }
  })
}

/**
 * Renders the selected animated background — floating emoji particles drifting
 * up or down, with size/opacity/blur variation for a 3D depth feel. Absolutely
 * fills its (relative) parent, behind the content, and ignores pointer events.
 */
export function ChatBackground({ bg }: { bg: ChatBgId }) {
  const custom = isCustomBg(bg)
  const url = customBgUrl(bg)
  // value is "<id>" (animated) or "<id>:s" (static — particles freeze scattered
  // like a wallpaper, via animation-play-state: paused + the staggered delays)
  const [baseId, mode] = (bg ?? '').split(':')
  const isStatic = mode === 's' && !custom
  const cfg = bgById(baseId)

  // custom photo → floating 3D-tumbling photo tiles
  const photoParticles = useMemo(() => (custom ? makeParticles(url, 14, 2.6, 2.2, 11, 10, 0.72, 0.24, false) : []), [custom, url])
  const particles = useMemo(() => {
    if (custom || !cfg.glyphs.length) return []
    const soft = cfg.soft
    return makeParticles(cfg.id, soft ? 14 : 22, soft ? 2.5 : 0.8, soft ? 3.5 : 1.5, soft ? 16 : 8, soft ? 14 : 10, soft ? 0.16 : 0.3, soft ? 0.22 : 0.5, !!soft)
  }, [cfg, custom])

  if (custom && url) {
    return (
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]" aria-hidden>
        {photoParticles.map((p) => (
          <img key={p.key} src={url} alt="" className="fl-bg-3d absolute rounded-2xl object-cover shadow-lg ring-1 ring-white/30"
            style={{
              left: `${p.left}%`,
              width: `${p.size + 1.4}rem`,
              height: `${p.size + 1.4}rem`,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              '--o': p.o,
            } as CSSProperties}
          />
        ))}
      </div>
    )
  }

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
          {cfg.glyphs[p.i % cfg.glyphs.length]}
        </span>
      ))}
    </div>
  )
}
