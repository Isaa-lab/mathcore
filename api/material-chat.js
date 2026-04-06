export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_KEY) return res.status(500).json({ error: "API Key 未配置" });

  const { question, materialTitle, contextChunks = [] } = req.body || {};
  if (!question) return res.status(400).json({ error: "缺少问题内容" });

  const ctx = (Array.isArray(contextChunks) ? contextChunks : [])
    .slice(0, 12)
    .map((c, i) => `[片段${i + 1}] ${String(c || "").slice(0, 500)}`)
    .join("\n");

  const prompt = `你是学习网站中的资料助教。请只基于给定资料片段回答，不确定时直接说“资料中未明确给出”。\n\n资料标题：${materialTitle || "未命名资料"}\n问题：${question}\n\n资料片段：\n${ctx || "（暂无片段）"}\n\n请严格输出 JSON：\n{"answer":"200字以内答案","sources":["片段1的关键短句","片段2的关键短句"]}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: "Anthropic API 错误: " + err.slice(0, 200) });
    }
    const data = await response.json();
    const raw = data.content?.map((b) => b.text || "").join("") || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    let result;
    try {
      result = JSON.parse(clean);
    } catch (e) {
      return res.status(500).json({ error: "AI 返回格式错误，请重试" });
    }
    return res.status(200).json({
      answer: result.answer || "未生成答案",
      sources: Array.isArray(result.sources) ? result.sources.slice(0, 3) : [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

