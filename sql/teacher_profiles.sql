-- 按命题老师的个性化档案（Stage 2/3）：每个用户、每个科目、每位老师一条。
-- grading_style：从"AI 判分 vs 老师真实分 + 红笔批注"学到的评分风格/严度（注入批改提示词）。
-- question_style：从老师出过的题学到的出题风格（用于生成同风格模拟题）。
-- sample_count：已学习过几份该老师的卷子（越多越准）。
create table if not exists public.teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  subject text not null,
  teacher_name text not null,
  grading_style text default '',
  question_style text default '',
  sample_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 每个用户在每个"科目+老师"下只一条
create unique index if not exists idx_teacher_profile_uniq
  on public.teacher_profiles(user_id, subject, teacher_name);

-- RLS：和其它表一致，仅本人可读写自己的档案。
alter table public.teacher_profiles enable row level security;
do $$ begin
  create policy teacher_profiles_owner on public.teacher_profiles
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
