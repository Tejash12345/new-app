/**
 * Semantic haptics — named vibration patterns for game & UI events.
 *
 * A thin, allocation-free wrapper over navigator.vibrate, gated by the user's
 * `haptics` preference. Each method encodes a *feel* (a reward pulses twice, a
 * boss rumbles long, a tap is a single blip) so callers say what happened, not
 * how long to buzz. Web-only, so it reaches the Android WebView with the normal
 * deploy — provided the app holds android.permission.VIBRATE (added to the
 * Flutter host manifest). A complete no-op on desktop / unsupported devices.
 */
import { getPref } from './prefs'

function buzz(pattern: number | number[]) {
  if (!getPref('haptics')) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* vibration unsupported — silently ignore */
  }
}

/** Named, intent-revealing haptic cues. Pattern arrays alternate buzz/pause (ms). */
export const hap = {
  tap: () => buzz(8), // light UI touch
  select: () => buzz(12), // button / choice commit
  toggle: () => buzz([10, 30, 10]),
  reward: () => buzz([18, 40, 28]), // XP / coins landed
  coin: () => buzz(6),
  attack: () => buzz([30, 20, 30]), // you fired a weapon
  hit: () => buzz([45, 30, 70]), // you took a hit
  boss: () => buzz([80, 40, 80, 40, 120]), // boss / rival encounter
  notify: () => buzz([20, 60, 20]),
  treasure: () => buzz([15, 25, 15, 25, 45]), // chest / rare pickup
  levelUp: () => buzz([25, 30, 25, 30, 25, 40, 60]),
  victory: () => buzz([40, 40, 40, 40, 120]),
  crash: () => buzz([60, 40, 120]),
}
