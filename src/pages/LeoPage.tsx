import { LeoLive } from '../components/LeoLive'

/**
 * /leo — Leo on his own, with no FocusLion menus around him. The Android app
 * opens this in a separate pop-up window (LeoActivity) for the floating bubble
 * and "Hey Leo", so closing Leo returns you to whatever app you were using.
 */
export function LeoPage() {
  return (
    <div className="min-h-screen bg-[#02040c]">
      <LeoLive standalone />
    </div>
  )
}
