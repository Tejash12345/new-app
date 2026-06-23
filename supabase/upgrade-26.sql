-- FocusLion upgrade 26: reference links on AI Learning Paths
-- Paste into the Supabase SQL Editor and Run (safe to run multiple times).
--
-- learning_paths.resources: the AI now returns a set of reference links
-- (official docs, courses, videos…) alongside the roadmap steps, so the
-- learner can open real resources for the topic. Stored as jsonb:
--   [{ "title": string, "url": string, "kind": string }]

alter table public.learning_paths
  add column if not exists resources jsonb not null default '[]'::jsonb;
