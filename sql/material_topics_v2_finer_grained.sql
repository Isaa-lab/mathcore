-- ─────────────────────────────────────────────────────────────────────────
-- material_topics_v2 :: 细粒度知识点 + 知识树前置依赖 + 题目元数据
-- ─────────────────────────────────────────────────────────────────────────
-- 这份脚本是"教材沙盒细化"功能的后端补丁。仅追加列，不删除任何旧数据。
-- 老前端在缺少这些列时会自动 fallback（App.js 里有 isMissingColumn 退化逻辑），
-- 所以可以安全在生产 Supabase 里直接跑。
--
-- 跑完之后：
--   · 知识树能根据 prerequisites 画边（DAG）
--   · 节点能根据 kind/depth 上色（定义=蓝、定理=紫、方法=绿、易错点=红）
--   · 题库能按 difficulty 做"刻意练习"（先 easy 后 medium 后 hard）
--   · 错题本能根据 knowledge_points 反查"最弱知识点"
-- ─────────────────────────────────────────────────────────────────────────

-- 1) material_topics 加细化字段
alter table public.material_topics
  add column if not exists kind text
    check (kind in ('definition','theorem','method','formula','example','pitfall')),
  add column if not exists depth int
    check (depth between 1 and 3),
  add column if not exists prerequisites text[],
  add column if not exists definition_anchor text;

create index if not exists material_topics_kind_idx on public.material_topics(kind);
create index if not exists material_topics_depth_idx on public.material_topics(depth);

-- 2) questions 加细化字段
alter table public.questions
  add column if not exists difficulty text
    check (difficulty in ('easy','medium','hard')),
  add column if not exists knowledge_points text[];

create index if not exists questions_difficulty_idx on public.questions(difficulty);
-- knowledge_points 是数组，用 GIN 索引才高效
create index if not exists questions_knowledge_points_gin on public.questions using gin (knowledge_points);

-- 3) 视图：把 topic 的依赖关系展开成"边表"，方便前端拉边
create or replace view public.material_topic_edges as
select
  t.id           as child_id,
  t.material_id  as material_id,
  t.name         as child_name,
  parent.id      as parent_id,
  parent.name    as parent_name
from public.material_topics t
cross join lateral unnest(coalesce(t.prerequisites, array[]::text[])) as prereq_name
join public.material_topics parent
  on parent.material_id = t.material_id
 and parent.name = prereq_name;

comment on view public.material_topic_edges is
  '知识树边表：从 child(t.id) 指向 parent(parent.id)，仅当两端属于同一 material';

-- 4) 触发 Postgres 重载 schema cache（PostgREST 要这步才能识别新列）
notify pgrst, 'reload schema';
