-- ─────────────────────────────────────────────────────────────────────────
-- assessment_cycle_v1.sql
-- 阶段 C：自适应测评循环的数据层（会话 + 作答项）
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.assessment_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  mode text not null default 'review'
    check (mode in ('review', 'interview')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed')),
  reported_learned_courses text[] default '{}',
  goal text,
  round int not null default 1,
  mastery_threshold int not null default 80 check (mastery_threshold between 50 and 100),
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.assessment_sessions
  add column if not exists completed_at timestamptz;

create index if not exists assessment_sessions_user_idx on public.assessment_sessions(user_id);
create index if not exists assessment_sessions_course_idx on public.assessment_sessions(course_id);
create index if not exists assessment_sessions_status_idx on public.assessment_sessions(status);

create table if not exists public.assessment_items (
  id uuid default gen_random_uuid() primary key,
  session_id uuid not null references public.assessment_sessions(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  question_text text,
  source text not null default 'bank'
    check (source in ('bank', 'ai_generated')),
  answered bool not null default false,
  correct bool,
  user_answer text,
  correct_answer text,
  concept_ids uuid[] default '{}',
  weakness_snapshot jsonb,
  ai_feedback text,
  created_at timestamptz default now(),
  answered_at timestamptz
);

create index if not exists assessment_items_session_idx on public.assessment_items(session_id);
create index if not exists assessment_items_question_idx on public.assessment_items(question_id);
create index if not exists assessment_items_answered_idx on public.assessment_items(answered);

alter table public.assessment_sessions enable row level security;
alter table public.assessment_items enable row level security;

drop policy if exists "Users manage own assessment sessions" on public.assessment_sessions;
drop policy if exists "Teachers read assessment sessions" on public.assessment_sessions;
drop policy if exists "Users manage own assessment items" on public.assessment_items;
drop policy if exists "Teachers read assessment items" on public.assessment_items;

create policy "Users manage own assessment sessions"
  on public.assessment_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Teachers read assessment sessions"
  on public.assessment_sessions for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

create policy "Users manage own assessment items"
  on public.assessment_items for all
  using (
    exists (
      select 1 from public.assessment_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.assessment_sessions s
      where s.id = session_id and s.user_id = auth.uid()
    )
  );

create policy "Teachers read assessment items"
  on public.assessment_items for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

notify pgrst, 'reload schema';
