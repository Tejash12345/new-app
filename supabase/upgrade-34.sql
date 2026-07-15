-- upgrade 34: per-conversation animated chat background (Instagram-style, both
-- friends see the same one). Reuses the dm_pairs per-pair settings table.
alter table public.dm_pairs add column if not exists chat_bg text;
