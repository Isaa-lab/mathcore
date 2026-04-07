export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { chapter, type, count } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  if (!GEMINI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "未配置任何 API Key，请在 Vercel 添加 GEMINI_KEY（免费）" });
  }

  const prompt = `你是数学课程出题专家。请为"${chapter}"这个数学章节生成${count}道${type}。

要求：
- 题目紧贴数值分析或最优化理论内容，考察具体概念和计算
- 单选题提供4个选项（A/B/C/D），干扰项合理
- 判断题 options 设为 null，answer 为"正确"或"错误"
- 每题附简短解析（40字以内）

严格按以下 JSON 数组格式返回，不要有其他文字：
[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容","type":"单选题"}]`;

  let responseText = "";

  // Try Gemini (free)
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 3000,
            },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        responseText = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } else {
        const err = await r.text();
        console.error("Gemini error:", r.status, err.slice(0, 200));
      }
    } catch (e) {
      console.error("Gemini error:", e.message);
    }
  }

  // Anthropic fallback
  if (!responseText && ANTHROPIC_KEY) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 3000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        responseText = d.content?.map(b => b.text || "").join("") || "";
      }
    } catch (e) {
      console.error("Anthropic error:", e.message);
    }
  }

  if (!responseText) {
    return res.status(500).json({ error: "AI 服务不可用，请检查 GEMINI_KEY 环境变量配置" });
  }

  const clean = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  let questions;
  try {
    questions = JSON.parse(clean);
  } catch (e) {
    const m = clean.match(/\[[\s\S]*\]/);
    if (m) {
      try { questions = JSON.parse(m[0]); }
      catch { return res.status(500).json({ error: "JSON解析失败: " + clean.slice(0, 100) }); }
    } else {
      return res.status(500).json({ error: "格式错误: " + clean.slice(0, 100) });
    }
  }

  // Validate
  if (!Array.isArray(questions)) {
    return res.status(500).json({ error: "返回格式不是数组" });
  }

  const cleaned = questions
    .filter(q => q && q.question)
    .map(q => ({
      question: q.question,
      options: q.options || null,
      answer: q.answer || (q.options ? "A" : "正确"),
      explanation: q.explanation || "",
      type: q.type || (q.options ? "单选题" : "判断题"),
    }));

  res.status(200).json({ questions: cleaned });
}