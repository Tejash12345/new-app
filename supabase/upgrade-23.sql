-- FocusLion upgrade 23: AI response cache (Gemini usage optimization)
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- The lion-ai Edge Function caches idempotent AI responses (summaries,
-- hashtags, captions, explanations, learning paths, career/startup plans)
-- keyed by a hash of the request, so identical prompts don't re-spend Gemini
-- quota. Accessed ONLY by the Edge Function via the service role; RLS is on
-- with no policies so it's invisible to normal clients.

create table if not exists public.ai_cache (
  cache_key text primary key,
  task text not null,
  response text not null,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_cache enable row level security;
-- intentionally no policies: only the service role (Edge Function) touches this.

create index if not exists ai_cache_created_idx on public.ai_cache (created_at);
