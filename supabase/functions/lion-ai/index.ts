// FocusLion — "Lion AI Assistant" secure Gemini proxy (Supabase Edge Function)
//
// The Gemini API key NEVER ships in the app. It lives only in this function's
// environment as the GEMINI_API_KEY secret. The browser/app calls this function
// (with the user's Supabase JWT); we validate the user, then call Gemini.
//
// Free-tier hardening:
//   • Per-user daily rate limit (AI_DAILY_USER_CAP, default 30).
//   • Response cache for idempotent tasks — identical prompts skip Gemini.
//   • Graceful 429 / RESOURCE_EXHAUSTED handling + quota logging.
//   • Usage counted server-side (only real Gemini calls, not cache hits).
//   • Daily briefings & missions are cached per-day client-side already.
//
// Deploy:
//   supabase functions deploy lion-ai
//   supabase secrets set GEMINI_API_KEY=AIza... GEMINI_MODEL=gemini-2.5-flash
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const DAILY_USER_CAP = Number(Deno.env.get('AI_DAILY_USER_CAP') ?? '30')
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// idempotent tasks worth caching (same input -> same answer). Chat/mission/
// briefing are excluded: chat is conversational, mission/briefing are
// personalized and already cached per-day on the client.
const CACHEABLE = ['summarize', 'hashtags', 'caption', 'explain', 'startup', 'career', 'learnpath']
const JSON_TASKS = ['mission', 'learnpath', 'career', 'startup']

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

const QUOTA_MSG = "Lion AI has hit today's Gemini quota — it resets daily. 🦁 Coach Leo will keep helping in the meantime."

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
        `{"summary": string (one sentence), "steps": [{"title": string, "detail": string}]} ` +
        `with 8-12 ordered steps from basics to advanced, each detail one actionable sentence.`
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
    if (!GEMINI_API_KEY) return json({ error: 'Server is missing GEMINI_API_KEY.' }, 500)

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
      cacheKey = await sha256(`${MODEL}::${task}::${input}`)
      const { data: hit } = await admin.from('ai_cache').select('response').eq('cache_key', cacheKey).maybeSingle()
      if (hit?.response) {
        console.log(`[CACHE_HIT] task=${task} user=${user.id}`)
        return json({ text: String(hit.response), task, cached: true })
      }
    }

    // ---- build Gemini request ----
    const history = Array.isArray(messages) ? messages.slice(-16) : []
    const contents = history.length
      ? history.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content ?? '') }],
        }))
      : [{ role: 'user', parts: [{ text: String(input ?? '') }] }]

    const payload = {
      systemInstruction: { parts: [{ text: systemFor(task) }] },
      contents,
      generationConfig: {
        temperature: task === 'mission' ? 0.9 : 0.7,
        maxOutputTokens:
          task === 'startup' || task === 'career' || task === 'learnpath' ? 2048
          : task === 'mission' ? 1024
          : task === 'chat' ? 1024
          : 512,
        ...(JSON_TASKS.includes(task) ? { responseMimeType: 'application/json' } : {}),
      },
    }

    let res: Response
    try {
      res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(payload),
      })
    } catch (e) {
      return json({ error: 'Could not reach Gemini', detail: String(e) }, 502)
    }

    // ---- graceful quota handling ----
    if (res.status === 429) {
      const body = await res.text().catch(() => '')
      console.error(`[QUOTA] 429 user=${user.id} task=${task} model=${MODEL} :: ${body.slice(0, 240)}`)
      return json({ error: QUOTA_MSG, quota: true }, 429)
    }
    if (!res.ok) {
      const detail = await res.text()
      if (/RESOURCE_EXHAUSTED|quota/i.test(detail)) {
        console.error(`[QUOTA] ${res.status} user=${user.id} task=${task} :: ${detail.slice(0, 240)}`)
        return json({ error: QUOTA_MSG, quota: true }, 429)
      }
      console.error(`[GEMINI_ERR] ${res.status} task=${task} :: ${detail.slice(0, 240)}`)
      return json({ error: 'Gemini request failed', status: res.status, detail }, 502)
    }

    const data = await res.json() as any
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''

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
