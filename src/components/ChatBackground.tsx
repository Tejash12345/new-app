import { useMemo, type CSSProperties } from 'react'
import { bgById, isCustomBg, customBgUrl, type ChatBgId } from '../lib/chatBg'

// deterministic pseudo-random (pure — safe to call during render, unlike
// Math.random which the react-compiler rule forbids)
const rand = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x) }

// Shapes a custom photo is auto-clipped into as it floats (a mix of them shows
// at once — heart, star, circle, diamond, hexagon + a plain rounded tile). All
// percentage-based so they scale with each particle's size.
const PHOTO_SHAPES: (string | null)[] = [
  null, // rounded square (keeps ring + shadow)
  'circle(50%)',
  'polygon(50% 92%, 20% 68%, 3% 45%, 3% 27%, 15% 12%, 32% 12%, 50% 28%, 68% 12%, 85% 12%, 97% 27%, 97% 45%, 80% 68%)', // heart
  'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)', // 5-point star
  'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', // diamond
  'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)', // hexagon
]

// vibrant gradient "frame" + matching glow behind each shaped photo tile — this
// is the coloured 3D/4D look: a colourful border hugging the shape, a coloured
// glow, and (via .fl-bg-shimmer) a slow hue cycle so the border shifts colour.
const SHAPE_SKINS: { grad: string; glow: string }[] = [
  { grad: 'linear-gradient(135deg,#ff5f9e,#ffb35a)', glow: 'rgba(255,95,158,0.60)' }, // pink→orange
  { grad: 'linear-gradient(135deg,#7c5cff,#41d4ff)', glow: 'rgba(124,92,255,0.58)' }, // violet→cyan
  { grad: 'linear-gradient(135deg,#ffd23f,#ff6f91)', glow: 'rgba(255,180,63,0.58)' }, // gold→rose
  { grad: 'linear-gradient(135deg,#33d9b2,#3a86ff)', glow: 'rgba(51,217,178,0.58)' }, // teal→blue
  { grad: 'linear-gradient(135deg,#ff6f61,#c04cff)', glow: 'rgba(192,76,255,0.58)' }, // coral→purple
]

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
        {photoParticles.map((p) => {
          const shape = PHOTO_SHAPES[Math.floor(rand((p.i + 1) * 4.4) * PHOTO_SHAPES.length)]
          const skin = SHAPE_SKINS[Math.floor(rand((p.i + 1) * 5.6) * SHAPE_SKINS.length)]
          const clip = shape ? ({ clipPath: shape, WebkitClipPath: shape } as CSSProperties) : {}
          const size = p.size + 1.6
          return (
            <div key={p.key} className="fl-bg-3d absolute"
              style={{
                left: `${p.left}%`,
                width: `${size}rem`,
                height: `${size}rem`,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
                // coloured glow + depth shadow follows the silhouette
                filter: `drop-shadow(0 4px 7px rgba(0,0,0,0.30)) drop-shadow(0 0 8px ${skin.glow})`,
                '--o': p.o,
              } as CSSProperties}>
              {/* coloured 3D/4D frame — hue-shimmers slowly behind the photo */}
              <div className="fl-bg-shimmer absolute inset-0"
                style={{ background: skin.grad, borderRadius: shape ? 0 : '0.95rem', ...clip }} />
              {/* the photo, inset so the coloured frame shows as a border */}
              <img src={url} alt="" className="absolute object-cover"
                style={{ inset: '11%', width: '78%', height: '78%', borderRadius: shape ? 0 : '0.7rem', ...clip }} />
            </div>
          )
        })}
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
