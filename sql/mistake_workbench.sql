-- Mistake Workbench schema: papers / paper_items / mastery + private Storage bucket.

create table if not exists public.papers (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null default '线性代数',
  title text,
  image_urls text[] default '{}',
  status text not null default 'uploaded'
    check (status in ('uploaded','extracting','reviewing','analyzed')),
  created_at timestamptz default now()
);

create table if not exists public.paper_items (
  id uuid default gen_random_uuid() primary key,
  paper_id uuid not null references public.papers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  number text,
  question text,
  student_answer text,
  correct_answer text,
  is_correct boolean,
  error_type text,
  error_detail text,
  knowledge_points text[] default '{}',
  chapter text,
  answer_confidence text default 'high',
  reviewed boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.mastery (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  knowledge_point text not null,
  chapter text,
  wrong_count int default 0,
  total_count int default 0,
  level text default 'unknown' check (level in ('weak','ok','strong','unknown')),
  updated_at timestamptz default now(),
  unique(user_id, knowledge_point)
);

create index if not exists idx_papers_user on public.papers(user_id);
create index if not exists idx_items_paper on public.paper_items(paper_id);
create index if not exists idx_items_user on public.paper_items(user_id);
create index if not exists idx_items_wrong on public.paper_items(user_id) where is_correct = false;
create index if not exists idx_mastery_user on public.mastery(user_id);

alter table public.papers enable row level security;
alter table public.paper_items enable row level security;
alter table public.mastery enable row level security;

drop policy if exists "own papers select" on public.papers;
create policy "own papers select" on public.papers for select using (auth.uid() = user_id);
drop policy if exists "own papers insert" on public.papers;
create policy "own papers insert" on public.papers for insert with check (auth.uid() = user_id);
drop policy if exists "own papers update" on public.papers;
create policy "own papers update" on public.papers for update using (auth.uid() = user_id);
drop policy if exists "own papers delete" on public.papers;
create policy "own papers delete" on public.papers for delete using (auth.uid() = user_id);

drop policy if exists "own items select" on public.paper_items;
create policy "own items select" on public.paper_items for select using (auth.uid() = user_id);
drop policy if exists "own items insert" on public.paper_items;
create policy "own items insert" on public.paper_items for insert with check (auth.uid() = user_id);
drop policy if exists "own items update" on public.paper_items;
create policy "own items update" on public.paper_items for update using (auth.uid() = user_id);
drop policy if exists "own items delete" on public.paper_items;
create policy "own items delete" on public.paper_items for delete using (auth.uid() = user_id);

drop policy if exists "own mastery all" on public.mastery;
create policy "own mastery all" on public.mastery
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('papers', 'papers', false)
on conflict (id) do nothing;

drop policy if exists "own paper files select" on storage.objects;
create policy "own paper files select" on storage.objects
  for select using (bucket_id = 'papers' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "own paper files insert" on storage.objects;
create policy "own paper files insert" on storage.objects
  for insert with check (bucket_id = 'papers' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "own paper files delete" on storage.objects;
create policy "own paper files delete" on storage.objects
  for delete using (bucket_id = 'papers' and auth.uid()::text = (storage.foldername(name))[1]);
