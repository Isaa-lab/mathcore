-- material_topics 增加层级字段
-- 让 AI 抽出的知识点能形成 大标题(section) → 小标题(parent_name) → 叶子 的目录结构，
-- 并把"前置依赖"显式记录下来，便于在知识树/知识点页里画连接线。
-- 一次性 migration，跑过一次即可（用了 if not exists / 安全 alter）。

alter table public.material_topics
  add column if not exists section text;

alter table public.material_topics
  add column if not exists parent_name text;

alter table public.material_topics
  add column if not exists depth smallint;

alter table public.material_topics
  add column if not exists prerequisites jsonb default '[]'::jsonb;

-- 同 material 同 section 的查询是渲染层最常打的查询（按章节分组渲染时用）
create index if not exists material_topics_material_section_idx
  on public.material_topics(material_id, section);

-- 父节点查询：渲染层级时用 parent_name 反查同批次 topic
create index if not exists material_topics_parent_idx
  on public.material_topics(material_id, parent_name);
