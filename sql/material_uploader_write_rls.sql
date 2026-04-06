-- 允许「资料上传者」写入自己的 chunks / topics / claims / parse_jobs
-- 解决：界面显示教师但 profiles.role 非 teacher 时，INSERT 被 RLS 静默拒绝、数据库始终为 0
-- 在 Supabase SQL Editor 执行一次即可（与 Teachers 策略并存，OR 生效）

-- material_chunks
drop policy if exists "Uploader writes own material chunks" on public.material_chunks;
create policy "Uploader writes own material chunks"
  on public.material_chunks for all
  using (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  )
  with check (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  );

-- material_topics
drop policy if exists "Uploader writes own material topics" on public.material_topics;
create policy "Uploader writes own material topics"
  on public.material_topics for all
  using (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  )
  with check (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  );

-- material_claims
drop policy if exists "Uploader writes own material claims" on public.material_claims;
create policy "Uploader writes own material claims"
  on public.material_claims for all
  using (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  )
  with check (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  );

-- material_parse_jobs（解析任务日志）
drop policy if exists "Uploader writes own parse jobs" on public.material_parse_jobs;
create policy "Uploader writes own parse jobs"
  on public.material_parse_jobs for all
  using (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  )
  with check (
    exists (select 1 from public.materials m where m.id = material_id and m.uploaded_by = auth.uid())
  );
