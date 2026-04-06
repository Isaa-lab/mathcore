-- Learning MVP schema extension
-- Covers: parse jobs, content chunks, topic cards, mastery, wrong-question regeneration.

-- 1) Parse job table
create table if not exists public.material_parse_jobs (
  id uuid default gen_random_uuid() primary key,
  material_id uuid not null references public.materials(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'success', 'failed')),
  source_type text default 'auto' check (source_type in ('auto', 'teacher_approve', 'manual_retry')),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create index if not exists material_parse_jobs_material_idx on public.material_parse_jobs(material_id);
create index if not exists material_parse_jobs_status_idx on public.material_parse_jobs(status);

-- 2) Content chunks used for material chat
create table if not exists public.material_chunks (
  id uuid default gen_random_uuid() primary key,
  material_id uuid not null references public.materials(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  token_estimate int,
  created_at timestamptz default now(),
  unique(material_id, chunk_index)
);

create index if not exists material_chunks_material_idx on public.material_chunks(material_id);

-- 3) AI extracted topics linked to material
create table if not exists public.material_topics (
  id uuid default gen_random_uuid() primary key,
  material_id uuid not null references public.materials(id) on delete cascade,
  name text not null,
  summary text,
  chapter text,
  viz_key text,
  example_question text,
  solution_hint text,
  created_at timestamptz default now()
);

create index if not exists material_topics_material_idx on public.material_topics(material_id);
create index if not exists material_topics_name_idx on public.material_topics(name);

-- 4) Topic mastery tracking by student
create table if not exists public.topic_mastery (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_id uuid not null references public.material_topics(id) on delete cascade,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  correct_count int not null default 0,
  wrong_count int not null default 0,
  updated_at timestamptz default now(),
  unique(user_id, topic_id)
);

create index if not exists topic_mastery_user_idx on public.topic_mastery(user_id);
create index if not exists topic_mastery_topic_idx on public.topic_mastery(topic_id);

-- 5) Wrong-question drill log and AI regeneration
create table if not exists public.wrong_drill_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  chapter text,
  question text not null,
  correct_answer text,
  user_answer text,
  explanation text,
  created_at timestamptz default now()
);

create index if not exists wrong_drill_logs_user_idx on public.wrong_drill_logs(user_id);
create index if not exists wrong_drill_logs_created_idx on public.wrong_drill_logs(created_at desc);

-- 6) RLS enable
alter table public.material_parse_jobs enable row level security;
alter table public.material_chunks enable row level security;
alter table public.material_topics enable row level security;
alter table public.topic_mastery enable row level security;
alter table public.wrong_drill_logs enable row level security;

-- 7) Drop old policies if exist
drop policy if exists "Teachers read parse jobs" on public.material_parse_jobs;
drop policy if exists "Uploader read own parse jobs" on public.material_parse_jobs;
drop policy if exists "Teachers manage parse jobs" on public.material_parse_jobs;

drop policy if exists "Users read chunks by material visibility" on public.material_chunks;
drop policy if exists "Teachers manage chunks" on public.material_chunks;

drop policy if exists "Users read topics by material visibility" on public.material_topics;
drop policy if exists "Teachers manage topics" on public.material_topics;

drop policy if exists "Users manage own topic mastery" on public.topic_mastery;
drop policy if exists "Teachers read class topic mastery" on public.topic_mastery;

drop policy if exists "Users manage own wrong drill logs" on public.wrong_drill_logs;
drop policy if exists "Teachers read wrong drill logs" on public.wrong_drill_logs;

-- 8) Parse job policies
create policy "Teachers read parse jobs"
  on public.material_parse_jobs for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

create policy "Uploader read own parse jobs"
  on public.material_parse_jobs for select
  using (
    exists (
      select 1 from public.materials m
      where m.id = material_id and m.uploaded_by = auth.uid()
    )
  );

create policy "Teachers manage parse jobs"
  on public.material_parse_jobs for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

-- 9) Chunk policies
create policy "Users read chunks by material visibility"
  on public.material_chunks for select
  using (
    exists (
      select 1 from public.materials m
      where m.id = material_id
        and (m.status = 'approved' or m.uploaded_by = auth.uid())
    )
  );

create policy "Teachers manage chunks"
  on public.material_chunks for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

-- 10) Topic policies
create policy "Users read topics by material visibility"
  on public.material_topics for select
  using (
    exists (
      select 1 from public.materials m
      where m.id = material_id
        and (m.status = 'approved' or m.uploaded_by = auth.uid())
    )
  );

create policy "Teachers manage topics"
  on public.material_topics for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

-- 11) Mastery policies
create policy "Users manage own topic mastery"
  on public.topic_mastery for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Teachers read class topic mastery"
  on public.topic_mastery for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

-- 12) Wrong log policies
create policy "Users manage own wrong drill logs"
  on public.wrong_drill_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Teachers read wrong drill logs"
  on public.wrong_drill_logs for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

