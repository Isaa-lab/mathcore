-- material_topics provider/version grouping for multi-AI textbook refinement
-- Purpose:
-- 1) keep provider lineage at row level (provider/provider_model)
-- 2) separate each extraction run via topic_group_id
-- 3) support KnowledgePage "AI tabs + batch switch"

alter table public.material_topics
  add column if not exists provider text;

alter table public.material_topics
  add column if not exists provider_model text;

alter table public.material_topics
  add column if not exists topic_group_id uuid;

-- Backfill from v3 provenance columns when available
update public.material_topics
set provider = coalesce(provider, generated_by)
where provider is null;

update public.material_topics
set provider_model = coalesce(provider_model, ai_model)
where provider_model is null;

-- Helpful index for textbook+provider+batch filtering
create index if not exists material_topics_provider_group_idx
  on public.material_topics(material_id, provider, topic_group_id, created_at desc);
