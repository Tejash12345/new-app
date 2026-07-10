import { useSyncExternalStore } from 'react'
import type { Settings } from './types'

// ----------------------------------------------------------------------------
// Custom mascot support. Every lion image in the app (the main mascot and the
// robotic "Leo AI" avatar) renders through this module, so users can replace
// either with their own picture — a pet, an idol, any motivating image.
//
// The chosen image is uploaded to the public `avatars` bucket and its URL is
// saved in profiles.settings (mascotLion / mascotAi) for cross-device sync,
// plus mirrored in localStorage so the splash screen and offline sessions show
// it instantly before the profile loads.
// ----------------------------------------------------------------------------

export type MascotKind = 'lion' | 'ai'

export const MASCOT_DEFAULTS: Record<MascotKind, string> = {
  lion: '/lion.png',
  ai: '/lion-ai.png',
}
const LS_KEY: Record<MascotKind, string> = {
  lion: 'fl-mascot-lion',
  ai: 'fl-mascot-ai',
}
const CHANGE_EVENT = 'fl-mascot-change'

/** Current image URL for a mascot slot — the custom one if set, else the lion. */
export function mascotSrc(kind: MascotKind): string {
  try {
    return localStorage.getItem(LS_KEY[kind]) || MASCOT_DEFAULTS[kind]
  } catch {
    return MASCOT_DEFAULTS[kind]
  }
}

/** Set (or clear with null) the device-local custom mascot and notify the UI. */
export function setMascotLocal(kind: MascotKind, url: string | null) {
  try {
    if (url) localStorage.setItem(LS_KEY[kind], url)
    else localStorage.removeItem(LS_KEY[kind])
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/**
 * Align this device with the account's saved mascots (called when the profile
 * loads). The server copy wins, so a different account on the same device
 * never inherits the previous user's images.
 */
export function syncMascotsFromSettings(settings: Settings | undefined) {
  const wanted: Record<MascotKind, string | null> = {
    lion: settings?.mascotLion || null,
    ai: settings?.mascotAi || null,
  }
  let changed = false
  for (const kind of ['lion', 'ai'] as MascotKind[]) {
    const local = mascotSrc(kind)
    const server = wanted[kind] || MASCOT_DEFAULTS[kind]
    if (local !== server) {
      try {
        if (wanted[kind]) localStorage.setItem(LS_KEY[kind], wanted[kind]!)
        else localStorage.removeItem(LS_KEY[kind])
      } catch { /* storage unavailable */ }
      changed = true
    }
  }
  if (changed) window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => window.removeEventListener(CHANGE_EVENT, onChange)
}

/** Live mascot image for React components; re-renders when the user changes it. */
export function useMascot(kind: MascotKind): { src: string; isCustom: boolean } {
  const src = useSyncExternalStore(subscribe, () => mascotSrc(kind))
  return { src, isCustom: src !== MASCOT_DEFAULTS[kind] }
}

/**
 * Downscale a picked image to ≤512px (plenty for the largest mascot spot) so
 * uploads are small and load fast. WebP keeps transparency for sticker-style
 * art; browsers without WebP encoding fall back to PNG automatically.
 */
export async function prepareMascotImage(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not read the image'))
      i.src = objectUrl
    })
    const max = 512
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
    if (!blob) throw new Error('Could not process the image')
    return blob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
