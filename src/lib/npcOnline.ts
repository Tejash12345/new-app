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

export type WebFact = { title: string; summary: string; url: string; source: 'wikipedia' | 'ai' | 'web' }

/** A real Google web-search link for a query — so a citizen (or you) can open the
 *  full web results. The app can't scrape Google directly (browser CORS + ToS),
 *  but it can hand off to it, and it learns from the free sources below. */
export function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`
}

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

type DdgAnswer = { Heading?: string; AbstractText?: string; AbstractURL?: string; RelatedTopics?: Array<{ Text?: string; FirstURL?: string }> }

/**
 * DuckDuckGo Instant Answer — a second free, keyless web source. Broadens
 * learning beyond Wikipedia to "the web". Some browsers/WebViews block it with
 * CORS; if so it just returns null and the caller falls back, so it's harmless
 * to try. Never the first source (used only when Wikipedia misses).
 */
export async function fetchDuckDuckGo(query: string): Promise<WebFact | null> {
  const q = query.trim()
  if (!q) return null
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&t=focuslion`
  const d = await fetchJson<DdgAnswer>(url, 6000)
  if (!d) return null
  let text = (d.AbstractText || '').trim()
  let link = d.AbstractURL || ''
  if (!text && Array.isArray(d.RelatedTopics)) {
    const rt = d.RelatedTopics.find((r) => r.Text)
    if (rt) { text = (rt.Text || '').trim(); link = rt.FirstURL || link }
  }
  if (!text || text.length < 8) return null
  return { title: d.Heading || q, summary: trunc(text, 320), url: link || googleSearchUrl(q), source: 'web' }
}

type WikiSearch = { query?: { search?: Array<{ title?: string; snippet?: string }> } }

/**
 * Wikipedia FULL-TEXT search — broader than opensearch (matches on article
 * content, not just titles), so it finds a relevant page for far more queries.
 * Keyless + CORS-enabled (origin=*).
 */
export async function fetchWikiSearch(query: string): Promise<WebFact | null> {
  const q = query.trim()
  if (!q) return null
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&srprop=snippet&format=json&origin=*&srsearch=${encodeURIComponent(q)}`
  const d = await fetchJson<WikiSearch>(url)
  const hit = d?.query?.search?.[0]
  if (!hit?.title) return null
  const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s/g, '_'))}`
  // prefer a clean summary; fall back to the (HTML) search snippet
  const sum = await fetchJson<Summary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`)
  if (sum?.extract) return { title: sum.title || hit.title, summary: trunc(sum.extract, 320), url: sum.content_urls?.desktop?.page || wikiUrl, source: 'wikipedia' }
  const snip = (hit.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()
  return snip ? { title: hit.title, summary: trunc(snip, 320), url: wikiUrl, source: 'wikipedia' } : null
}

/**
 * Learn from the open web using free, keyless, CORS-enabled sources: Wikipedia
 * (exact title → full-text search), then DuckDuckGo. Returns the first good
 * result, or null. This is the citizens' client-side "search the internet" — no
 * API key, no server. (Deeper live scraping goes through the npc-web function.)
 */
export async function webLookup(query: string): Promise<WebFact | null> {
  return (await fetchPublicKnowledge(query)) || (await fetchWikiSearch(query)) || (await fetchDuckDuckGo(query))
}
