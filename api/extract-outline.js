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

const localOutlineFallback = (chunks, chapter) => {
  const text = (Array.isArray(chunks) ? chunks : []).map((c) => String(c || "")).join(" ");
  const sents = text.split(/[。！？.!?]/).map((s) => s.trim()).filter((s) => s.length >= 8);
  const topics = sents.slice(0, 8).map((s) => s.slice(0, 28));
  const secTitle = chapter || "资料大纲";
  return {
    outline: [
      {
        title: secTitle,
        summary: "基于上传资料自动整理",
        topics: (topics.length ? topics : ["核心概念", "关键方法", "典型结论", "应用场景"]).slice(0, 6),
      },
    ],
  };
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { chunks = [], course, chapter } = req.body || {};
  const normalized = (Array.isArray(chunks) ? chunks : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .slice(0, 16);
  if (!normalized.length) return res.status(200).json(localOutlineFallback([], chapter));

  if (!process.env.ANTHROPIC_KEY) return res.status(200).json(localOutlineFallback(normalized, chapter));

  const prompt = `你是数学课程教研专家。请根据资料片段先生成课程学习大纲，再细分知识点。

【课程】${course || "数学"}
【章节】${chapter || "未知章节"}
【资料片段】
${normalized.map((c, i) => `[片段${i + 1}] ${c.slice(0, 500)}`).join("\n")}

要求：
1) 先给 2-5 个大纲 section；
2) 每个 section 给 2-6 个可学习、可出题的知识点 topic；
3) 全部中文，禁止模板化词语（如“第N个理解点”）；
4) topic 应尽量贴近原文术语。

只返回 JSON：
{
  "outline":[
    {"title":"小节名","summary":"一句话","topics":["知识点1","知识点2"]}
  ]
}`;

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
        max_tokens: 1800,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return res.status(200).json(localOutlineFallback(normalized, chapter));
    const data = await response.json();
    const raw = data.content?.map((b) => b.text || "").join("") || "";
    const parsed = parseJsonLoose(raw);
    const outline = Array.isArray(parsed?.outline) ? parsed.outline : [];
    if (!outline.length) return res.status(200).json(localOutlineFallback(normalized, chapter));
    return res.status(200).json({ outline });
  } catch (e) {
    return res.status(200).json(localOutlineFallback(normalized, chapter));
  }
}

