// FocusLion — "npc-web": server-side web search + page scraper for the Lion City
// citizens, so they can learn from the LIVE internet.
//
// Why a server function: a browser/WebView can't fetch arbitrary web pages or
// search engines (cross-origin CORS blocks it), and Google actively blocks
// automated scraping (and forbids it in its ToS). This function runs on the
// server, where there's no CORS wall, and uses DuckDuckGo's HTML endpoint — a
// keyless search over the OPEN web (indexing the same pages Google does) — then
// can extract readable text from a result page. The caller's Supabase JWT is
// required, so it isn't an open proxy. It never scrapes google.com directly.
//
// Deploy:
//   supabase functions deploy npc-web
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const UA = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded-real-url>. */
function decodeDdgUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) { try { return decodeURIComponent(m[1]) } catch { /* fall through */ } }
  return href.startsWith('//') ? 'https:' + href : href
}

function parseDdg(html: string, limit = 4): Array<{ title: string; snippet: string; url: string }> {
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  const snippets: string[] = []
  let sm: RegExpExecArray | null
  while ((sm = snipRe.exec(html)) && snippets.length < 12) snippets.push(stripTags(sm[1]))
  const out: Array<{ title: string; snippet: string; url: string }> = []
  let lm: RegExpExecArray | null, i = 0
  while ((lm = linkRe.exec(html)) && out.length < limit) {
    const url = decodeDdgUrl(lm[1])
    const title = stripTags(lm[2])
    if (title && /^https?:/i.test(url)) out.push({ title, url, snippet: snippets[i] || '' })
    i++
  }
  return out
}

/** Block private / link-local / metadata hosts (basic SSRF guard for `read`). */
function isPrivateHost(host: string): boolean {
  return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1)/i.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /\.(local|internal)$/i.test(host) || /metadata/i.test(host)
}

async function fetchTextCapped(url: string, maxBytes = 400_000, timeoutMs = 9000): Promise<string | null> {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) return null
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    if (!res.ok || !res.body) return null
    if (!/text|html|json|xml/i.test(res.headers.get('content-type') || '')) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) { chunks.push(value); total += value.length }
    }
    reader.cancel().catch(() => {})
    let len = 0; for (const c of chunks) len += c.length
    const buf = new Uint8Array(len); let o = 0
    for (const c of chunks) { buf.set(c, o); o += c.length }
    return new TextDecoder().decode(buf)
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { action = 'search', query = '', url = '' } =
      (await req.json().catch(() => ({}))) as { action?: string; query?: string; url?: string }

    // ---- read a page → readable text ----
    if (action === 'read') {
      if (!/^https?:\/\//i.test(url)) return json({ error: 'bad url' }, 400)
      const html = await fetchTextCapped(url)
      return json({ text: html ? stripTags(html).slice(0, 1800) : '', url })
    }

    // ---- search the open web (DuckDuckGo HTML) ----
    const q = String(query).trim().slice(0, 200)
    if (!q) return json({ results: [] })
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return json({ results: [], error: `search ${res.status}` })
    return json({ results: parseDdg(await res.text(), 4) })
  } catch (e) {
    // never hard-fail — the client falls back to its offline brain
    return json({ error: String((e as Error)?.message ?? e), results: [] }, 200)
  }
})
