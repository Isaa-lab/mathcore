export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { chapter, type, count } = req.body;

  if (!process.env.ANTHROPIC_KEY) {
    return res.status(500).json({ error: "API Key 未配置，请在 Vercel 环境变量中添加 ANTHROPIC_KEY" });
  }

  const prompt = `你是数学课程出题专家，请为"${chapter}"生成${count}道${type}。要求紧贴数值分析或最优化课程内容。单选题和多选题提供4个选项（A/B/C/D格式），填空题和判断题options设为null，每题提供简短解析（不超过60字）。请严格按照以下JSON数组格式返回，不要包含任何其他文字或代码块标记：[{"question":"题目内容","options":["A.选项1","B.选项2","C.选项3","D.选项4"],"answer":"A","explanation":"解析内容"}]`;

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
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: "Anthropic API 错误: " + errText });
    }

    const data = await response.json();
    const text = data.content?.map((b) => b.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let questions;
    try {
      questions = JSON.parse(clean);
    } catch (e) {
      return res.status(500).json({ error: "JSON解析失败: " + clean.slice(0, 200) });
    }

    res.status(200).json({ questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
