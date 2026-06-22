-- 批改得分：给 paper_items 增加分数列。
-- score_pct：0~100 的得分百分比（AI 估分，或由老师红笔/题目分数换算）。
-- max_score：本题满分（题目标注、用户补充、或老师红笔；没有则为 null，此时只展示百分比）。
-- score_source：分数来源——'ai'（AI 估分）/ 'teacher'（红笔批改）/ 'manual'（用户手填）。
alter table public.paper_items add column if not exists score_pct numeric;
alter table public.paper_items add column if not exists max_score numeric;
alter table public.paper_items add column if not exists score_source text;
-- teacher_comment：老师红笔批注原文（如果图上有红笔批改）。
alter table public.paper_items add column if not exists teacher_comment text;
