-- material_topics 增加 AI 来源字段
-- 让"不同 AI 抽到的不同知识点结构"在 KnowledgePage 里能按 provider 分组展示。
-- 这是一次性 migration，跑过一次即可（用了 if not exists / 安全 alter）。

alter table public.material_topics
  add column if not exists provider text default 'unknown';

alter table public.material_topics
  add column if not exists provider_model text;

-- 一次抽取批次的标识符；同一次 processMaterialWithAI 调用产生的所有 topic 共享一个 group
alter table public.material_topics
  add column if not exists topic_group_id uuid;

create index if not exists material_topics_provider_idx
  on public.material_topics(material_id, provider);

create index if not exists material_topics_group_idx
  on public.material_topics(topic_group_id);

-- 历史数据兜底：把空 provider 标成 'legacy' 而不是 'unknown'，方便以后筛选历史
update public.material_topics
  set provider = 'legacy'
  where provider is null or provider = '';
