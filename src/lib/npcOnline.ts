/**
 * Optional online knowledge for NPCs — DISABLED by default.
 *
 * Only ever called when the player has explicitly turned on "NPC internet
 * learning" AND granted permission for the lookup. Uses Wikipedia's public REST
 * API, which is free, needs no API key, and allows cross-origin requests — so no
 * paid/cloud-AI service is involved. Returns a compact, attributed fact that the
 * caller stores in the NPC's LOCAL knowledge base (source: 'web', clearable any
 * time). Fully self-contained: if there's no network, it just returns null and
 * the NPC falls back to its offline brain.
 */

export type WebFact = { title: string; summary: string; url: string; source: 'wikipedia' | 'ai' }

type OpenSearch = [string, string[], string[], string[]]
type Summary = { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }

async function fetchJson<T>(url: string, timeoutMs = 7000): Promise<T | null> {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(to)
  }
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s
}

/**
 * Look up a public summary for `query`. Two keyless, CORS-enabled calls:
 * opensearch to resolve the best-matching title, then the REST summary endpoint.
 */
export async function fetchPublicKnowledge(query: string): Promise<WebFact | null> {
  const q = query.trim()
  if (!q) return null
  const osUrl =
    `https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&origin=*&search=${encodeURIComponent(q)}`
  const os = await fetchJson<OpenSearch>(osUrl)
  const title = os && Array.isArray(os[1]) ? os[1][0] : undefined
  if (!title) return null
  const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  const sum = await fetchJson<Summary>(sumUrl)
  if (!sum?.extract) return null
  return {
    title: sum.title || title,
    summary: trunc(sum.extract, 320),
    url: sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    source: 'wikipedia',
  }
}
