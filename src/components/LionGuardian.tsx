import { motion } from 'framer-motion'
import { guardianStage } from '../lib/capsule'
import { cn } from '../lib/utils'

/**
 * The Lion Guardian — a lion-themed animated companion that protects capsules
 * and visibly grows stronger as the user's Lion Growth Score rises. Pure
 * CSS/framer-motion (no 3D dependency) so it stays fast on mobile: a breathing
 * lion with a layered golden aura whose size/intensity scales with the level.
 */
export function LionGuardian({
  score, size = 96, roaring = false, className,
}: { score: number; size?: number; roaring?: boolean; className?: string }) {
  const stage = guardianStage(score)
  const level = stage.level
  // aura grows with the guardian level
  const auraScale = 1 + level * 0.08
  const rings = Math.min(3, Math.ceil(level / 2))

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      {/* pulsing aura rings */}
      {Array.from({ length: rings }).map((_, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ width: size, height: size, background: stage.aura, opacity: 0.18 }}
          animate={{ scale: [auraScale, auraScale + 0.25, auraScale], opacity: [0.18, 0.04, 0.18] }}
          transition={{ duration: 2.4 + i * 0.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
        />
      ))}

      {/* glow disc */}
      <span
        className="absolute rounded-full blur-xl"
        style={{ width: size * 0.8, height: size * 0.8, background: stage.aura, opacity: 0.35 + level * 0.05 }}
      />

      {/* the lion himself — breathes, and roars (scales up + shakes) on demand */}
      <motion.div
        className="relative select-none"
        style={{ fontSize: size * 0.55, lineHeight: 1, filter: `drop-shadow(0 4px 10px ${stage.aura}88)` }}
        animate={
          roaring
            ? { scale: [1, 1.35, 1.1, 1.25, 1], rotate: [0, -6, 6, -3, 0] }
            : { scale: [1, 1.06, 1], y: [0, -2, 0] }
        }
        transition={
          roaring
            ? { duration: 1.1, ease: 'easeOut' }
            : { duration: 3, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        {stage.emoji}
      </motion.div>

      {/* level pip */}
      <span
        className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-extrabold text-white shadow dark:border-slate-900"
        style={{ background: stage.aura }}
      >
        {level}
      </span>
    </div>
  )
}
