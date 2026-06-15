// FocusLion — "Lion AI Assistant" secure Gemini proxy (Supabase Edge Function)
//
// The Gemini API key NEVER ships in the app. It lives only in this function's
// environment as the GEMINI_API_KEY secret. The browser/app calls this function
// (with the user's Supabase JWT); we validate the user, then call Gemini.
//
// Deploy:
//   supabase functions deploy lion-ai
//   supabase secrets set GEMINI_API_KEY=your_key   GEMINI_MODEL=gemini-2.5-flash
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

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

// ---- the lion persona, tuned per task ----
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
    case 'startup':
      return `${BASE_PERSONA} Suggest 3 concrete startup ideas based on the user's interests. ` +
        `For each: a bold name, one-line pitch, and the first step to validate it.`
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

    // ---- authenticate the caller via their Supabase JWT ----
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { task = 'chat', input = '', messages = [] } =
      (await req.json().catch(() => ({}))) as { task?: string; input?: string; messages?: InMsg[] }

    // ---- build Gemini "contents" ----
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
          task === 'startup' || task === 'career' || task === 'learnpath' ? 1800
          : task === 'chat' ? 1024
          : 512,
      },
    }

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const detail = await res.text()
      return json({ error: 'Gemini request failed', status: res.status, detail }, 502)
    }

    const data = await res.json() as any
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''

    return json({ text: text.trim(), task })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})
