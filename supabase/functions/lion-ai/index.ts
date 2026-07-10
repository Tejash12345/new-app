// FocusLion — "Lion AI Assistant" secure AI proxy (Supabase Edge Function)
//
// The AI API key NEVER ships in the app. It lives only in this function's
// environment as the NVIDIA_API_KEY secret. The browser/app calls this function
// (with the user's Supabase JWT); we validate the user, then call NVIDIA NIM
// (DeepSeek), which uses the OpenAI-compatible chat-completions API.
//
// Free-tier hardening:
//   • Per-user daily rate limit (AI_DAILY_USER_CAP, default 30).
//   • Response cache for idempotent tasks — identical prompts skip the model.
//   • Graceful 429 / rate-limit handling + quota logging.
//   • Usage counted server-side (only real model calls, not cache hits).
//   • Daily briefings & missions are cached per-day client-side already.
//
// Deploy:
//   supabase functions deploy lion-ai
//   supabase secrets set NVIDIA_API_KEY=nvapi-... NVIDIA_MODEL=meta/llama-3.3-70b-instruct
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Main NVIDIA NIM model — strongest *currently served* instruct model with good
// Indic languages (Telugu/Hindi/Tamil…) and json_object support. NVIDIA retires
// free-tier models without notice (Maverick, Llama-3.3-70B, Gemma 3, Kimi K2 all
// went 404/410/queue-forever in mid-2026), so every non-streaming call below is
// wrapped in a hard timeout that falls back to FAST_MODEL — a retired or queued
// main model degrades quality for a while instead of 546-ing every AI feature.
// Do NOT use a *reasoning* model (hidden <think> chains leak into output and
// take minutes). Check candidates with the /models endpoint before switching.
const MODEL = Deno.env.get('NVIDIA_MODEL') ?? 'meta/llama-3.1-70b-instruct'
// A lighter model for the INTERACTIVE chat (Lion AI assistant / Coach), where
// snappy replies matter more than Maverick's multilingual recipe quality. The
// big MoE Maverick queues for tens of seconds on the free NIM tier; a small
// dense 8B model responds in a few seconds. Content tasks (recipes, quiz,
// roadmaps) still use MODEL. Requests opt in with { fast: true }.
const FAST_MODEL = Deno.env.get('NVIDIA_FAST_MODEL') ?? 'meta/llama-3.1-8b-instruct'
// Prefer NVIDIA_API_KEY; fall back to GEMINI_API_KEY so an already-set secret
// keeps working if you only swapped its value to the nvapi-… key.
const AI_API_KEY = Deno.env.get('NVIDIA_API_KEY') ?? Deno.env.get('GEMINI_API_KEY') ?? ''
const DAILY_USER_CAP = Number(Deno.env.get('AI_DAILY_USER_CAP') ?? '30')
const BASE_URL = Deno.env.get('NVIDIA_BASE_URL') ?? 'https://integrate.api.nvidia.com/v1'
const AI_URL = `${BASE_URL}/chat/completions`

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

const QUOTA_MSG = "Lion AI is rate-limited right now — please try again shortly. 🦁 Coach Leo will keep helping in the meantime."

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
    if (!AI_API_KEY) return json({ error: 'Server is missing NVIDIA_API_KEY.' }, 500)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization') ?? ''

    // ---- authenticate the caller via their Supabase JWT ----
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { task = 'chat', input = '', messages = [], stream: wantStreamRaw = false, fast: wantFast = false } =
      (await req.json().catch(() => ({}))) as { task?: string; input?: string; messages?: InMsg[]; stream?: boolean; fast?: boolean }

    // service-role client for cache + usage (bypasses RLS)
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const today = new Date().toISOString().slice(0, 10)

    // ---- rate-limit row + cached answer, fetched together ----
    // They're independent, so run them in one round-trip instead of two.
    const cacheable = CACHEABLE.includes(task) && !!input
    const cacheKey = cacheable ? await sha256(`${MODEL}::${PROMPT_VERSION}::${task}::${input}`) : ''

    const [usageResult, cacheResult] = await Promise.all([
      admin.from('ai_usage').select('calls').eq('user_id', user.id).eq('used_on', today).maybeSingle(),
      cacheable
        ? admin.from('ai_cache').select('response').eq('cache_key', cacheKey).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ])

    const used = ((usageResult as any)?.data?.calls as number) ?? 0
    if (used >= DAILY_USER_CAP) {
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
    const chatMessages = [
      { role: 'system', content: systemFor(task) },
      ...(history.length
        ? history.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content ?? ''),
          }))
        : [{ role: 'user', content: String(input ?? '') }]),
    ]

    // interactive chat opts into the lighter, faster model; content/JSON tasks
    // keep the higher-quality MODEL
    const activeModel = wantFast && !JSON_TASKS.includes(task) ? FAST_MODEL : MODEL
    const payload = {
      model: activeModel,
      messages: chatMessages,
      temperature: task === 'mission' ? 0.9 : 0.7,
      max_tokens:
        // interactive chat (fast path) is meant to be concise — cap it low so a
        // reply can't run long, which keeps generation quick and reduces load on
        // the free NIM tier (a big generation is what stalls/queues for ~150s)
        wantFast && !JSON_TASKS.includes(task) ? 700
        : task === 'startup' || task === 'career' || task === 'learnpath' ? 2048
        : task === 'mission' ? 1024
        // 'chat' also carries the Diet planner & recipe JSON. Non-English recipes
        // (Telugu/Hindi/Tamil…) tokenize ~3-4x heavier than English, so 1024 tokens
        // truncated them mid-string → invalid JSON → "Could not load the recipe".
        // 3072 leaves room for Indic-script output while staying well under the
        // ~150s Edge Function worker limit on a fast instruct model.
        : task === 'chat' ? 3072
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
      // abort if response HEADERS don't arrive in 30s (model queued/retired) —
      // the timer is cleared once they do, so an active stream is never cut off
      const callUpstream = (model: string) => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(new DOMException('headers timeout', 'TimeoutError')), 30_000)
        return fetch(AI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
          body: JSON.stringify({ ...payload, model, stream: true }),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer))
      }
      // if one model is unavailable (error status or headers timeout),
      // transparently retry once with the other so chat never breaks
      const altModel = activeModel === MODEL ? FAST_MODEL : MODEL
      let upstream: Response
      try {
        upstream = await callUpstream(activeModel)
        if (!upstream.ok && upstream.status !== 429 && altModel !== activeModel) {
          console.warn(`[FALLBACK] stream ${activeModel} unavailable (status ${upstream.status}) -> ${altModel}`)
          upstream = await callUpstream(altModel)
        }
      } catch (e) {
        if (altModel === activeModel) {
          return json({ error: 'Could not reach the AI provider', detail: String(e) }, 502)
        }
        console.warn(`[FALLBACK] stream ${activeModel} timed out -> ${altModel} :: ${String(e).slice(0, 120)}`)
        try {
          upstream = await callUpstream(altModel)
        } catch (e2) {
          return json({ error: 'Could not reach the AI provider', detail: String(e2) }, 502)
        }
      }
      if (upstream.status === 429) {
        const b = await upstream.text().catch(() => '')
        console.error(`[QUOTA] 429 stream user=${user.id} task=${task} :: ${b.slice(0, 240)}`)
        return json({ error: QUOTA_MSG, quota: true }, 429)
      }
      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '')
        console.error(`[AI_ERR] ${upstream.status} stream task=${task} :: ${detail.slice(0, 240)}`)
        return json({ error: 'AI request failed', status: upstream.status, detail }, 502)
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

    // Hard-timeout the upstream call and fall back to FAST_MODEL on timeout or
    // a non-quota error. The free NIM tier retires models (404/410) and queues
    // big ones indefinitely — without this, one dead model choice hangs the
    // worker past its limit and EVERY AI feature dies with a 546.
    const callModel = (model: string, timeoutMs: number) =>
      fetch(AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
        body: JSON.stringify({ ...payload, model }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    let res: Response
    try {
      res = await callModel(activeModel, 45_000)
      if (!res.ok && res.status !== 429 && activeModel !== FAST_MODEL) {
        console.warn(`[FALLBACK] ${activeModel} failed (status ${res.status}) -> ${FAST_MODEL}`)
        res = await callModel(FAST_MODEL, 60_000)
      }
    } catch (e) {
      if (activeModel === FAST_MODEL) {
        return json({ error: 'Could not reach the AI provider', detail: String(e) }, 502)
      }
      console.warn(`[FALLBACK] ${activeModel} timed out/unreachable -> ${FAST_MODEL} :: ${String(e).slice(0, 120)}`)
      try {
        res = await callModel(FAST_MODEL, 60_000)
      } catch (e2) {
        return json({ error: 'Could not reach the AI provider', detail: String(e2) }, 502)
      }
    }

    // ---- graceful quota handling ----
    if (res.status === 429) {
      const body = await res.text().catch(() => '')
      console.error(`[QUOTA] 429 user=${user.id} task=${task} model=${MODEL} :: ${body.slice(0, 240)}`)
      return json({ error: QUOTA_MSG, quota: true }, 429)
    }
    if (!res.ok) {
      const detail = await res.text()
      if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(detail)) {
        console.error(`[QUOTA] ${res.status} user=${user.id} task=${task} :: ${detail.slice(0, 240)}`)
        return json({ error: QUOTA_MSG, quota: true }, 429)
      }
      console.error(`[AI_ERR] ${res.status} task=${task} :: ${detail.slice(0, 240)}`)
      return json({ error: 'AI request failed', status: res.status, detail }, 502)
    }

    const data = await res.json() as any
    // OpenAI-compatible shape: choices[0].message.content. MiniMax is a reasoning
    // model, so strip any <think>…</think> chain-of-thought it may prepend.
    const text: string = String(data?.choices?.[0]?.message?.content ?? '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim()

    // store cache + count the (real) Gemini call
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
