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
      max_tokens: 2400,
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
  if (!process.env.ANTHROPIC_KEY) return res.status(500).json({ error: "API Key 未配置" });

  const { claims = [], course, chapter, count = 8 } = req.body || {};
  const normalizedClaims = (Array.isArray(claims) ? claims : [])
    .map((c, idx) => ({
      claim_index: idx,
      chunk_index: Number.isFinite(Number(c?.chunk_index)) ? Number(c.chunk_index) : null,
      claim_text: String(c?.claim_text || "").trim(),
      source_quote: String(c?.source_quote || "").trim(),
    }))
    .filter((c) => c.claim_text.length >= 8)
    .slice(0, 28);

  if (!normalizedClaims.length) return res.status(400).json({ error: "缺少可用 claims" });

  const prompt = `你是数学命题专家。请仅基于给定 claims 出题，不得脱离资料。

【课程】${course || "数学"}
【章节】${chapter || "未知章节"}
【claims】
${JSON.stringify(normalizedClaims)}

要求：
1) 生成 ${Math.min(Math.max(Number(count) || 8, 4), 16)} 道题；
2) 题型以单选题为主，可少量判断题；
3) 每题必须具体、可判定，不得出现“第N个理解点”“本资料内容”等模板语；
4) 对每题给出 source_chunk_id、source_quote、quality_score(0-100)；
5) quality_score 低于 70 的题不要输出；
6) 单选题必须提供4个选项（A/B/C/D），答案为 A/B/C/D；判断题 options 为 null，答案为 正确/错误。
7) 若 claims 为英文教材内容，题干与选项可使用英文；判断题答案仍为「正确」或「错误」。禁止无关软件名、文件名、作者署名。

仅返回 JSON：
{
  "questions": [
    {
      "question":"...",
      "type":"单选题",
      "options":["A....","B....","C....","D...."],
      "answer":"A",
      "explanation":"...",
      "chapter":"...",
      "source_chunk_id":0,
      "source_quote":"...",
      "quality_score":88
    }
  ]
}`;

  try {
    const result = await callAnthropic(prompt);
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    return res.status(200).json({ questions });
  } catch (err) {
    return res.status(500).json({ error: err.message || "generate-from-claims failed" });
  }
}
