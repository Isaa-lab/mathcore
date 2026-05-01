-- ─────────────────────────────────────────────────────────────────────────
-- ai_provenance_v3 :: 给每条 AI 生成的内容打"哪个 AI 出的"标签
-- ─────────────────────────────────────────────────────────────────────────
-- 这次升级配套前端的"切换 AI 时界面变色 + 题库按 AI 来源过滤 + 双 AI 对比"。
-- 仅追加列，不破坏老数据；前端有渐进降级，跑不跑都能用，跑了功能更全。
--
-- 跑完之后：
--   · 每道题、每个知识点都能看出是哪个 AI 在哪天生成的
--   · 题库 / 知识树能按"只看 X AI 的"做过滤
--   · "双 AI 对比"模式跑两个 AI 同时出题，结果一起入库可直接对比
-- ─────────────────────────────────────────────────────────────────────────

-- 1) questions 加来源 + 元数据
alter table public.questions
  add column if not exists generated_by text,        -- 'gemini' / 'deepseek' / 'kimi' / 'groq' / 'anthropic' / 'custom' / 'manual'
  add column if not exists ai_model    text,         -- 具体模型名，如 'gemini-2.0-flash'
  add column if not exists ai_meta     jsonb;        -- 留空 / chunk index / refine flag 等可选元信息

create index if not exists questions_generated_by_idx on public.questions(generated_by);

-- 2) material_topics 加来源
alter table public.material_topics
  add column if not exists generated_by text,
  add column if not exists ai_model    text,
  add column if not exists ai_meta     jsonb;

create index if not exists material_topics_generated_by_idx on public.material_topics(generated_by);

-- 3) 视图：方便前端拉"按教材 × 按 AI"分组的统计
create or replace view public.material_ai_breakdown as
select
  m.id                  as material_id,
  m.title               as material_title,
  coalesce(q.generated_by, t.generated_by, 'unknown') as ai_provider,
  coalesce(qcount, 0)   as question_count,
  coalesce(tcount, 0)   as topic_count
from public.materials m
left join (
  select material_id, generated_by, count(*) as qcount
  from public.questions
  where material_id is not null
  group by material_id, generated_by
) q on q.material_id = m.id
full outer join (
  select material_id, generated_by, count(*) as tcount
  from public.material_topics
  group by material_id, generated_by
) t on t.material_id = m.id and t.generated_by = q.generated_by;

comment on view public.material_ai_breakdown is
  '每本教材 × 每个 AI 来源的产出统计：用于"双 AI 对比"页面快速看总量';

-- 4) 让 PostgREST 重载 schema cache（否则前端 API 读不到新列）
notify pgrst, 'reload schema';
