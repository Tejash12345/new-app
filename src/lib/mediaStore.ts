/**
 * Device-side vault for chat media (WhatsApp-style).
 *
 * Photos, voice notes and documents are kept as blobs in IndexedDB on each
 * device, keyed by message id. The Supabase bucket is only the postman: the
 * recipient downloads the file into this vault on first view, then the
 * sender's device deletes the server copy. After that the media exists only
 * on the two phones.
 */

const DB_NAME = 'fl-media'
const STORE = 'blobs'

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    // ask the OS not to evict the vault under storage pressure
    try { void navigator.storage?.persist?.() } catch { /* older WebViews */ }
  }
  return dbPromise
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  try {
    const d = await db()
    return await new Promise((resolve) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as Blob) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function putMediaBlob(key: string, blob: Blob): Promise<boolean> {
  try {
    const d = await db()
    return await new Promise((resolve) => {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    })
  } catch {
    return false
  }
}

export async function deleteMediaBlob(key: string): Promise<void> {
  try {
    const d = await db()
    await new Promise<void>((resolve) => {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch { /* nothing to delete */ }
  const u = urls.get(key)
  if (u) {
    URL.revokeObjectURL(u)
    urls.delete(key)
  }
}

// one object URL per key for the session, so list re-renders don't leak
const urls = new Map<string, string>()
export function objectUrlFor(key: string, blob: Blob): string {
  let u = urls.get(key)
  if (!u) {
    u = URL.createObjectURL(blob)
    urls.set(key, u)
  }
  return u
}

/** Bucket path inside chat-media, extracted from a public URL. */
export function chatMediaPath(fileUrl: string): string | null {
  const i = fileUrl.indexOf('/chat-media/')
  if (i === -1) return null
  try {
    return decodeURIComponent(fileUrl.slice(i + '/chat-media/'.length))
  } catch {
    return fileUrl.slice(i + '/chat-media/'.length)
  }
}
