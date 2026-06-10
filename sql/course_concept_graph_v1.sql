-- ─────────────────────────────────────────────────────────────────────────
-- course_concept_graph_v1.sql
-- 目标：把“名字字符串关联”升级为“ID 关联”的课程级知识网络
-- 适用：数学 / 应用数学，先以线性代数为第一门课（Leon 9th）
-- ─────────────────────────────────────────────────────────────────────────

-- 1) 课程目录
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

-- 2) 课程级统一概念卡片（跨教材唯一）
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

-- 3) 概念关系边（真正图结构）
create table if not exists public.concept_edges (
  id uuid default gen_random_uuid() primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  from_concept_id uuid not null references public.concepts(id) on delete cascade,
  to_concept_id uuid not null references public.concepts(id) on delete cascade,
  relation text not null default 'prerequisite'
    check (relation in ('prerequisite', 'related', 'part_of')),
  weight numeric(4,3) not null default 1.0
    check (weight > 0 and weight <= 1),
  source_material_id uuid references public.materials(id) on delete set null,
  created_at timestamptz default now(),
  unique(from_concept_id, to_concept_id, relation)
);

create index if not exists concept_edges_course_idx on public.concept_edges(course_id);
create index if not exists concept_edges_from_idx on public.concept_edges(from_concept_id);
create index if not exists concept_edges_to_idx on public.concept_edges(to_concept_id);

-- 4) 题目 <-> 概念（替代 questions.knowledge_points 文本数组）
create table if not exists public.question_concepts (
  id uuid default gen_random_uuid() primary key,
  question_id uuid not null references public.questions(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  role text not null default 'secondary'
    check (role in ('primary', 'secondary', 'supporting')),
  weight numeric(4,3) not null default 0.5
    check (weight > 0 and weight <= 1),
  confidence int not null default 80
    check (confidence between 0 and 100),
  source_material_id uuid references public.materials(id) on delete set null,
  created_at timestamptz default now(),
  unique(question_id, concept_id)
);

create index if not exists question_concepts_qid_idx on public.question_concepts(question_id);
create index if not exists question_concepts_cid_idx on public.question_concepts(concept_id);
create index if not exists question_concepts_material_idx on public.question_concepts(source_material_id);

-- 5) material_topics 回挂 concept_id（每本教材是“讲法”，课程概念是“本体”）
alter table public.material_topics
  add column if not exists concept_id uuid references public.concepts(id) on delete set null;

create index if not exists material_topics_concept_idx on public.material_topics(concept_id);

-- 6) 视图：题目标签展开，前端直接读
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

comment on view public.question_concept_labels is
  '题目-概念标签展开视图：用于展示“本题考了哪些知识卡片”';

-- 7) RLS
alter table public.courses enable row level security;
alter table public.concepts enable row level security;
alter table public.concept_edges enable row level security;
alter table public.question_concepts enable row level security;

drop policy if exists "Users read courses" on public.courses;
drop policy if exists "Users read concepts" on public.concepts;
drop policy if exists "Users read concept edges" on public.concept_edges;
drop policy if exists "Users read question concepts" on public.question_concepts;
drop policy if exists "Teachers manage courses" on public.courses;
drop policy if exists "Teachers manage concepts" on public.concepts;
drop policy if exists "Teachers manage concept edges" on public.concept_edges;
drop policy if exists "Teachers manage question concepts" on public.question_concepts;

create policy "Users read courses"
  on public.courses for select
  using (auth.uid() is not null);

create policy "Users read concepts"
  on public.concepts for select
  using (auth.uid() is not null);

create policy "Users read concept edges"
  on public.concept_edges for select
  using (auth.uid() is not null);

create policy "Users read question concepts"
  on public.question_concepts for select
  using (auth.uid() is not null);

create policy "Teachers manage courses"
  on public.courses for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

create policy "Teachers manage concepts"
  on public.concepts for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

create policy "Teachers manage concept edges"
  on public.concept_edges for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

create policy "Teachers manage question concepts"
  on public.question_concepts for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );

notify pgrst, 'reload schema';
