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
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_KEY) return res.status(500).json({ error: "API Key 未配置" });

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
5) 只保留和${course || "数学"}课程相关内容；忽略文件元数据、软件名称、无意义英文串。
6) 输出统一使用中文（公式符号可保留英文/希腊字母）。

仅返回 JSON：
{
  "topics": [{"name":"知识点名称","summary":"一句话总结"}],
  "claims": [
    {"chunk_index":0,"claim_text":"...","claim_type":"definition","difficulty":2,"source_quote":"..."}
  ]
}`;

  try {
    const result = await callAnthropic(prompt);
    const claims = Array.isArray(result?.claims) ? result.claims : [];
    const topics = Array.isArray(result?.topics) ? result.topics : [];
    return res.status(200).json({ topics, claims });
  } catch (err) {
    return res.status(500).json({ error: err.message || "extract-claims failed" });
  }
}
