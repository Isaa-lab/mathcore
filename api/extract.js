export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, course, chapter, count = 5 } = req.body;
  if (!text || text.trim().length < 20) {
    return res.status(400).json({ error: "文本内容太少，无法出题" });
  }

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  if (!GEMINI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "未配置 API Key" });
  }

  const truncated = text.slice(0, 8000);
  const prompt = `你是数学课程助教。请根据以下教材内容出${count}道题目。

【教材内容】：
${truncated}

【课程】：${course || "数学"}
【章节】：${chapter || "本章节"}

请严格按以下 JSON 格式返回，不要有其他文字：
{"topics":[{"name":"知识点名称","summary":"一句话说明"}],"questions":[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析","type":"单选题"}]}

要求：题目必须来自教材内容，判断题options设null，answer为正确或错误，共${count}道题。`;

  let responseText = "";

  // Try Gemini first (FREE - no cost)
  if (GEMINI_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 3000 },
          }),
        }
      );
      if (r.ok) {
        const d = await r.json();
        responseText = d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    } catch (e) {}
  }

  // Fallback to Anthropic
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
    } catch (e) {}
  }

  if (!responseText) {
    return res.status(500).json({ error: "AI 服务不可用，请检查 GEMINI_KEY 环境变量" });
  }

  const clean = responseText.replace(/```json|```/g, "").trim();
  let result;
  try { result = JSON.parse(clean); }
  catch (e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { result = JSON.parse(m[0]); } catch { return res.status(500).json({ error: "格式错误" }); } }
    else return res.status(500).json({ error: "格式错误" });
  }

  res.status(200).json({
    topics: Array.isArray(result.topics) ? result.topics : [],
    questions: Array.isArray(result.questions) ? result.questions : [],
  });
}