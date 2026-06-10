-- Question bank source/owner fields + per-user attempts.
-- Safe to run multiple times in Supabase SQL editor.

alter table public.questions
  add column if not exists source text,
  add column if not exists owner text,
  add column if not exists answer_status text default 'generated';

update public.questions
set source = coalesce(
  source,
  case
    when generated_by = 'upload_solver' then 'upload'
    when generated_by in ('server','groq','gemini','deepseek','kimi','anthropic','custom') then 'ai'
    else 'textbook'
  end
)
where source is null;

update public.questions
set owner = coalesce(owner, 'public')
where owner is null;

update public.questions
set answer_status = coalesce(answer_status, 'generated')
where answer_status is null;

alter table public.questions drop constraint if exists questions_source_check;
alter table public.questions add constraint questions_source_check
  check (source is null or source in ('textbook','ai','upload'));

alter table public.questions drop constraint if exists questions_owner_check;
alter table public.questions add constraint questions_owner_check
  check (owner is null or owner = 'public' or owner ~ '^[0-9a-fA-F-]{20,}$');

alter table public.questions drop constraint if exists questions_answer_status_check;
alter table public.questions add constraint questions_answer_status_check
  check (answer_status is null or answer_status in ('generated','pending'));

-- Keep legacy English difficulty values but allow the UI labels too.
alter table public.questions drop constraint if exists questions_difficulty_check;
alter table public.questions add constraint questions_difficulty_check
  check (difficulty is null or difficulty in ('easy','medium','hard','基础','进阶','挑战'));

create index if not exists questions_source_idx on public.questions(source);
create index if not exists questions_owner_idx on public.questions(owner);
create index if not exists questions_chapter_idx on public.questions(chapter);
create index if not exists questions_created_at_idx on public.questions(created_at desc);

create table if not exists public.attempts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  result text not null check (result in ('correct','wrong')),
  is_starred boolean not null default false,
  attempted_at timestamptz default now(),
  unique(user_id, question_id)
);

create index if not exists attempts_user_idx on public.attempts(user_id);
create index if not exists attempts_question_idx on public.attempts(question_id);
create index if not exists attempts_result_idx on public.attempts(result);
create index if not exists attempts_starred_idx on public.attempts(is_starred);

alter table public.attempts enable row level security;

drop policy if exists "Users manage own attempts" on public.attempts;
create policy "Users manage own attempts"
  on public.attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Teachers read attempts" on public.attempts;
create policy "Teachers read attempts"
  on public.attempts for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'teacher'
    )
  );
