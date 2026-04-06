-- AI learning pipeline upgrade
-- Run in Supabase SQL editor.

-- 1) Atomic claims learned from material chunks
create table if not exists public.material_claims (
  id uuid default gen_random_uuid() primary key,
  material_id uuid not null references public.materials(id) on delete cascade,
  chunk_index int,
  claim_text text not null,
  claim_type text default 'fact' check (claim_type in ('fact', 'definition', 'conclusion', 'method', 'formula')),
  difficulty int default 2 check (difficulty between 1 and 5),
  source_quote text,
  created_at timestamptz default now()
);

create index if not exists material_claims_material_idx on public.material_claims(material_id);
create index if not exists material_claims_chunk_idx on public.material_claims(material_id, chunk_index);

-- 2) Question quality and source traceability fields
alter table public.questions
  add column if not exists source_chunk_id int;

alter table public.questions
  add column if not exists source_quote text;

alter table public.questions
  add column if not exists quality_score int default 0;

-- Keep scores in [0,100]
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'questions_quality_score_range'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint questions_quality_score_range check (quality_score between 0 and 100);
  end if;
end $$;

create index if not exists questions_quality_score_idx on public.questions(quality_score);
create index if not exists questions_material_quality_idx on public.questions(material_id, quality_score desc);

-- 3) RLS for claims
alter table public.material_claims enable row level security;

drop policy if exists "Users read claims by material visibility" on public.material_claims;
drop policy if exists "Teachers manage claims" on public.material_claims;

create policy "Users read claims by material visibility"
  on public.material_claims for select
  using (
    exists (
      select 1 from public.materials m
      where m.id = material_id
        and (m.status = 'approved' or m.uploaded_by = auth.uid())
    )
  );

create policy "Teachers manage claims"
  on public.material_claims for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
  );
