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

// Fast, multilingual NVIDIA NIM model. Llama 4 Maverick is a MoE model: quick
// like a small model (~4-7s) but strong at Indic languages (Telugu/Hindi/Tamil…)
// so recipes come out correct + in good native script. Do NOT use a
// DeepSeek/MiniMax *reasoning* model (long hidden <think> chains take 2-3 min →
// 546 WORKER_RESOURCE_LIMIT), and NOT a dense 70B (too slow on free tier → 546).
const MODEL = Deno.env.get('NVIDIA_MODEL') ?? 'meta/llama-4-maverick-17b-128e-instruct'
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

    const { task = 'chat', input = '', messages = [] } =
      (await req.json().catch(() => ({}))) as { task?: string; input?: string; messages?: InMsg[] }

    // service-role client for cache + usage (bypasses RLS)
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const today = new Date().toISOString().slice(0, 10)

    // ---- per-user daily rate limit ----
    const { data: usageRow } = await admin
      .from('ai_usage').select('calls').eq('user_id', user.id).eq('used_on', today).maybeSingle()
    const used = (usageRow?.calls as number) ?? 0
    if (used >= DAILY_USER_CAP) {
      console.warn(`[RATELIMIT] user=${user.id} used=${used}/${DAILY_USER_CAP} task=${task}`)
      return json({ error: `You've reached today's AI limit of ${DAILY_USER_CAP} requests. It resets tomorrow. 🦁`, limited: true }, 429)
    }

    // ---- response cache (idempotent tasks only) ----
    const cacheable = CACHEABLE.includes(task) && !!input
    let cacheKey = ''
    if (cacheable) {
      cacheKey = await sha256(`${MODEL}::${PROMPT_VERSION}::${task}::${input}`)
      const { data: hit } = await admin.from('ai_cache').select('response').eq('cache_key', cacheKey).maybeSingle()
      if (hit?.response) {
        console.log(`[CACHE_HIT] task=${task} user=${user.id}`)
        return json({ text: String(hit.response), task, cached: true })
      }
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

    const payload = {
      model: MODEL,
      messages: chatMessages,
      temperature: task === 'mission' ? 0.9 : 0.7,
      max_tokens:
        task === 'startup' || task === 'career' || task === 'learnpath' ? 2048
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

    let res: Response
    try {
      res = await fetch(AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
        body: JSON.stringify(payload),
      })
    } catch (e) {
      return json({ error: 'Could not reach the AI provider', detail: String(e) }, 502)
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
