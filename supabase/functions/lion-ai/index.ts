// FocusLion — "Lion AI Assistant" secure AI proxy (Supabase Edge Function)
//
// AI API keys NEVER ship in the app. They live only in this function's
// environment as secrets. The browser/app calls this function (with the
// user's Supabase JWT); we validate the user, then call the first available
// free AI provider (Groq → Gemini → Cloudflare → OpenRouter → NVIDIA), all
// OpenAI-compatible.
//
// Free-tier hardening:
//   • Multi-provider fallback — a rate-limited provider hands off to the next.
//   • Optional per-user daily cap (AI_DAILY_USER_CAP, default 0 = unlimited).
//   • Response cache for idempotent tasks — identical prompts skip the model.
//   • Usage counted server-side (only real model calls, not cache hits).
//   • Daily briefings & missions are cached per-day client-side already.
//
// Deploy:
//   supabase secrets set GROQ_API_KEY=gsk_... GEMINI_API_KEY=... OPENROUTER_API_KEY=sk-or-... NVIDIA_API_KEY=nvapi-...
//   supabase functions deploy lion-ai
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---- AI providers (all free tiers, all OpenAI-compatible) ----
// Every request walks this chain: if one provider is rate-limited, down, or
// slow, the next one answers — so users don't see a "limit reached" message
// unless EVERY configured provider is out at the same moment. A provider is
// used only when its API key secret is set; order comes from AI_PROVIDER_ORDER.
//
//   GROQ_API_KEY    console.groq.com/keys   (fastest; big daily limits)
//   GEMINI_API_KEY  aistudio.google.com     (Google; strong Indic languages + vision)
//   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID  dash.cloudflare.com (Workers AI)
//   OPENROUTER_API_KEY openrouter.ai/keys   (":free" models; backup)
//   NVIDIA_API_KEY  build.nvidia.com        (NIM; last resort)
//
// Do NOT pick *reasoning* models for these slots (hidden <think> chains leak
// into output and take minutes). Every model is overridable via its secret.
type Provider = {
  name: string
  url: string
  key: string
  model: string        // content tasks (recipes, quiz, roadmaps, JSON)
  fast: string         // interactive chat ({ fast: true })
  vision: string       // Leo Lens photos ('' = provider has no vision model)
  visionFallback: string
  extra?: Record<string, unknown> // provider-specific request fields
}
const env = (k: string, d = '') => Deno.env.get(k) || d
// Older deploys stored the nvapi-… key under GEMINI_API_KEY — keep that working.
const rawGemini = env('GEMINI_API_KEY')
const NVIDIA_KEY = env('NVIDIA_API_KEY') || (rawGemini.startsWith('nvapi-') ? rawGemini : '')
const GEMINI_KEY = rawGemini.startsWith('nvapi-') ? '' : rawGemini

const ALL_PROVIDERS: Record<string, Provider> = {
  groq: {
    name: 'groq',
    url: `${env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1')}/chat/completions`,
    key: env('GROQ_API_KEY'),
    // Groq dropped its Llama models (Nov 2026). gpt-oss / qwen are reasoning
    // models, but Groq returns the reasoning in a separate `reasoning` field,
    // so `content` stays clean; effort "low" keeps them fast.
    model: env('GROQ_MODEL', 'openai/gpt-oss-120b'),
    fast: env('GROQ_FAST_MODEL', 'openai/gpt-oss-20b'),
    vision: env('GROQ_VISION_MODEL', 'qwen/qwen3.8-27b'),
    visionFallback: '',
    extra: { reasoning_effort: 'low' },
  },
  gemini: {
    name: 'gemini',
    url: `${env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai')}/chat/completions`,
    key: GEMINI_KEY,
    // "-latest" aliases follow Google's current Flash models, so a retired
    // version (2.5 was retired for new keys) doesn't break the app.
    model: env('GEMINI_MODEL', 'gemini-flash-latest'),
    fast: env('GEMINI_FAST_MODEL', 'gemini-flash-lite-latest'),
    vision: env('GEMINI_VISION_MODEL', 'gemini-flash-latest'),
    visionFallback: env('GEMINI_VISION_FALLBACK', 'gemini-flash-lite-latest'),
    // keep "thinking" short so it doesn't eat max_tokens or add latency
    // ("none" and "minimal" are rejected by the current Flash models)
    extra: { reasoning_effort: 'low' },
  },
  openrouter: {
    name: 'openrouter',
    url: `${env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')}/chat/completions`,
    key: env('OPENROUTER_API_KEY'),
    // ":free" models only — they cost nothing but are often rate-limited
    // upstream, which is fine as a mid-chain backup.
    model: env('OPENROUTER_MODEL', 'nvidia/nemotron-3-ultra-550b-a55b:free'),
    fast: env('OPENROUTER_FAST_MODEL', 'baidu/ernie-5.5-flash-preview:free'),
    vision: env('OPENROUTER_VISION_MODEL', 'google/gemma-4-31b-it:free'),
    visionFallback: env('OPENROUTER_VISION_FALLBACK', 'nvidia/nemotron-3.5-super-vl:free'),
  },
  cloudflare: {
    name: 'cloudflare',
    // Workers AI free allowance resets daily. Needs both the account id and
    // an API token with Workers AI Read + Write.
    url: `https://api.cloudflare.com/client/v4/accounts/${env('CLOUDFLARE_ACCOUNT_ID')}/ai/v1/chat/completions`,
    key: env('CLOUDFLARE_ACCOUNT_ID') ? env('CLOUDFLARE_API_TOKEN') : '',
    // Llama 4 Scout: fast, clean JSON, correct Telugu and reads photos.
    // (Llama 3.3 70B was tested and garbled Telugu, so it's not used.)
    model: env('CLOUDFLARE_MODEL', '@cf/meta/llama-4-scout-17b-16e-instruct'),
    fast: env('CLOUDFLARE_FAST_MODEL', '@cf/mistralai/mistral-small-3.1-24b-instruct'),
    vision: env('CLOUDFLARE_VISION_MODEL', '@cf/meta/llama-4-scout-17b-16e-instruct'),
    visionFallback: env('CLOUDFLARE_VISION_FALLBACK', '@cf/google/gemma-4-26b-a4b-it'),
  },
  nvidia: {
    name: 'nvidia',
    url: `${env('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1')}/chat/completions`,
    key: NVIDIA_KEY,
    // NVIDIA retires free-tier models without notice (the Llama 3.x models went
    // 404 by Nov 2026, and many listed models 404 per-account or queue for
    // minutes). These answered in ~1-3s when tested; Nemotron puts its
    // reasoning in `reasoning_content`, so `content` stays clean.
    model: env('NVIDIA_MODEL', 'nvidia/nemotron-3-ultra-550b-a55b'),
    fast: env('NVIDIA_FAST_MODEL', 'nvidia/nemotron-3.5-bolt-e4b'),
    vision: env('NVIDIA_VISION_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
    visionFallback: env('NVIDIA_VISION_FALLBACK', 'meta/llama-3.2-90b-vision-instruct'),
  },
}
const PROVIDERS: Provider[] = env('AI_PROVIDER_ORDER', 'groq,gemini,cloudflare,openrouter,nvidia')
  .split(',')
  .map((s) => ALL_PROVIDERS[s.trim().toLowerCase()])
  .filter((p): p is Provider => !!p && !!p.key)

// Per-user daily cap. 0 (the default) = unlimited.
const DAILY_USER_CAP = Number(env('AI_DAILY_USER_CAP', '0')) || 0

// idempotent tasks worth caching (same input -> same answer). Chat/mission/
// briefing are excluded: chat is conversational, mission/briefing are
// personalized and already cached per-day on the client.
const CACHEABLE = ['summarize', 'hashtags', 'caption', 'explain', 'startup', 'career', 'learnpath']
const JSON_TASKS = ['mission', 'learnpath', 'career', 'startup']
// Bump when a task's prompt/response shape changes so stale cached answers in
// the old format aren't served. (v2: learnpath now also returns reference links.)
const PROMPT_VERSION = 'v2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const QUOTA_MSG = "Leo is busy right now — please try again in a minute. 🦁"
const isQuota = (status: number, body: string) =>
  status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(body)

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const BASE_PERSONA =
  `You are "Leo", the Lion AI Assistant inside FocusLion, a student productivity app. ` +
  `You are warm, motivating and concise, with a calm lion vibe (occasional 🦁). ` +
  `Use short paragraphs and bullet points. Never invent facts; if unsure, say so.`

function systemFor(task: string): string {
  switch (task) {
    case 'summarize':
      return `${BASE_PERSONA} Summarize the user's text into 3-4 crisp bullet points, then one takeaway line.`
    case 'hashtags':
      return `${BASE_PERSONA} Generate 5-8 relevant, lowercase hashtags for the user's text. ` +
        `Return ONLY the hashtags separated by spaces, no other words.`
    case 'caption':
      return `${BASE_PERSONA} Rewrite the user's text into one improved, engaging social caption ` +
        `(max 2 sentences). Keep their meaning. Return ONLY the caption.`
    case 'explain':
      return `${BASE_PERSONA} Explain the programming/tech concept clearly for a student: ` +
        `a plain-language definition, a tiny code or real-world example, and one gotcha.`
    case 'medical':
      return `${BASE_PERSONA} Provide EDUCATIONAL medical information only. ` +
        `Always add a short disclaimer that this is not medical advice and to consult a professional.`
    case 'tip':
      return `${BASE_PERSONA} Give one specific, actionable productivity tip the student can use today. 2-3 sentences.`
    case 'mission':
      return `${BASE_PERSONA} Create ONE personalized daily mission for the student based on the context. ` +
        `Return STRICT JSON only, no markdown, with exactly: ` +
        `{"title": string (max 8 words), "detail": string (one motivating sentence), "xp": integer 10-50}.`
    case 'briefing':
      return `${BASE_PERSONA} Write a short, energizing daily briefing (2-3 sentences) for the student ` +
        `using their stats in the context. Be specific and forward-looking. ` +
        `Do NOT open with a time-of-day greeting like "Good morning/afternoon/evening" or their name — ` +
        `the app already greets them separately. Start straight with the insight. No lists.`
    case 'learnpath':
      return `${BASE_PERSONA} Build a practical learning roadmap for the requested topic and level. ` +
        `Return STRICT JSON only, no markdown, with exactly: ` +
        `{"summary": string (one sentence), "steps": [{"title": string, "detail": string}], ` +
        `"resources": [{"title": string, "url": string, "kind": string}]} ` +
        `with 8-12 ordered steps from basics to advanced, each detail one actionable sentence. ` +
        `"resources" = 4-6 high-quality REFERENCE LINKS for studying this topic — prefer official ` +
        `documentation, well-known free courses/tutorials, and reputable YouTube videos. ` +
        `Use only real, stable URLs you are confident exist (e.g. official docs sites, MDN, ` +
        `freeCodeCamp, Coursera, official YouTube channels); never invent URLs or use placeholders. ` +
        `"kind" is a one-word label like "Docs", "Course", "Video", "Article" or "Book".`
    case 'career':
      return `${BASE_PERSONA} You are an expert, encouraging career coach. Given a target role and the ` +
        `user's resume/skills, return STRICT JSON only, no markdown, with exactly: ` +
        `{"readiness": integer 0-100, "verdict": string (one line), "strengths": [string], "gaps": [string], ` +
        `"improvements": [string], "skillsToLearn": [string], "interviewQuestions": [string]}. ` +
        `Each list 4-6 concise items. Be specific to the role and what they wrote.`
    case 'startup':
      return `${BASE_PERSONA} You are a sharp startup co-founder and analyst. Given a startup idea, return ` +
        `STRICT JSON only, no markdown, with exactly: ` +
        `{"summary": string, "market": string, "revenueModel": [string], "competitors": [string], ` +
        `"mvpFeatures": [string], "team": [string], "roadmap": [{"phase": string, "detail": string}]}. ` +
        `Each list 3-6 items, concise and concrete. Roadmap 3-5 phases from MVP to launch.`
    case 'vision':
      return `${BASE_PERSONA} You are Leo Lens, a patient tutor who reads photos of study material — ` +
        `textbook questions, equations, diagrams, handwritten notes. First read the photo carefully and ` +
        `state what the question/content is, then follow the user's instruction. Show working step by step ` +
        `in simple language, and end with the key takeaway or final answer on its own line. ` +
        `Plain text only — no markdown symbols like ** or #. If the photo is unreadable, say what you can ` +
        `see and ask for a clearer shot.`
    default: // chat
      return `${BASE_PERSONA} You help with tech learning, educational medical knowledge, ` +
        `startup ideas, productivity, motivation and goal tracking. For medical topics, add a ` +
        `"not medical advice" note. Keep replies focused and friendly.`
  }
}

type InMsg = { role: 'user' | 'assistant'; content: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    if (!PROVIDERS.length) {
      return json({ error: 'Server has no AI key. Set GROQ_API_KEY, GEMINI_API_KEY or NVIDIA_API_KEY.' }, 500)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization') ?? ''

    // ---- authenticate the caller via their Supabase JWT ----
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { task = 'chat', input = '', messages = [], stream: wantStreamRaw = false, fast: wantFast = false, image = '' } =
      (await req.json().catch(() => ({}))) as { task?: string; input?: string; messages?: InMsg[]; stream?: boolean; fast?: boolean; image?: string }

    // Leo Lens photo input — a data URL, downscaled client-side. Reject
    // oversized payloads before they reach the model API.
    if (task === 'vision') {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return json({ error: 'A photo is required.' }, 400)
      if (image.length > 2_500_000) return json({ error: 'Photo too large — please retake it.' }, 413)
    }

    // service-role client for cache + usage (bypasses RLS)
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const today = new Date().toISOString().slice(0, 10)

    // ---- rate-limit row + cached answer, fetched together ----
    // They're independent, so run them in one round-trip instead of two.
    const cacheable = CACHEABLE.includes(task) && !!input
    const cacheKey = cacheable ? await sha256(`${PROMPT_VERSION}::${task}::${input}`) : ''

    const [usageResult, cacheResult] = await Promise.all([
      admin.from('ai_usage').select('calls').eq('user_id', user.id).eq('used_on', today).maybeSingle(),
      cacheable
        ? admin.from('ai_cache').select('response').eq('cache_key', cacheKey).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ])

    const used = ((usageResult as any)?.data?.calls as number) ?? 0
    if (DAILY_USER_CAP > 0 && used >= DAILY_USER_CAP) {
      console.warn(`[RATELIMIT] user=${user.id} used=${used}/${DAILY_USER_CAP} task=${task}`)
      return json({ error: `You've reached today's AI limit of ${DAILY_USER_CAP} requests. It resets tomorrow. 🦁`, limited: true }, 429)
    }

    const cachedResponse = (cacheResult as any)?.data?.response
    if (cachedResponse) {
      console.log(`[CACHE_HIT] task=${task} user=${user.id}`)
      return json({ text: String(cachedResponse), task, cached: true })
    }

    // ---- build NVIDIA (OpenAI-compatible) request ----
    const history = Array.isArray(messages) ? messages.slice(-16) : []
    const chatMessages = task === 'vision'
      ? [
          { role: 'system', content: systemFor('vision') },
          {
            role: 'user',
            content: [
              { type: 'text', text: String(input || 'Read this photo and solve or explain it for a student.') },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ]
      : [
      { role: 'system', content: systemFor(task) },
      ...(history.length
        ? history.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content ?? ''),
          }))
        : [{ role: 'user', content: String(input ?? '') }]),
    ]

    // Build the ordered list of (provider, model) attempts. Per provider:
    // interactive chat tries the fast model first, content/JSON tasks the main
    // model first, photos the vision models; the other model is that
    // provider's backup. Then the next provider takes over.
    const useFast = wantFast && !JSON_TASKS.includes(task)
    const attempts: { p: Provider; model: string }[] = []
    for (const p of PROVIDERS) {
      const models = task === 'vision'
        ? [p.vision, p.visionFallback]
        : useFast ? [p.fast, p.model] : [p.model, p.fast]
      for (const m of [...new Set(models)].filter(Boolean)) attempts.push({ p, model: m })
    }
    if (!attempts.length) return json({ error: 'No AI provider supports this request.' }, 500)
    // The Edge Function worker is killed at ~150s; stop trying new attempts
    // before then so we can still return a clean error.
    const deadline = Date.now() + 115_000
    const bodyFor = (a: { p: Provider; model: string }, stream: boolean) =>
      JSON.stringify({ ...payload, model: a.model, stream, ...(a.p.extra ?? {}) })

    const payload = {
      messages: chatMessages,
      temperature: task === 'mission' ? 0.9 : task === 'vision' ? 0.4 : 0.7,
      max_tokens:
        // interactive chat (fast path) is meant to be concise — cap it low so a
        // reply can't run long, which keeps generation quick and reduces load on
        // the free NIM tier (a big generation is what stalls/queues for ~150s)
        useFast ? 700
        : task === 'startup' || task === 'career' || task === 'learnpath' ? 2048
        : task === 'mission' ? 1024
        // 'chat' also carries the Diet planner & recipe JSON. Non-English recipes
        // (Telugu/Hindi/Tamil…) tokenize ~3-4x heavier than English, so 1024 tokens
        // truncated them mid-string → invalid JSON → "Could not load the recipe".
        // 3072 leaves room for Indic-script output while staying well under the
        // ~150s Edge Function worker limit on a fast instruct model.
        : task === 'chat' ? 3072
        : task === 'vision' ? 1400
        : 512,
      stream: false,
      ...(JSON_TASKS.includes(task) ? { response_format: { type: 'json_object' } } : {}),
    }

    // ---- streaming path (interactive chat) ----
    // JSON tasks can't stream usefully (the client parses the whole object), so
    // only free-text tasks stream. The reply is forwarded token-by-token as
    // plain text, so Leo starts "typing" within ~1s instead of after the full
    // answer is generated.
    const wantStream = wantStreamRaw === true && !JSON_TASKS.includes(task)
    if (wantStream) {
      // Walk the provider chain until one starts streaming. Each attempt aborts
      // if response HEADERS don't arrive in 25s (model queued/retired); the
      // timer is cleared once they do, so an active stream is never cut off.
      let upstream: Response | null = null
      let sawQuota = false
      let lastErr = ''
      for (const a of attempts) {
        const left = deadline - Date.now()
        if (left < 8_000) break
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(new DOMException('headers timeout', 'TimeoutError')), Math.min(25_000, left))
        try {
          const r = await fetch(a.p.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.p.key}` },
            body: bodyFor(a, true),
            signal: ctrl.signal,
          })
          if (r.ok && r.body) { upstream = r; break }
          const b = await r.text().catch(() => '')
          if (isQuota(r.status, b)) sawQuota = true
          lastErr = `${a.p.name}/${a.model} ${r.status}: ${b.slice(0, 200)}`
        } catch (e) {
          lastErr = `${a.p.name}/${a.model}: ${String(e).slice(0, 200)}`
        } finally {
          clearTimeout(timer)
        }
        console.warn(`[FALLBACK] stream ${lastErr}`)
      }
      if (!upstream?.body) {
        console.error(`[AI_ERR] all providers failed (stream) user=${user.id} task=${task} :: ${lastErr}`)
        return sawQuota
          ? json({ error: QUOTA_MSG, quota: true }, 429)
          : json({ error: 'AI request failed', detail: lastErr }, 502)
      }

      // Count this call now (optimistic): the body streams out and we can't
      // reliably run code after it closes.
      admin.from('ai_usage').upsert(
        { user_id: user.id, used_on: today, calls: used + 1, last_task: task, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,used_on' },
      ).then(() => {}, () => {})

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let sseBuf = ''
      let startedContent = false
      // Process one SSE line. When emit=true we forward its content delta; the
      // trailing (still-partial) buffer is peeked with emit=false so we can spot
      // a completion signal without double-emitting when the frame completes.
      // Returns true when the stream should close.
      const handleLine = (raw: string, emit: boolean, controller: ReadableStreamDefaultController): boolean => {
        const t = raw.trim()
        if (!t.startsWith('data:')) return false
        const p = t.slice(5).trim()
        if (p === '[DONE]') return true
        try {
          const j = JSON.parse(p)
          const choice = j?.choices?.[0]
          if (emit) {
            // strip any reasoning-model <think> markers if a model emits them
            const delta = String(choice?.delta?.content ?? '').replace(/<\/?think>/gi, '')
            if (delta) { controller.enqueue(encoder.encode(delta)); startedContent = true }
          }
          // close as soon as the model signals completion — some NIM endpoints
          // never send [DONE] and hold the connection open until the worker limit
          if (choice?.finish_reason) return true
        } catch { /* keepalive ping or a frame split across reads */ }
        return false
      }
      const out = new ReadableStream({
        async pull(controller) {
          try {
            // Wait patiently for the FIRST token (a cold model can take ~1min),
            // but once tokens are flowing a multi-second gap means the endpoint
            // finished and just isn't closing — so we close it ourselves.
            const idleMs = startedContent ? 6000 : 140000
            let timer: number | undefined
            const idle = new Promise((res) => { timer = setTimeout(() => res('IDLE'), idleMs) })
            const result: any = await Promise.race([reader.read(), idle])
            clearTimeout(timer)
            if (result === 'IDLE') { controller.close(); try { await reader.cancel() } catch { /* noop */ } return }
            if (result.done) { controller.close(); return }
            sseBuf += decoder.decode(result.value, { stream: true })
            const lines = sseBuf.split('\n')
            sseBuf = lines.pop() ?? '' // keep the trailing partial line for next read
            for (const line of lines) {
              if (handleLine(line, true, controller)) { controller.close(); return }
            }
            // terminal frame may arrive without its trailing newline (stuck in
            // sseBuf) — peek for a completion signal so we don't hang waiting
            if (handleLine(sseBuf, false, controller)) { controller.close(); return }
          } catch (e) {
            controller.error(e)
          }
        },
        cancel() { try { reader.cancel() } catch { /* noop */ } },
      })
      return new Response(out, {
        headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    }

    // Walk the provider chain with a hard timeout per attempt. A rate-limited,
    // retired (404/410), queued or failing model just hands off to the next
    // attempt — without this, one dead model hangs the worker past its limit
    // and EVERY AI feature dies with a 546.
    let res: Response | null = null
    let sawQuota = false
    let lastErr = ''
    for (const a of attempts) {
      const left = deadline - Date.now()
      if (left < 8_000) break
      try {
        const r = await fetch(a.p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.p.key}` },
          body: bodyFor(a, false),
          signal: AbortSignal.timeout(Math.min(40_000, left)),
        })
        if (r.ok) { res = r; break }
        const b = await r.text().catch(() => '')
        if (isQuota(r.status, b)) sawQuota = true
        lastErr = `${a.p.name}/${a.model} ${r.status}: ${b.slice(0, 200)}`
      } catch (e) {
        lastErr = `${a.p.name}/${a.model}: ${String(e).slice(0, 200)}`
      }
      console.warn(`[FALLBACK] ${lastErr}`)
    }
    if (!res) {
      console.error(`[AI_ERR] all providers failed user=${user.id} task=${task} :: ${lastErr}`)
      return sawQuota
        ? json({ error: QUOTA_MSG, quota: true }, 429)
        : json({ error: 'AI request failed', detail: lastErr }, 502)
    }

    const data = await res.json() as any
    // OpenAI-compatible shape: choices[0].message.content. MiniMax is a reasoning
    // model, so strip any <think>…</think> chain-of-thought it may prepend.
    const text: string = String(data?.choices?.[0]?.message?.content ?? '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim()

    // store cache + count the (real) model call
    if (cacheable && cacheKey && text) {
      await admin.from('ai_cache').upsert({ cache_key: cacheKey, task, response: text, hits: 0 }).then(() => {}, () => {})
    }
    await admin.from('ai_usage').upsert(
      { user_id: user.id, used_on: today, calls: used + 1, last_task: task, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,used_on' },
    ).then(() => {}, () => {})

    return json({ text: text.trim(), task })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
