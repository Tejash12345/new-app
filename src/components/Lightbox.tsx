import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * In-app full-screen photo viewer. Chat photos used to open via
 * <a target="_blank"> — inside the Android WebView that navigates the whole
 * app to the raw file URL, which renders at the browser's default zoom with
 * pinch disabled (enableZoom(false) in the wrapper), so the photo looked
 * clipped/zoomed with no way back except the system button. This shows the
 * image fitted to the screen instead: tap the photo to toggle 2× zoom (drag
 * to pan while zoomed), tap the backdrop or ✕ to close.
 *
 * Rendered through a portal: chat lives inside a `glass` card whose
 * backdrop-filter creates a containing block, which would break fixed
 * positioning (see the QuizPage modal bug).
 */
export function Lightbox({ src, name, onClose }: { src: string; name?: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden' // lock background scroll
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[130] bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={name ?? 'Photo'}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/15 p-2.5 text-white transition hover:bg-white/25"
      >
        <X size={20} />
      </button>
      <div className={zoom ? 'h-full w-full overflow-auto' : 'flex h-full w-full items-center justify-center p-2'}>
        <img
          src={src}
          alt={name ?? 'photo'}
          onClick={(e) => { e.stopPropagation(); setZoom((z) => !z) }}
          className={zoom
            ? 'w-[200%] max-w-none cursor-zoom-out sm:w-auto sm:min-h-full'
            : 'max-h-full max-w-full cursor-zoom-in object-contain'}
        />
      </div>
    </div>,
    document.body,
  )
}
