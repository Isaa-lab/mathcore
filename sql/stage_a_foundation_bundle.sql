-- ─────────────────────────────────────────────────────────────────────────
-- stage_a_foundation_bundle.sql
-- 阶段 A 一键地基：courses / concepts / concept_edges / question_concepts / concept_mastery
-- + 修复 questions 的 difficulty/type 约束（含历史脏值清洗）
-- 幂等：可重复执行
-- ─────────────────────────────────────────────────────────────────────────

-- 0) 基础课程目录
create table if not exists public.courses (
  id uuid default gen_random_uuid() primary key,
  code text not null unique,
  name text not null,
  major text not null default '数学与应用数学',
  stage text not null default 'undergraduate'
    check (stage in ('undergraduate', 'graduate')),
  semester int,
  kind text not null default 'required'
    check (kind in ('required', 'elective')),
  description text,
  created_at timestamptz default now()
);
create index if not exists courses_kind_idx on public.courses(kind);
create index if not exists courses_semester_idx on public.courses(semester);

-- 1) 课程级概念表
create table if not exists public.concepts (
  id uuid default gen_random_uuid() primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  summary text,
  kind text,
  depth int check (depth between 1 and 3),
  source_material_count int not null default 0,
  created_at timestamptz default now(),
  unique(course_id, name)
);
create index if not exists concepts_course_idx on public.concepts(course_id);
create index if not exists concepts_name_idx on public.concepts(name);

-- 2) 概念图边
create table if not exists public.concept_edges (
  id uuid default gen_random_uuid() primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  from_concept_id uuid not null references public.concepts(id) on delete cascade,
  to_concept_id uuid not null references public.concepts(id) on delete cascade,
  relation text not null default 'prerequisite'
    check (relation in ('prerequisite', 'related', 'part_of')),
  weight numeric(4,3) not null default 1.0 check (weight > 0 and weight <= 1),
  source_material_id uuid references public.materials(id) on delete set null,
  created_at timestamptz default now(),
  unique(from_concept_id, to_concept_id, relation)
);
create index if not exists concept_edges_course_idx on public.concept_edges(course_id);
create index if not exists concept_edges_from_idx on public.concept_edges(from_concept_id);
create index if not exists concept_edges_to_idx on public.concept_edges(to_concept_id);

-- 3) 题目↔概念映射
create table if not exists public.question_concepts (
  id uuid default gen_random_uuid() primary key,
  question_id uuid not null references public.questions(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  role text not null default 'secondary'
    check (role in ('primary', 'secondary', 'supporting')),
  weight numeric(4,3) not null default 0.5 check (weight > 0 and weight <= 1),
  confidence int not null default 80 check (confidence between 0 and 100),
  source_material_id uuid references public.materials(id) on delete set null,
  created_at timestamptz default now(),
  unique(question_id, concept_id)
);
create index if not exists question_concepts_qid_idx on public.question_concepts(question_id);
create index if not exists question_concepts_cid_idx on public.question_concepts(concept_id);
create index if not exists question_concepts_material_idx on public.question_concepts(source_material_id);

-- 4) material_topics 回挂 concept_id
alter table public.material_topics
  add column if not exists concept_id uuid references public.concepts(id) on delete set null;
create index if not exists material_topics_concept_idx on public.material_topics(concept_id);

-- 5) 概念掌握度
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

-- 6) question 约束修复（先清洗历史脏值）
update public.questions
set difficulty = null
where difficulty is not null
  and difficulty not in ('easy','medium','hard');

update public.questions
set type = case
  when type in ('单选', '选择题') then '单选题'
  when type in ('判断', '判断对错', '是非题') then '判断题'
  when type in ('填空') then '填空题'
  when type in ('简答', '解答题', '问答题') then '简答题'
  else type
end
where type is not null;

update public.questions
set type = '填空题'
where type is null
   or type not in ('单选题','判断题','填空题','简答题');

alter table public.questions drop constraint if exists questions_difficulty_check;
alter table public.questions add constraint questions_difficulty_check
  check (difficulty is null or difficulty in ('easy','medium','hard'));

alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check
  check (type in ('单选题','判断题','填空题','简答题'));

update public.questions
set difficulty = ai_meta->>'difficulty'
where difficulty is null
  and ai_meta is not null
  and ai_meta->>'difficulty' in ('easy','medium','hard');

update public.questions
set type = '简答题'
where ai_meta is not null
  and ai_meta->>'original_type' = '简答题';

-- 7) 视图
create or replace view public.question_concept_labels as
select
  qc.question_id,
  q.material_id,
  qc.concept_id,
  c.name as concept_name,
  qc.role,
  qc.weight,
  qc.confidence
from public.question_concepts qc
join public.questions q on q.id = qc.question_id
join public.concepts c on c.id = qc.concept_id;

-- 8) RLS（幂等重建）
alter table public.courses enable row level security;
alter table public.concepts enable row level security;
alter table public.concept_edges enable row level security;
alter table public.question_concepts enable row level security;
alter table public.concept_mastery enable row level security;

drop policy if exists "Users read courses" on public.courses;
drop policy if exists "Users read concepts" on public.concepts;
drop policy if exists "Users read concept edges" on public.concept_edges;
drop policy if exists "Users read question concepts" on public.question_concepts;
drop policy if exists "Teachers manage courses" on public.courses;
drop policy if exists "Teachers manage concepts" on public.concepts;
drop policy if exists "Teachers manage concept edges" on public.concept_edges;
drop policy if exists "Teachers manage question concepts" on public.question_concepts;
drop policy if exists "Users manage own concept mastery" on public.concept_mastery;
drop policy if exists "Teachers read concept mastery" on public.concept_mastery;

create policy "Users read courses" on public.courses for select using (auth.uid() is not null);
create policy "Users read concepts" on public.concepts for select using (auth.uid() is not null);
create policy "Users read concept edges" on public.concept_edges for select using (auth.uid() is not null);
create policy "Users read question concepts" on public.question_concepts for select using (auth.uid() is not null);

create policy "Teachers manage courses"
  on public.courses for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

create policy "Teachers manage concepts"
  on public.concepts for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

create policy "Teachers manage concept edges"
  on public.concept_edges for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

create policy "Teachers manage question concepts"
  on public.question_concepts for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

create policy "Users manage own concept mastery"
  on public.concept_mastery for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Teachers read concept mastery"
  on public.concept_mastery for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

notify pgrst, 'reload schema';
