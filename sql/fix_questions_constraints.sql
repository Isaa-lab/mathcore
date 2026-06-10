-- ─────────────────────────────────────────────────────────────────────────
-- fix_questions_constraints.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 修复 questions 表上两个被改坏的 CHECK 约束。
--
-- 现象（在脚本 scripts/probe-difficulty-check.js 里实测）：
--   · questions_difficulty_check 实际只允许 NULL，连 'easy'/'medium'/'hard' 都拒收
--   · questions_type_check 只允许 单选题/判断题/填空题，拒收 简答题
--
-- 后果：
--   · scripts/upload-textbook.js 不得不把 difficulty 写 null、把"简答题"降级成"填空题"
--   · 小测页因此没法按难度刷题，简答题也没法出
--
-- 修完之后：
--   · 难度可写 'easy'/'medium'/'hard'，前端按难度过滤生效
--   · 题型新增"简答题"
-- ─────────────────────────────────────────────────────────────────────────

-- 1) 先清洗历史脏值（否则 add constraint 会直接失败）
-- difficulty 只保留 easy/medium/hard，其余全部先置空
update public.questions
set difficulty = null
where difficulty is not null
  and difficulty not in ('easy','medium','hard');

-- type 只保留四种合法值；常见旧值做一次归一化
update public.questions
set type = case
  when type in ('单选', '选择题') then '单选题'
  when type in ('判断', '判断对错', '是非题') then '判断题'
  when type in ('填空') then '填空题'
  when type in ('简答', '解答题', '问答题') then '简答题'
  else type
end
where type is not null;

-- 再把仍不合法的 type 兜底成“填空题”
update public.questions
set type = '填空题'
where type is null
   or type not in ('单选题','判断题','填空题','简答题');

-- 2) 重置 difficulty 检查
alter table public.questions drop constraint if exists questions_difficulty_check;
alter table public.questions add constraint questions_difficulty_check
  check (difficulty is null or difficulty in ('easy','medium','hard'));

-- 3) 重置 type 检查（加入 简答题）
alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check
  check (type in ('单选题','判断题','填空题','简答题'));

-- 4) 把脚本时降级写入的题目还原难度（从 ai_meta.difficulty 抄回 difficulty 列）
update public.questions
set difficulty = ai_meta->>'difficulty'
where difficulty is null
  and ai_meta is not null
  and ai_meta->>'difficulty' in ('easy','medium','hard');

-- 5) 把降级时的 简答题 → 填空题 还原回去（脚本里把原 type 备份在 ai_meta.original_type）
update public.questions
set type = '简答题'
where ai_meta is not null
  and ai_meta->>'original_type' = '简答题';

notify pgrst, 'reload schema';
