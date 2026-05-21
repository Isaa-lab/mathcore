-- 知识点详情表：每个 material_topic 一个详情卡（公式 + 解释 + 例题 + 思路）
-- 设计 3B：单独建表，通过 topic_id 外键关联，避免 material_topics 表越来越胖。
-- 在 Supabase SQL Editor 跑一次即可。

CREATE TABLE IF NOT EXISTS topic_details (
  id BIGSERIAL PRIMARY KEY,
  topic_id BIGINT NOT NULL REFERENCES material_topics(id) ON DELETE CASCADE,
  -- /api/topic-detail 输出的 5 个字段（schema 与 API 对齐）
  intro TEXT,              -- 150-220 字的解释（"是什么 + 为什么用 + 关键直觉"）
  formulas JSONB,          -- [{label, latex}, ...]  公式集合
  steps JSONB,             -- ["第1步: ...", "第2步: ..."]  解题思路
  examples JSONB,          -- [{question, answer, explanation}, ...]  例题
  viz_hint TEXT,           -- 可视化提示（自然语言描述适合什么图）
  -- 元数据：哪个 AI 生成的，方便日后对比
  provider TEXT,
  provider_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- 一个 topic 只允许一份详情；要重建就 upsert 覆盖
  UNIQUE(topic_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_details_topic_id ON topic_details(topic_id);

-- RLS：和 material_topics 一致，所有登录用户可读；写入由后端 service role 操作
ALTER TABLE topic_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "topic_details read all" ON topic_details;
CREATE POLICY "topic_details read all" ON topic_details
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "topic_details write authed" ON topic_details;
CREATE POLICY "topic_details write authed" ON topic_details
  FOR ALL USING (auth.role() IS NOT NULL) WITH CHECK (auth.role() IS NOT NULL);
