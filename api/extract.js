export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, course, chapter, count = 5 } = req.body;
  if (!text || text.trim().length < 20) {
    return res.status(400).json({ error: "文本内容太少，无法出题" });
  }
  if (!process.env.ANTHROPIC_KEY) {
    return res.status(500).json({ error: "API Key 未配置" });
  }

  const truncated = text.slice(0, 8000);
  const prompt = `你是数学课程助教。请根据以下教材内容出题。

【教材内容】：
${truncated}

【课程】：${course || "数学"}
【章节】：${chapter || "本章节"}
【需要题目数量】：${count} 道

请严格按以下 JSON 格式返回，不要有其他文字：
{"topics":[{"name":"知识点名称","summary":"一句话说明"}],"questions":[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容","type":"单选题"}]}

要求：题目必须基于教材内容，判断题options设null，answer为正确或错误，至少生成${count}道题。`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: "API 调用失败: " + err.slice(0, 200) });
    }

    const data = await response.json();
    const raw = data.content?.map(b => b.text || "").join("") || "";
    const clean = raw.replace(/```json|```/g, "").trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try { result = JSON.parse(match[0]); }
        catch { return res.status(500).json({ error: "AI 返回格式错误" }); }
      } else {
        return res.status(500).json({ error: "AI 返回格式错误" });
      }
    }

    res.status(200).json({
      topics: result.topics || [],
      questions: result.questions || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}