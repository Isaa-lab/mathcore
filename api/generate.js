export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { chapter, type, count } = req.body;

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  if (!GEMINI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "未配置 API Key" });
  }

  const prompt = `你是数学课程出题专家，请为"${chapter}"生成${count}道${type}。要求紧贴数值分析或最优化课程内容。单选题和多选题提供4个选项（A/B/C/D格式），填空题和判断题options设为null，每题提供简短解析（不超过60字）。请严格按照以下JSON数组格式返回，不要包含任何其他文字：[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容"}]`;

  let responseText = "";

  // Gemini (free)
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        responseText = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    } catch (e) {}
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
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (r.ok) {
        const d = await r.json();
        responseText = d.content?.map(b => b.text || "").join("") || "";
      }
    } catch (e) {}
  }

  if (!responseText) {
    return res.status(500).json({ error: "AI 服务不可用，请检查 GEMINI_KEY 环境变量" });
  }

  const clean = responseText.replace(/```json|```/g, "").trim();
  let questions;
  try { questions = JSON.parse(clean); }
  catch (e) {
    const m = clean.match(/\[[\s\S]*\]/);
    if (m) { try { questions = JSON.parse(m[0]); } catch { return res.status(500).json({ error: "JSON解析失败" }); } }
    else return res.status(500).json({ error: "JSON解析失败: " + clean.slice(0, 100) });
  }

  res.status(200).json({ questions });
}