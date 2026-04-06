const parseJsonLoose = (rawText) => {
  const clean = String(rawText || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw e;
  }
};

const segmentRawText = (merged) => {
  const m = String(merged || "").replace(/\s+/g, " ").trim();
  if (!m) return [];
  let parts = m
    .split(/[。！？]|\.\s+|\?\s+|\!\s+|;\s+|；\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  if (parts.length < 4) {
    parts = m.split(/\n+/).map((s) => s.trim()).filter((s) => s.length >= 12);
  }
  if (parts.length < 4) {
    const win = [];
    for (let i = 0; i < m.length && win.length < 24; i += 95) {
      const w = m.slice(i, i + 92).trim();
      if (w.length >= 20) win.push(w);
    }
    parts = win;
  }
  return parts.slice(0, 20);
};

const buildLocalFallback = (chunks, chapter, maxClaims) => {
  const merged = (Array.isArray(chunks) ? chunks : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .join("\n");
  const sents = segmentRawText(merged).slice(0, Math.max(8, Math.min(maxClaims || 20, 20)));

  const claims = sents.map((s) => ({
    chunk_index: 0,
    claim_text: s.slice(0, 120),
    claim_type: "fact",
    difficulty: 2,
    source_quote: s.slice(0, 80),
  }));
  const topics = sents.slice(0, 8).map((s, i) => {
    const title = s.length > 42 ? s.slice(0, 40) + "…" : s;
    return {
      name: title,
      summary: s.slice(0, 100),
      chapter: chapter || null,
    };
  });
  if (!topics.length && merged.length >= 30) {
    const w = merged.slice(0, 200);
    topics.push({ name: w.slice(0, 48), summary: w, chapter: chapter || null });
  }
  return { topics, claims };
};

const callAnthropic = async (prompt) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
      max_tokens: 2200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error("Anthropic API 错误: " + err.slice(0, 220));
  }
  const data = await response.json();
  const raw = data.content?.map((b) => b.text || "").join("") || "";
  return parseJsonLoose(raw);
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { chunks = [], course, chapter, maxClaims = 20 } = req.body || {};
  const normalized = (Array.isArray(chunks) ? chunks : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .slice(0, 18);
  if (!normalized.length) return res.status(400).json({ error: "缺少资料分段内容" });

  const chunkText = normalized
    .map((c, i) => `[片段${i}] ${c.slice(0, 550)}`)
    .join("\n");

  const prompt = `你是一位严谨的数学课程教研员。请先阅读资料片段，再提取“可命题”的原子知识点（claims）。

【课程】${course || "数学"}
【章节】${chapter || "未知章节"}
【资料片段】
${chunkText}

要求：
1) claim 必须来自片段原文，不得编造；
2) 每条 claim 必须是可判定真伪或可用于选择题干扰项构造的明确陈述；
3) 输出 8-${Math.min(Math.max(maxClaims, 8), 24)} 条，尽量覆盖定义、结论、方法、公式；
4) source_quote 必须是对应片段里的原句或近似原句（<=80字）。
5) 只保留与教材数学内容相关的陈述；忽略版权页、软件名、纯页眉页脚。
6) 若原文为英文，topics 与 claims 可用英文（或中英对照），须忠实于片段，勿编造。

仅返回 JSON：
{
  "topics": [{"name":"知识点名称","summary":"一句话总结"}],
  "claims": [
    {"chunk_index":0,"claim_text":"...","claim_type":"definition","difficulty":2,"source_quote":"..."}
  ]
}`;

  try {
    if (!process.env.ANTHROPIC_KEY) {
      return res.status(200).json(buildLocalFallback(normalized, chapter, maxClaims));
    }
    const result = await callAnthropic(prompt);
    const claims = Array.isArray(result?.claims) ? result.claims : [];
    const topics = Array.isArray(result?.topics) ? result.topics : [];
    if (!claims.length && !topics.length) {
      return res.status(200).json(buildLocalFallback(normalized, chapter, maxClaims));
    }
    return res.status(200).json({ topics, claims });
  } catch (err) {
    return res.status(200).json(buildLocalFallback(normalized, chapter, maxClaims));
  }
}
