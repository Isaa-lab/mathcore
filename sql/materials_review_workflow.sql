-- Materials review workflow + storage policy template
-- Execute in Supabase SQL editor.

-- 1) Materials table: add review fields
alter table public.materials
  add column if not exists status text default 'approved'
    check (status in ('pending', 'approved', 'rejected'));

alter table public.materials
  add column if not exists reviewed_by uuid references public.profiles(id);

alter table public.materials
  add column if not exists reviewed_at timestamp with time zone;

alter table public.materials
  add column if not exists review_note text;

create index if not exists materials_status_idx on public.materials(status);
create index if not exists materials_uploaded_by_idx on public.materials(uploaded_by);

update public.materials
set status = coalesce(status, 'approved')
where status is null;

-- 2) RLS: replace old policies safely
drop policy if exists "All users can read materials" on public.materials;
drop policy if exists "Teachers can insert materials" on public.materials;
drop policy if exists "Teachers can delete own materials" on public.materials;

-- Teachers can read all
create policy "Teachers can read all materials"
  on public.materials for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'teacher'
    )
  );

-- Students can read approved + own uploads
create policy "Students can read approved or own materials"
  on public.materials for select
  using (
    auth.uid() = uploaded_by
    or status = 'approved'
  );

-- Any authenticated user can upload:
-- teacher uploads are auto-approved; student uploads must be pending
create policy "Users can upload materials with role constraints"
  on public.materials for insert
  with check (
    auth.uid() = uploaded_by
    and (
      (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'teacher'
        )
        and status = 'approved'
      )
      or
      (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and role = 'student'
        )
        and status = 'pending'
      )
    )
  );

-- Teachers can review/update any material
create policy "Teachers can review materials"
  on public.materials for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'teacher'
    )
  );

-- Uploader can update own material only before approval
create policy "Uploader can edit pending own material"
  on public.materials for update
  using (uploaded_by = auth.uid() and status = 'pending')
  with check (uploaded_by = auth.uid() and status = 'pending');

-- Teachers can delete materials
create policy "Teachers can delete materials"
  on public.materials for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'teacher'
    )
  );

-- 3) Storage policies for bucket: materials
-- Recommended mode:
-- - Authenticated upload (teacher/student)
-- - Public read for approved materials via file_data public URL
-- - Optional: if you want stronger privacy, turn OFF public bucket and
--   switch to signed URLs later.

-- Ensure bucket exists (safe no-op if already created)
insert into storage.buckets (id, name, public)
values ('materials', 'materials', true)
on conflict (id) do nothing;

-- Remove old bucket policies (if any, optional)
drop policy if exists "Authenticated users can upload materials files" on storage.objects;
drop policy if exists "Public can read materials files" on storage.objects;
drop policy if exists "Users can update own materials files" on storage.objects;
drop policy if exists "Users can delete own materials files" on storage.objects;

-- Authenticated users can upload files into materials bucket
create policy "Authenticated users can upload materials files"
  on storage.objects for insert
  with check (bucket_id = 'materials' and auth.uid() is not null);

-- Public read
create policy "Public can read materials files"
  on storage.objects for select
  using (bucket_id = 'materials');

-- Owner can update/delete own objects (owner is auth uid text)
create policy "Users can update own materials files"
  on storage.objects for update
  using (bucket_id = 'materials' and owner::text = auth.uid()::text);

create policy "Users can delete own materials files"
  on storage.objects for delete
  using (bucket_id = 'materials' and owner::text = auth.uid()::text);

