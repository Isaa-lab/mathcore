-- ─────────────────────────────────────────────────────────────────────────
-- concept_mastery_v1.sql
-- 目标：题目提交后按 question_concepts 回写学生概念掌握度
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.concept_mastery (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  status text not null default 'learning'
    check (status in ('learning', 'weak', 'mastered')),
  correct_count int not null default 0,
  wrong_count int not null default 0,
  attempt_count int not null default 0,
  updated_at timestamptz default now(),
  unique(user_id, concept_id)
);

create index if not exists concept_mastery_user_idx on public.concept_mastery(user_id);
create index if not exists concept_mastery_concept_idx on public.concept_mastery(concept_id);
create index if not exists concept_mastery_status_idx on public.concept_mastery(status);

alter table public.concept_mastery enable row level security;

drop policy if exists "Users manage own concept mastery" on public.concept_mastery;
drop policy if exists "Teachers read concept mastery" on public.concept_mastery;

create policy "Users manage own concept mastery"
  on public.concept_mastery for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Teachers read concept mastery"
  on public.concept_mastery for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

notify pgrst, 'reload schema';
