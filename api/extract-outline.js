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

const segmentRaw = (merged) => {
  const m = String(merged || "").replace(/\s+/g, " ").trim();
  if (!m) return [];
  let parts = m
    .split(/[。！？]|\.\s+|\?\s+|\!\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);
  if (parts.length < 3) {
    for (let i = 0; i < m.length && parts.length < 12; i += 100) {
      const w = m.slice(i, i + 96).trim();
      if (w.length >= 18) parts.push(w);
    }
  }
  return parts.slice(0, 12);
};

const localOutlineFallback = (chunks, chapter) => {
  const text = (Array.isArray(chunks) ? chunks : []).map((c) => String(c || "")).join("\n");
  const sents = segmentRaw(text);
  const topics = sents.slice(0, 8).map((s) => (s.length > 36 ? s.slice(0, 34) + "…" : s));
  const secTitle = chapter && chapter !== "未知章节" ? chapter : "教材正文摘录";
  return {
    outline: [
      {
        title: secTitle,
        summary: "由资料原文自动分段生成，上传后请用「一键补题」刷新",
        topics: topics.length ? topics.slice(0, 6) : [text.slice(0, 40) || "请重新上传 PDF 并等待解析"],
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
3) 禁止模板化词语（如“第N个理解点”）；原文为英文时可用英文 topic。
4) topic 必须贴近原文术语或句子，勿写空泛学习建议。

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

