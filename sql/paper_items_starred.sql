-- 错题本：给 paper_items 增加"收藏"标记。
-- 错题（is_correct=false）自动进错题本；对的题/收藏的题用 starred=true 标记后也进。
alter table public.paper_items add column if not exists starred boolean default false;

-- 错题本查询用的索引：错的 或 收藏的
create index if not exists idx_items_notebook on public.paper_items(user_id)
  where is_correct = false or starred = true;
