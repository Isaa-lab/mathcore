export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_KEY) return res.status(500).json({ error: "API Key 未配置" });

  const { wrongQuestions = [], chapter = "综合", count = 5 } = req.body || {};
  if (!Array.isArray(wrongQuestions) || wrongQuestions.length === 0) {
    return res.status(400).json({ error: "缺少错题上下文" });
  }

  const wrongText = wrongQuestions.slice(0, 8).map((q, i) => {
    const qq = typeof q === "string" ? q : q?.question;
    const ans = typeof q === "object" ? q?.answer : "";
    return `${i + 1}. ${qq || ""}（正确答案:${ans || "未知"}）`;
  }).join("\n");

  const prompt = `你是数学学习平台助教。请基于以下错题，生成 ${count} 道“同知识点变式题”，难度略高于原题。\n\n章节：${chapter}\n错题参考：\n${wrongText}\n\n要求：默认生成单选题，含4个选项，提供答案与解析。\n严格输出 JSON 数组，不要额外文字：\n[{"question":"题目","options":["A.xxx","B.xxx","C.xxx","D.xxx"],"answer":"A","explanation":"解析"}]`;

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
        max_tokens: 1600,
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
    let questions;
    try {
      questions = JSON.parse(clean);
    } catch (e) {
      return res.status(500).json({ error: "AI 返回格式错误，请重试" });
    }
    return res.status(200).json({ questions: Array.isArray(questions) ? questions : [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

